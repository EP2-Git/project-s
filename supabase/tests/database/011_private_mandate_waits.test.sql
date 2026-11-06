create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions,pg_catalog;
select no_plan();

-- Only these committed synthetic fixtures are visible to independent sessions.
-- No seeded or manually created account, authority row or booking is adopted.
delete from private.v2_mandates where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='e0000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('e0100000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000002');
drop schema if exists project_s_mandate_wait cascade;
create schema project_s_mandate_wait;
create table project_s_mandate_wait.state(key text primary key,value jsonb);
create function project_s_mandate_wait.context() returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-mandate-wait',
    'principalId','e0100000-0000-4000-8000-000000000001',
    'subjectId','e0100000-0000-4000-8000-000000000001',
    'instanceId','e0000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'transport','http');
$$;
create function project_s_mandate_wait.review(p_id uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return public.project_s_create_mandate_review_v2(project_s_mandate_wait.context(),p_id,
    (select value from project_s_mandate_wait.state where key='policy'));
exception when others then return jsonb_build_object('errorCode',sqlstate);
end;
$$;
create function project_s_mandate_wait.approve(p_id uuid,p_mandate uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return public.project_s_approve_mandate_v2(project_s_mandate_wait.context(),p_id,p_mandate,1,
    (select summary_digest from private.v2_mandate_reviews where review_id=p_id));
exception when others then return jsonb_build_object('errorCode',sqlstate);
end;
$$;
create function project_s_mandate_wait.get(p_id uuid) returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return public.project_s_get_mandate_v2(project_s_mandate_wait.context(),p_id);
exception when others then return jsonb_build_object('errorCode',sqlstate);
end;
$$;
create function pg_temp.wait_for_mandate_lock(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare v_deadline timestamptz:=clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return true; end if;
    exit when clock_timestamp()>=v_deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;
create function pg_temp.mandate_ready_without_wait(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare v_deadline timestamptz:=clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return false; end if;
    if extensions.dblink_is_busy('mandate_reader')=0 then return true; end if;
    exit when clock_timestamp()>=v_deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;

insert into private.v2_authority_instance(instance_id,epoch,audience) values
  ('e0000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Wait Host','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values
  ('e0100000-0000-4000-8000-000000000001'::uuid,'mandate-wait-owner@example.invalid','mandate-wait-owner'),
  ('e0100000-0000-4000-8000-000000000002'::uuid,'mandate-wait-host@example.invalid','mandate-wait-host')) owners(id,email,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,active) values
  ('e0700000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000002','Synthetic wait meeting',30,true);
insert into project_s_mandate_wait.state values ('actor',public.project_s_register_actor_v2(
  project_s_mandate_wait.context(),'e0300000-0000-4000-8000-000000000001',
  'e0400000-0000-4000-8000-000000000001',decode(repeat('c',64),'hex'),
  'Synthetic wait actor',clock_timestamp()+interval '2 days'));
insert into project_s_mandate_wait.state values ('profile',public.project_s_create_booker_profile_v2(
  project_s_mandate_wait.context(),'e0200000-0000-4000-8000-000000000001',
  '{"name":"Synthetic Waiting Booker","email":"mandate-waiting@example.invalid","guestTimeZone":"UTC"}'));
insert into project_s_mandate_wait.state values ('policy',jsonb_build_object(
  'actorId','e0300000-0000-4000-8000-000000000001','profileId','e0200000-0000-4000-8000-000000000001',
  'profileRevision',1,'username','mandate-wait-host','meetingTypeId','e0700000-0000-4000-8000-000000000001',
  'meetingWindowStart',to_char((clock_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'meetingWindowEnd',to_char((clock_timestamp()+interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'maxDurationMinutes',30,
  'notBefore',to_char((clock_timestamp()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expiresAt',to_char((clock_timestamp()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));

select is(dblink_connect('mandate_holder',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','mandate holder connects');
select is(dblink_connect('mandate_reader',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','mandate contender connects');
create temporary table mandate_reader_pid(pid integer);
insert into mandate_reader_pid select pid from dblink('mandate_reader','select pg_backend_pid()') as p(pid integer);

-- Review starts before a real fence wait; timestamp and five-minute lifetime
-- must be based on the fresh clock after the lock is acquired.
select is(dblink_exec('mandate_holder','begin'),'BEGIN','fresh review holder begins');
select is(dblink_exec('mandate_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='e0100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the real principal fence');
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000001')::text$query$),1,
  'new mandate review starts while fence is held');
select ok(pg_temp.wait_for_mandate_lock((select pid from mandate_reader_pid)),
  'review is observed waiting on the principal fence');
insert into project_s_mandate_wait.state values ('release',to_jsonb(clock_timestamp()));
select is(dblink_exec('mandate_holder','commit'),'COMMIT','fresh review fence releases');
insert into project_s_mandate_wait.state
  select 'review',value::jsonb from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
select ok((select reviewed_at >= (select (value #>> '{}')::timestamptz
  from project_s_mandate_wait.state where key='release') from private.v2_mandate_reviews
  where review_id='e0500000-0000-4000-8000-000000000001'),
  'review time is fresh after observed lock acquisition');
select is((select expires_at-reviewed_at from private.v2_mandate_reviews
  where review_id='e0500000-0000-4000-8000-000000000001'),interval '5 minutes',
  'ordinary review receives exactly five minutes after its wait');

-- Shorten this owned synthetic review, then prove the approval reached the
-- fence before expiry and is refused using time sampled after release.
select is(dblink_exec('mandate_holder','begin'),'BEGIN','expiry holder begins');
select is(dblink_exec('mandate_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='e0100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','expiry holder owns fence');
insert into project_s_mandate_wait.state values ('deadline',to_jsonb(clock_timestamp()+interval '400 milliseconds'));
update private.v2_mandate_reviews set
  reviewed_at=(select (value #>> '{}')::timestamptz-interval '5 minutes' from project_s_mandate_wait.state where key='deadline'),
  expires_at=(select (value #>> '{}')::timestamptz from project_s_mandate_wait.state where key='deadline')
  where review_id='e0500000-0000-4000-8000-000000000001';
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.approve('e0500000-0000-4000-8000-000000000001',
    'e0600000-0000-4000-8000-000000000001')::text$query$),1,
  'approval starts before review expiry');
select ok(pg_temp.wait_for_mandate_lock((select pid from mandate_reader_pid)),
  'approval is observed waiting on the principal fence');
select ok(clock_timestamp() < (select (value #>> '{}')::timestamptz
  from project_s_mandate_wait.state where key='deadline'),'approval reached fence before expiry');
select pg_sleep(greatest(0,extract(epoch from (
  (select (value #>> '{}')::timestamptz from project_s_mandate_wait.state where key='deadline')
  +interval '30 milliseconds'-clock_timestamp()))::double precision));
select is(dblink_exec('mandate_holder','commit'),'COMMIT','expiry fence releases after review deadline');
select is(value::jsonb->>'errorCode','PT409','fresh post-wait time rejects expired review approval')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
select is((select count(*)::integer from private.v2_mandates
  where principal_id='e0100000-0000-4000-8000-000000000001'),0,'expired approval creates no mandate budget');

-- The retention worker shares the principal fence. Hold it in another
-- session through the worker timeout, then prove the same batch can retry.
insert into project_s_mandate_wait.state
  select 'retention-sequence',to_jsonb(event_sequence) from private.v2_authority_principals
  where principal_id='e0100000-0000-4000-8000-000000000001';
select is(dblink_exec('mandate_holder','begin'),'BEGIN','retention holder begins');
select is(dblink_exec('mandate_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='e0100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','retention contends with the real principal fence');
select throws_ok($$select private.v2_redact_expired_mandate_reviews(
  'e0000000-0000-4000-8000-000000000001',1,'e0100000-0000-4000-8000-000000000001',1)$$,
  'PT503','AUTHORITY_BUSY','retention bounds the fence wait');
select ok((select state='pending' and policy_summary is not distinct from
    (select value->'policySummary' from project_s_mandate_wait.state where key='review')
  from private.v2_mandate_reviews where review_id='e0500000-0000-4000-8000-000000000001'),
  'failed cleanup keeps the original review payload');
select is((select to_jsonb(event_sequence) from private.v2_authority_principals
  where principal_id='e0100000-0000-4000-8000-000000000001'),
  (select value from project_s_mandate_wait.state where key='retention-sequence'),
  'failed cleanup does not advance the principal sequence');
select is((select count(*)::integer from private.v2_authority_events
  where principal_id='e0100000-0000-4000-8000-000000000001' and action='expired_mandate_reviews_redacted'),
  0,'failed cleanup writes no retention event');
select is(dblink_exec('mandate_holder','commit'),'COMMIT','retention fence releases');
select is(private.v2_redact_expired_mandate_reviews(
  'e0000000-0000-4000-8000-000000000001',1,'e0100000-0000-4000-8000-000000000001',1),
  1,'retry redacts the expired review after fence release');
select ok((select state='invalidated' and policy_summary is null from private.v2_mandate_reviews
  where review_id='e0500000-0000-4000-8000-000000000001'),'retry preserves the invalidated review fence');

insert into project_s_mandate_wait.state values ('revoke-review',
  project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000002'));
insert into project_s_mandate_wait.state values ('revoke-mandate',
  project_s_mandate_wait.approve('e0500000-0000-4000-8000-000000000002','e0600000-0000-4000-8000-000000000002'));
select is((select value->>'state' from project_s_mandate_wait.state where key='revoke-mandate'),'active',
  'positive control issues a live real mandate');
select is(dblink_exec('mandate_holder','begin'),'BEGIN','revoke holder begins');
select is(dblink_exec('mandate_holder',$revoke$do $$begin
  perform public.project_s_revoke_mandate_v2(project_s_mandate_wait.context(),
    'e0600000-0000-4000-8000-000000000002',1);
end;$$$revoke$),'DO','uncommitted revoke owns principal fence');
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.get('e0600000-0000-4000-8000-000000000002')::text$query$),1,
  'owner metadata read contends with revoke');
select ok(pg_temp.wait_for_mandate_lock((select pid from mandate_reader_pid)),
  'metadata reader is observed waiting for revoke serialization');
select is(dblink_exec('mandate_holder','commit'),'COMMIT','revoke commits before acknowledgement');
select ok(value::jsonb->>'state'='revoked' and value::jsonb->>'remainingUses'='0',
  'subsequently serialized owner read cannot see active usable authority')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);

-- A legacy host row or owner lock must refuse without adding an old/new wait
-- edge. The proof observes the conflicting lock and bounds the result wait.
select is(dblink_exec('mandate_holder','begin'),'BEGIN','legacy host row holder begins');
select is(dblink_exec('mandate_holder',$host$do $$begin
  perform id from public.profiles where id='e0100000-0000-4000-8000-000000000002' for update;
end;$$$host$),'DO','holder owns the legacy host profile row');
select throws_ok($$select id from public.profiles
  where id='e0100000-0000-4000-8000-000000000002' for key share nowait$$,'55P03',null,
  'conflicting host row lock is independently observed');
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000003')::text$query$),1,
  'review reaches contended legacy host row');
select ok(pg_temp.mandate_ready_without_wait((select pid from mandate_reader_pid)),
  'host NOWAIT denial returns before one-second timeout with no observed lock wait');
select is(value::jsonb->>'errorCode','PT503','legacy host contention maps to bounded authority-busy')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
select is(dblink_exec('mandate_holder','commit'),'COMMIT','legacy host row holder releases');

select is(dblink_exec('mandate_holder','begin'),'BEGIN','legacy owner-fence holder begins');
select is(dblink_exec('mandate_holder',$owner$do $$begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'e0100000-0000-4000-8000-000000000002',0));
end;$$$owner$),'DO','holder owns the same legacy schedule fence as host CRUD and v1');
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000003')::text$query$),1,
  'review reaches contended legacy owner fence');
select ok(pg_temp.mandate_ready_without_wait((select pid from mandate_reader_pid)),
  'try-lock refusal adds no blocking legacy owner wait edge');
select is(value::jsonb->>'errorCode','PT503','legacy owner-fence contention returns bounded authority-busy')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
select is(dblink_exec('mandate_holder','commit'),'COMMIT','legacy owner-fence holder releases');

select is(dblink_exec('mandate_holder','begin'),'BEGIN','credential-expiry holder begins');
select is(dblink_exec('mandate_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals
  where principal_id='e0100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','credential-expiry holder owns fence');
update project_s_mandate_wait.state set value=to_jsonb(clock_timestamp()+interval '400 milliseconds') where key='deadline';
update private.v2_actor_credentials set expires_at=(select (value #>> '{}')::timestamptz
  from project_s_mandate_wait.state where key='deadline') where credential_id='e0400000-0000-4000-8000-000000000001';
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000003')::text$query$),1,
  'new review starts before credential expiry');
select ok(pg_temp.wait_for_mandate_lock((select pid from mandate_reader_pid)),
  'review is observed waiting during credential expiry');
select ok(clock_timestamp() < (select (value #>> '{}')::timestamptz
  from project_s_mandate_wait.state where key='deadline'),'review reached fence while credential was live');
select pg_sleep(greatest(0,extract(epoch from (
  (select (value #>> '{}')::timestamptz from project_s_mandate_wait.state where key='deadline')
  +interval '30 milliseconds'-clock_timestamp()))::double precision));
select is(dblink_exec('mandate_holder','commit'),'COMMIT','credential-expiry fence releases after deadline');
select is(value::jsonb->>'errorCode','PT409','post-wait credential expiry denies new review')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
update private.v2_actor_credentials set expires_at=(select (value->>'expiresAt')::timestamptz
  from project_s_mandate_wait.state where key='actor') where credential_id='e0400000-0000-4000-8000-000000000001';

-- A wait on a referenced private row occurs after the initial principal/config
-- checks. An epoch changed during that later wait must still deny approval.
insert into project_s_mandate_wait.state values ('epoch-review',
  project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000006'));
select is(dblink_exec('mandate_holder','begin'),'BEGIN','late review-row wait holder begins');
select is(dblink_exec('mandate_holder',$reviewrow$do $$begin
  perform review_id from private.v2_mandate_reviews
  where review_id='e0500000-0000-4000-8000-000000000006' for update;
end;$$$reviewrow$),'DO','holder locks only the referenced review row, not the principal fence');
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.approve('e0500000-0000-4000-8000-000000000006',
    'e0600000-0000-4000-8000-000000000006')::text$query$),1,
  'approval passes initial live checks and reaches the locked review row');
select ok(pg_temp.wait_for_mandate_lock((select pid from mandate_reader_pid)),
  'approval is observed waiting on its referenced review after acquiring the principal fence');
update private.v2_authority_instance set epoch=2
  where instance_id='e0000000-0000-4000-8000-000000000001';
select is(dblink_exec('mandate_holder','commit'),'COMMIT','referenced review row releases after epoch change');
select is(value::jsonb->>'errorCode','PT401','final post-row-wait check denies invalidated epoch')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
update private.v2_authority_instance set epoch=1
  where instance_id='e0000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from private.v2_mandates
  where mandate_id='e0600000-0000-4000-8000-000000000006'),0,
  'late epoch invalidation commits no mandate or restored authority');

insert into project_s_mandate_wait.state values ('delete-review',
  project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000004'));
insert into project_s_mandate_wait.state values ('delete-mandate',
  project_s_mandate_wait.approve('e0500000-0000-4000-8000-000000000004','e0600000-0000-4000-8000-000000000004'));
insert into project_s_mandate_wait.state values ('pending-delete-review',
  project_s_mandate_wait.review('e0500000-0000-4000-8000-000000000005'));
select is(dblink_exec('mandate_holder','begin'),'BEGIN','profile deletion holder begins');
select is(dblink_exec('mandate_holder',$delete$do $$begin
  perform public.project_s_delete_booker_profile_v2(project_s_mandate_wait.context(),
    'e0200000-0000-4000-8000-000000000001',1);
end;$$$delete$),'DO','deletion invalidates dependents while retaining the principal fence');
select is(dblink_send_query('mandate_reader',$query$
  select project_s_mandate_wait.approve('e0500000-0000-4000-8000-000000000005',
    'e0600000-0000-4000-8000-000000000005')::text$query$),1,
  'pending exact approval contends with profile deletion');
select ok(pg_temp.wait_for_mandate_lock((select pid from mandate_reader_pid)),
  'approval is observed waiting for profile deletion serialization');
select is(dblink_exec('mandate_holder','commit'),'COMMIT','profile deletion commits');
select is(value::jsonb->>'errorCode','PT409','later approval cannot resurrect deleted reviewed authority')
  from dblink_get_result('mandate_reader') as result(value text);
select * from dblink_get_result('mandate_reader') as result(value text);
select ok((select state='revoked' and revision=2 from private.v2_mandates
  where mandate_id='e0600000-0000-4000-8000-000000000004'),
  'profile deletion also atomically revokes the preexisting active dependent');
select ok((select name is null and email is null and guest_time_zone is null from private.v2_booker_profiles
  where profile_id='e0200000-0000-4000-8000-000000000001'),'serialized delete leaves original profile PII erased');
select ok(not exists(select 1 from private.v2_mandate_reviews r
  where r.principal_id='e0100000-0000-4000-8000-000000000001'
    and to_jsonb(r)::text like '%mandate-waiting@example.invalid%'),
  'serialized deletion removes all retained pending-review PII copies');
select is((select count(*)::integer from private.v2_mandates
  where principal_id='e0100000-0000-4000-8000-000000000001'),2,
  'refused expiry, contention and deletion attempts create no extra authority');

select is(dblink_disconnect('mandate_reader'),'OK','mandate contender disconnects');
select is(dblink_disconnect('mandate_holder'),'OK','mandate holder disconnects');
delete from private.v2_mandates where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where principal_id='e0100000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='e0000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('e0100000-0000-4000-8000-000000000001','e0100000-0000-4000-8000-000000000002');
drop schema project_s_mandate_wait cascade;
select * from finish();
