create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions, pg_catalog;
select no_plan();

-- Committed, isolated synthetic fixtures let independent sessions contend on
-- the real principal fence. Cleanup never targets seeded or user-owned data.
delete from private.v2_booker_profiles where principal_id='c9100000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where principal_id='c9100000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where principal_id='c9100000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='c9000000-0000-4000-8000-000000000001';
delete from auth.users where id='c9100000-0000-4000-8000-000000000001';
drop schema if exists project_s_profile_wait cascade;
create schema project_s_profile_wait;
create table project_s_profile_wait.state(key text primary key,value jsonb);
create function project_s_profile_wait.context() returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','profile-wait-request',
    'principalId','c9100000-0000-4000-8000-000000000001',
    'subjectId','c9100000-0000-4000-8000-000000000001',
    'instanceId','c9000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'transport','http');
$$;
create function project_s_profile_wait.review(p_id uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return public.project_s_create_booker_profile_v2(project_s_profile_wait.context(),p_id,
    '{"name":"Synthetic Waiting Booker","email":"waiting-booker@example.invalid","guestTimeZone":"UTC"}');
exception when others then
  return jsonb_build_object('errorCode',sqlstate);
end;
$$;
create function pg_temp.wait_for_profile_lock(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare v_deadline timestamptz := clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return true; end if;
    exit when clock_timestamp()>=v_deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;
create function pg_temp.profile_result_ready_without_wait(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare v_deadline timestamptz := clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return false; end if;
    if extensions.dblink_is_busy('profile_reader')=0 then return true; end if;
    exit when clock_timestamp()>=v_deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;

insert into private.v2_authority_instance(instance_id,epoch,audience) values
  ('c9000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
values('00000000-0000-0000-0000-000000000000','c9100000-0000-4000-8000-000000000001',
  'authenticated','authenticated','profile-wait@example.invalid',clock_timestamp(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"profile-wait-owner","full_name":"Synthetic profile wait owner","timezone":"UTC"}',
  clock_timestamp(),clock_timestamp(),'','','','',false);
insert into project_s_profile_wait.state values ('initial',project_s_profile_wait.review(
  'c9200000-0000-4000-8000-000000000001'));
select is((select value->>'revision' from project_s_profile_wait.state where key='initial'),'1',
  'positive control creates a real profile and principal fence');

select is(dblink_connect('profile_holder',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','profile fence holder connects');
select is(dblink_connect('profile_reader',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','profile contender connects');
create temporary table profile_reader_pid(pid integer);
insert into profile_reader_pid select pid from dblink('profile_reader','select pg_backend_pid()') as p(pid integer);

select is(dblink_exec('profile_holder','begin'),'BEGIN','fresh review holder begins');
select is(dblink_exec('profile_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the principal fence');
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000002')::text$query$),1,
  'new review starts while principal fence is held');
select ok(pg_temp.wait_for_profile_lock((select pid from profile_reader_pid)),
  'new review is observed waiting on the principal fence');
insert into project_s_profile_wait.state values ('release',to_jsonb(clock_timestamp()));
select is(dblink_exec('profile_holder','commit'),'COMMIT','fresh review fence releases');
insert into project_s_profile_wait.state
  select 'after-wait',value::jsonb from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
select ok((select (value->>'reviewedAt')::timestamptz >=
  (select (value #>> '{}')::timestamptz from project_s_profile_wait.state where key='release')
  from project_s_profile_wait.state where key='after-wait'),
  'review timestamp is fresh after the observed wait');
select is((select (value->>'expiresAt')::timestamptz-(value->>'reviewedAt')::timestamptz
  from project_s_profile_wait.state where key='after-wait'),interval '168 hours',
  'wait does not shorten or extend the server-derived seven-day lifetime');

select is(dblink_exec('profile_holder','begin'),'BEGIN','expiry holder begins');
select is(dblink_exec('profile_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','expiry holder owns principal fence');
insert into project_s_profile_wait.state values ('deadline',to_jsonb(clock_timestamp()+interval '400 milliseconds'));
update private.v2_booker_profiles set expires_at=(select (value #>> '{}')::timestamptz
  from project_s_profile_wait.state where key='deadline')
  where profile_id='c9200000-0000-4000-8000-000000000001';
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000001')::text$query$),1,
  'exact retry begins before profile expiry');
select ok(pg_temp.wait_for_profile_lock((select pid from profile_reader_pid)),
  'exact retry is observed waiting on the principal fence');
select ok(clock_timestamp() < (select (value #>> '{}')::timestamptz from project_s_profile_wait.state where key='deadline'),
  'retry reached the fence before expiry');
select pg_sleep(greatest(0,extract(epoch from (
  (select (value #>> '{}')::timestamptz from project_s_profile_wait.state where key='deadline')
  +interval '30 milliseconds'-clock_timestamp()))::double precision));
select is(dblink_exec('profile_holder','commit'),'COMMIT','expiry fence releases after profile expiry');
select is(value::jsonb->>'errorCode','PT409','fresh post-wait expiry check refuses profile revival')
  from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
select is((select event_sequence::integer from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001'),2,
  'expired retry emits no new event and retains the original profile');

select is(dblink_exec('profile_holder','begin'),'BEGIN','delete holder begins');
select is(dblink_exec('profile_holder',$delete$do $$begin
  perform public.project_s_delete_booker_profile_v2(project_s_profile_wait.context(),
    'c9200000-0000-4000-8000-000000000002',1);
end;$$$delete$),'DO','delete owns the fence before its durable acknowledgement');
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000002')::text$query$),1,
  'retry contends with an uncommitted profile deletion');
select ok(pg_temp.wait_for_profile_lock((select pid from profile_reader_pid)),
  'retry is observed waiting for deletion serialization');
select is(dblink_exec('profile_holder','commit'),'COMMIT','profile deletion commits');
select is(value::jsonb->>'errorCode','PT409','subsequently serialized retry cannot restore deleted PII')
  from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
select ok((select name is null and email is null and guest_time_zone is null and state='deleted'
  from private.v2_booker_profiles where profile_id='c9200000-0000-4000-8000-000000000002'),
  'delete-versus-retry leaves the profile PII erased');

select is(dblink_exec('profile_holder','begin'),'BEGIN','principal disable holder begins');
select is(dblink_exec('profile_holder',$disable$update private.v2_authority_principals set disabled=true
  where principal_id='c9100000-0000-4000-8000-000000000001'$disable$),'UPDATE 1',
  'disabling principal holds the fence');
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000003')::text$query$),1,
  'new review contends with principal disable');
select ok(pg_temp.wait_for_profile_lock((select pid from profile_reader_pid)),
  'review is observed waiting for principal disable');
select is(dblink_exec('profile_holder','commit'),'COMMIT','principal disable commits');
select is(value::jsonb->>'errorCode','PT401','post-wait live principal check denies disabled issuer')
  from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
update private.v2_authority_principals set disabled=false where principal_id='c9100000-0000-4000-8000-000000000001';

select is(dblink_exec('profile_holder','begin'),'BEGIN','epoch-change holder begins');
select is(dblink_exec('profile_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','epoch-change holder owns principal fence');
select is(dblink_exec('profile_holder',$epoch$update private.v2_authority_instance set epoch=2
  where instance_id='c9000000-0000-4000-8000-000000000001'$epoch$),'UPDATE 1','new epoch is not yet committed');
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000003')::text$query$),1,
  'old-epoch review reaches the fence before epoch change commits');
select ok(pg_temp.wait_for_profile_lock((select pid from profile_reader_pid)),
  'review is observed waiting during epoch change');
select is(dblink_exec('profile_holder','commit'),'COMMIT','new epoch commits');
select is(value::jsonb->>'errorCode','PT401','post-wait instance check denies stale epoch')
  from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
update private.v2_authority_instance set epoch=1 where instance_id='c9000000-0000-4000-8000-000000000001';

-- New private authority locks must not add a blocking edge into legacy Auth.
-- Observe the conflicting row lock independently before exercising the RPC.
select is(dblink_exec('profile_holder','begin'),'BEGIN','Auth row contention holder begins');
select is(dblink_exec('profile_holder',$authlock$do $$begin
  perform id from auth.users where id='c9100000-0000-4000-8000-000000000001' for update;
end;$$$authlock$),'DO','holder locks the live synthetic Auth row without the principal fence');
select throws_ok($$select id from auth.users
  where id='c9100000-0000-4000-8000-000000000001' for key share nowait$$,
  '55P03',null,'conflicting Auth row lock is observed before the profile operation');
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000003')::text$query$),1,
  'profile create reaches the locked live account');
select ok(pg_temp.profile_result_ready_without_wait((select pid from profile_reader_pid)),
  'NOWAIT refusal completes without an observed wait or reaching the one-second lock timeout');
select is(value::jsonb->>'errorCode','PT503','Auth row contention maps to the bounded authority-busy result')
  from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
select is(dblink_exec('profile_holder','commit'),'COMMIT','Auth row contention holder releases');
select is((select count(*)::integer from private.v2_booker_profiles
  where principal_id='c9100000-0000-4000-8000-000000000001'),2,
  'Auth row refusal creates no profile');
select is((select event_sequence::integer from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001'),3,
  'Auth row refusal commits no event or sequence advance');

select is(dblink_exec('profile_holder','begin'),'BEGIN','account deletion holder begins');
select is(dblink_exec('profile_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','account deletion holder owns principal fence');
select is(dblink_exec('profile_holder',$account$delete from auth.users
  where id='c9100000-0000-4000-8000-000000000001'$account$),'DELETE 1','only synthetic account is deleted');
select is(dblink_send_query('profile_reader',$query$
  select project_s_profile_wait.review('c9200000-0000-4000-8000-000000000003')::text$query$),1,
  'review contends with out-of-band account deletion');
select ok(pg_temp.wait_for_profile_lock((select pid from profile_reader_pid)),
  'review is observed waiting before account deletion acknowledgement');
select is(dblink_exec('profile_holder','commit'),'COMMIT','account deletion commits');
select is(value::jsonb->>'errorCode','PT401','post-wait live account check denies deleted issuer')
  from dblink_get_result('profile_reader') as result(value text);
select * from dblink_get_result('profile_reader') as result(value text);
select is((select count(*)::integer from private.v2_booker_profiles
  where principal_id='c9100000-0000-4000-8000-000000000001'),2,
  'all stale/disabled/deleted-account attempts leave no additional profiles');
select is((select event_sequence::integer from private.v2_authority_principals
  where principal_id='c9100000-0000-4000-8000-000000000001'),3,
  'only two reviews and one deletion have durable ordered audit');

select is(dblink_disconnect('profile_reader'),'OK','profile contender disconnects');
select is(dblink_disconnect('profile_holder'),'OK','profile holder disconnects');
delete from private.v2_booker_profiles where principal_id='c9100000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where principal_id='c9100000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where principal_id='c9100000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='c9000000-0000-4000-8000-000000000001';
delete from auth.users where id='c9100000-0000-4000-8000-000000000001';
drop schema project_s_profile_wait cascade;
select * from finish();
