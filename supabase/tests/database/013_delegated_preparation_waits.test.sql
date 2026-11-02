create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions,pg_catalog;
select no_plan();

-- This independent-session proof owns only its fixed synthetic partition.
delete from private.v2_delegated_preparations where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_requests where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_mandates where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='a8000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('a8100000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002');
drop schema if exists project_s_preparation_wait cascade;
create schema project_s_preparation_wait;
create table project_s_preparation_wait.state(key text primary key,value jsonb);
create function project_s_preparation_wait.principal() returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-preparation-wait',
    'principalId','a8100000-0000-4000-8000-000000000001','subjectId','a8100000-0000-4000-8000-000000000001',
    'instanceId','a8000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','http');
$$;
create function project_s_preparation_wait.actor() returns jsonb
language sql set search_path=pg_catalog as $$
  select project_s_preparation_wait.principal()||jsonb_build_object(
    'actorId','a8300000-0000-4000-8000-000000000001','credentialId','a8400000-0000-4000-8000-000000000001',
    'credentialRevision',1,'credentialFingerprint',repeat('d',64));
$$;
create function project_s_preparation_wait.prepare(p_request_key text default 'request') returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return public.project_s_prepare_delegated_booking_v2(project_s_preparation_wait.actor(),
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),
    (select value from project_s_preparation_wait.state where key=p_request_key));
exception when others then return jsonb_build_object('errorCode',sqlstate);
end;
$$;
create function pg_temp.wait_for_preparation_lock(p_pid integer) returns boolean
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
create function pg_temp.preparation_ready_without_wait(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare v_deadline timestamptz:=clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return false; end if;
    if extensions.dblink_is_busy('preparation_reader')=0 then return true; end if;
    exit when clock_timestamp()>=v_deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;
create function pg_temp.wait_past_preparation_deadline() returns void
language sql set search_path=pg_catalog as $$
  select pg_sleep(greatest(0,extract(epoch from (
    (select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline')
    +interval '30 milliseconds'-clock_timestamp()))::double precision));
$$;

insert into private.v2_authority_instance(instance_id,epoch,audience) values
  ('a8000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Preparation Wait Host','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values
  ('a8100000-0000-4000-8000-000000000001'::uuid,'preparation-wait-owner@example.invalid','preparation-wait-owner'),
  ('a8100000-0000-4000-8000-000000000002'::uuid,'preparation-wait-host@example.invalid','preparation-wait-host')) users(id,email,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,minimum_notice_minutes,active)
values('a8700000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002','Synthetic preparation wait meeting',30,0,true);
insert into project_s_preparation_wait.state values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values('a8100000-0000-4000-8000-000000000002',(select (value #>> '{}')::date from project_s_preparation_wait.state where key='day'),
  'available','09:00','17:00');
insert into project_s_preparation_wait.state values ('actor',public.project_s_register_actor_v2(
  project_s_preparation_wait.principal(),'a8300000-0000-4000-8000-000000000001','a8400000-0000-4000-8000-000000000001',
  decode(repeat('d',64),'hex'),'Synthetic preparation wait actor',clock_timestamp()+interval '2 days'));
insert into project_s_preparation_wait.state values ('profile',public.project_s_create_booker_profile_v2(
  project_s_preparation_wait.principal(),'a8200000-0000-4000-8000-000000000001',
  '{"name":"Synthetic Private Waiting Booker","email":"private-waiting-preparation@example.invalid","guestTimeZone":"UTC"}'));
insert into project_s_preparation_wait.state values ('start',to_jsonb(private.v2_mandate_instant(
  ((select (value #>> '{}')::date from project_s_preparation_wait.state where key='day')::timestamp at time zone 'UTC')+interval '10 hours')));
insert into project_s_preparation_wait.state values ('policy',jsonb_build_object(
  'actorId','a8300000-0000-4000-8000-000000000001','profileId','a8200000-0000-4000-8000-000000000001','profileRevision',1,
  'username','preparation-wait-host','meetingTypeId','a8700000-0000-4000-8000-000000000001',
  'meetingWindowStart',(select value #>> '{}' from project_s_preparation_wait.state where key='start'),
  'meetingWindowEnd',private.v2_mandate_instant((select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='start')+interval '4 hours'),
  'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(clock_timestamp()+interval '3 seconds'),
  'expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '1 hour')));
do $$
declare v_review jsonb; v_mandate jsonb; v_key text;
begin
  foreach v_key in array array['main','revoke','delete'] loop
    v_review:=public.project_s_create_mandate_review_v2(project_s_preparation_wait.principal(),extensions.gen_random_uuid(),
      (select value from project_s_preparation_wait.state where key='policy'));
    v_mandate:=public.project_s_approve_mandate_v2(project_s_preparation_wait.principal(),(v_review->>'reviewId')::uuid,
      extensions.gen_random_uuid(),1,v_review->>'summaryDigest');
    insert into project_s_preparation_wait.state values ('mandate-'||v_key,v_mandate);
    insert into project_s_preparation_wait.state values (case when v_key='main' then 'request' else 'request-'||v_key end,
      jsonb_build_object('mandateId',v_mandate->>'mandateId','username','preparation-wait-host',
        'meetingTypeId','a8700000-0000-4000-8000-000000000001',
        'startAt',(select value #>> '{}' from project_s_preparation_wait.state where key='start')));
  end loop;
end;$$;
select pg_sleep(greatest(0,extract(epoch from (
  (select (value->>'notBefore')::timestamptz from project_s_preparation_wait.state where key='policy')
  +interval '20 milliseconds'-clock_timestamp()))::double precision));
insert into project_s_preparation_wait.state select 'request-later',value||jsonb_build_object('startAt',
  private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '15 minutes'))
from project_s_preparation_wait.state where key='request';

select is(dblink_connect('preparation_holder',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','preparation holder connects');
select is(dblink_connect('preparation_reader',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','independent preparation contender connects');
create temporary table preparation_reader_pid(pid integer);
insert into preparation_reader_pid select pid from dblink('preparation_reader','select pg_backend_pid()') p(pid integer);

select is(dblink_exec('preparation_holder','begin'),'BEGIN','fresh-time holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='a8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the real issuing-principal fence');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare()::text$query$),1,
  'preparation starts while the authority fence is held');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),
  'preparation is observed waiting on the real principal fence');
insert into project_s_preparation_wait.state values ('release',to_jsonb(clock_timestamp()));
select is(dblink_exec('preparation_holder','commit'),'COMMIT','fresh-time fence releases');
insert into project_s_preparation_wait.state select 'prepared',value::jsonb
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select is((select value->>'kind' from project_s_preparation_wait.state where key='prepared'),'prepared','waited operation produces an in-scope preparation');
select ok((select created_at >= (select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='release')
  from private.v2_delegated_preparations where preparation_id=(select (value#>>'{data,preparationId}')::uuid
    from project_s_preparation_wait.state where key='prepared')),'creation time is sampled after the actual fence wait');
select is((select expires_at-created_at from private.v2_delegated_preparations where preparation_id=
  (select (value#>>'{data,preparationId}')::uuid from project_s_preparation_wait.state where key='prepared')),
  interval '10 minutes','ten-minute validity begins after the fence wait');

-- Expiry after a later referenced-row wait must not return the stale pending
-- identity. Re-preparing may create a fresh identity while permission remains live.
insert into project_s_preparation_wait.state values ('deadline',to_jsonb(clock_timestamp()+interval '400 milliseconds'));
update private.v2_delegated_preparations set expires_at=(select (value #>> '{}')::timestamptz
  from project_s_preparation_wait.state where key='deadline') where preparation_id=
  (select (value#>>'{data,preparationId}')::uuid from project_s_preparation_wait.state where key='prepared');
select is(dblink_exec('preparation_holder','begin'),'BEGIN','pending-expiry row holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform preparation_id from private.v2_delegated_preparations where preparation_id=
    (select (value#>>'{data,preparationId}')::uuid from project_s_preparation_wait.state where key='prepared') for update;
end;$$$lock$),'DO','holder locks the referenced existing pending preparation');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare()::text$query$),1,
  'exact pending retry reaches a later referenced-row wait');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'pending retry is observed waiting on the referenced row');
select ok(clock_timestamp()<(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline'),
  'pending retry reached the referenced row while its original preparation was live');
select pg_temp.wait_past_preparation_deadline();
update project_s_preparation_wait.state set value=to_jsonb(clock_timestamp()) where key='release';
select is(dblink_exec('preparation_holder','commit'),'COMMIT','pending row releases after its deadline');
insert into project_s_preparation_wait.state select 'fresh-preparation',value::jsonb
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select is((select value->>'kind' from project_s_preparation_wait.state where key='fresh-preparation'),'prepared','live permission may prepare again after prior pending expiry');
select isnt((select value#>>'{data,preparationId}' from project_s_preparation_wait.state where key='fresh-preparation'),
  (select value#>>'{data,preparationId}' from project_s_preparation_wait.state where key='prepared'),
  'post-wait expiry never reuses the expired preparation identity');
select ok((select created_at >= (select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='release')
  from private.v2_delegated_preparations where preparation_id=(select (value#>>'{data,preparationId}')::uuid
    from project_s_preparation_wait.state where key='fresh-preparation')),'replacement preparation receives a fresh post-row-wait timestamp');

select is(dblink_exec('preparation_holder','begin'),'BEGIN','late-epoch row holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform preparation_id from private.v2_delegated_preparations where preparation_id=
    (select (value#>>'{data,preparationId}')::uuid from project_s_preparation_wait.state where key='fresh-preparation') for update;
end;$$$lock$),'DO','late-epoch holder locks only the referenced row');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare()::text$query$),1,
  'retry passes its initial checks and reaches the locked pending row');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'late-epoch retry is observed waiting after its initial checks');
update private.v2_authority_instance set epoch=2 where instance_id='a8000000-0000-4000-8000-000000000001';
select is(dblink_exec('preparation_holder','commit'),'COMMIT','referenced row releases after epoch invalidation');
select is(value::jsonb->>'errorCode','PT401','final post-row-wait check refuses the stale instance epoch')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
update private.v2_authority_instance set epoch=1 where instance_id='a8000000-0000-4000-8000-000000000001';

-- A KEY SHARE prevents deletion but permits a non-key account-state update.
-- Its final live lookup must therefore run again after the referenced-row wait.
select is(dblink_exec('preparation_holder','begin'),'BEGIN','late-account row holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform preparation_id from private.v2_delegated_preparations where preparation_id=
    (select (value#>>'{data,preparationId}')::uuid from project_s_preparation_wait.state where key='fresh-preparation') for update;
end;$$$lock$),'DO','late-account holder owns the referenced pending row');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare()::text$query$),1,
  'retry begins before the concurrent live-account state change');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'account-state retry is observed waiting after initial authentication');
set lock_timeout='500ms';
select lives_ok($$update auth.users set is_anonymous=true where id='a8100000-0000-4000-8000-000000000001'$$,
  'non-key account-state change commits while the referenced preparation remains locked');
reset lock_timeout;
select is(dblink_exec('preparation_holder','commit'),'COMMIT','pending row releases after account-state change');
select is(value::jsonb->>'errorCode','PT401','final post-row-wait account lookup refuses newly anonymous principal')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
update auth.users set is_anonymous=false where id='a8100000-0000-4000-8000-000000000001';

-- Natural expiry while a real principal fence is held.
select is(dblink_exec('preparation_holder','begin'),'BEGIN','permission-expiry holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='a8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','permission-expiry holder owns the authority fence');
update project_s_preparation_wait.state set value=to_jsonb(clock_timestamp()+interval '400 milliseconds') where key='deadline';
update private.v2_mandates set expires_at=(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline')
  where mandate_id=(select (value->>'mandateId')::uuid from project_s_preparation_wait.state where key='mandate-main');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new intent starts before the original permission expires');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'new intent is observed waiting during permission expiry');
select ok(clock_timestamp()<(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline'),
  'new intent reached the authority fence before permission expiry');
select pg_temp.wait_past_preparation_deadline();
select is(dblink_exec('preparation_holder','commit'),'COMMIT','authority fence releases after permission expiry');
select is(value::jsonb->>'errorCode','PT410','fresh post-fence time refuses an expired active mandate')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
update private.v2_mandates set expires_at=(select (value->>'expiresAt')::timestamptz from project_s_preparation_wait.state where key='mandate-main')
  where mandate_id=(select (value->>'mandateId')::uuid from project_s_preparation_wait.state where key='mandate-main');

select is(dblink_exec('preparation_holder','begin'),'BEGIN','credential-expiry holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='a8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','credential-expiry holder owns the authority fence');
update project_s_preparation_wait.state set value=to_jsonb(clock_timestamp()+interval '400 milliseconds') where key='deadline';
update private.v2_actor_credentials set expires_at=(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline')
  where credential_id='a8400000-0000-4000-8000-000000000001';
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new intent starts before credential expiry');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'new intent is observed waiting during credential expiry');
select ok(clock_timestamp()<(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline'),
  'new intent reached the fence while its credential was live');
select pg_temp.wait_past_preparation_deadline();
select is(dblink_exec('preparation_holder','commit'),'COMMIT','credential fence releases after expiry');
select is(value::jsonb->>'errorCode','PT401','post-wait credential expiry fails authentication before preparing')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
update private.v2_actor_credentials set expires_at=(select (value->>'expiresAt')::timestamptz from project_s_preparation_wait.state where key='actor')
  where credential_id='a8400000-0000-4000-8000-000000000001';

select is(dblink_exec('preparation_holder','begin'),'BEGIN','profile-expiry holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='a8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','profile-expiry holder owns the authority fence');
update project_s_preparation_wait.state set value=to_jsonb(clock_timestamp()+interval '400 milliseconds') where key='deadline';
update private.v2_booker_profiles set expires_at=(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline')
  where profile_id='a8200000-0000-4000-8000-000000000001';
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new intent starts before reviewed-profile expiry');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'new intent is observed waiting during reviewed-profile expiry');
select ok(clock_timestamp()<(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline'),
  'new intent reached the fence while its reviewed profile was live');
select pg_temp.wait_past_preparation_deadline();
select is(dblink_exec('preparation_holder','commit'),'COMMIT','profile fence releases after expiry');
select is(value::jsonb->>'errorCode','PT403','post-wait profile expiry refuses preparation rather than producing a review')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
update private.v2_booker_profiles set expires_at=(select (value->>'expiresAt')::timestamptz from project_s_preparation_wait.state where key='profile')
  where profile_id='a8200000-0000-4000-8000-000000000001';

-- A trigger/index/FK boundary can wait after the ordinary admission clock.
-- Hold a real test-only audit-trigger gate and let permission expire during it.
create function project_s_preparation_wait.audit_gate() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if new.instance_id='a8000000-0000-4000-8000-000000000001' and new.action='preparation_created' then
    perform pg_advisory_xact_lock(hashtextextended('project-s:preparation:audit-gate-test',0));
  end if;
  return new;
end;
$$;
create trigger preparation_wait_audit_gate before insert on private.v2_authority_events
  for each row execute function project_s_preparation_wait.audit_gate();
insert into project_s_preparation_wait.state values
  ('audit-sequence-before',to_jsonb((select event_sequence from private.v2_authority_principals
    where principal_id='a8100000-0000-4000-8000-000000000001'))),
  ('audit-preparations-before',to_jsonb((select count(*) from private.v2_delegated_preparations
    where instance_id='a8000000-0000-4000-8000-000000000001'))),
  ('audit-events-before',to_jsonb((select count(*) from private.v2_authority_events
    where instance_id='a8000000-0000-4000-8000-000000000001')));
select is(dblink_exec('preparation_holder','begin'),'BEGIN','late-audit gate holder begins');
select is(dblink_exec('preparation_holder',$gate$do $$begin
  perform pg_advisory_xact_lock(hashtextextended('project-s:preparation:audit-gate-test',0));
end;$$$gate$),'DO','holder owns the actual advisory gate used by the test audit trigger');
update project_s_preparation_wait.state set value=to_jsonb(clock_timestamp()+interval '400 milliseconds') where key='deadline';
update private.v2_mandates set expires_at=(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline')
  where mandate_id=(select (value->>'mandateId')::uuid from project_s_preparation_wait.state where key='mandate-main');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new intent passes ordinary admission and reaches the gated audit insert');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),
  'new intent is observed waiting at the late audit boundary');
select ok(exists(select 1 from pg_locks where pid=(select pid from preparation_reader_pid)
  and locktype='advisory' and not granted),'the observed late wait is the held advisory audit gate');
select ok(clock_timestamp()<(select (value #>> '{}')::timestamptz from project_s_preparation_wait.state where key='deadline'),
  'permission was live when the operation reached the late audit gate');
select pg_temp.wait_past_preparation_deadline();
select is(dblink_exec('preparation_holder','commit'),'COMMIT','audit gate releases after permission expiry');
select is(value::jsonb->>'errorCode','PT410','final post-insert check refuses permission expired during audit insertion')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
drop trigger preparation_wait_audit_gate on private.v2_authority_events;
update private.v2_mandates set expires_at=(select (value->>'expiresAt')::timestamptz from project_s_preparation_wait.state where key='mandate-main')
  where mandate_id=(select (value->>'mandateId')::uuid from project_s_preparation_wait.state where key='mandate-main');
select is(to_jsonb((select event_sequence from private.v2_authority_principals
  where principal_id='a8100000-0000-4000-8000-000000000001')),
  (select value from project_s_preparation_wait.state where key='audit-sequence-before'),
  'late audit expiry rolls back principal event-sequence advancement');
select is(to_jsonb((select count(*) from private.v2_delegated_preparations
  where instance_id='a8000000-0000-4000-8000-000000000001')),
  (select value from project_s_preparation_wait.state where key='audit-preparations-before'),
  'late audit expiry leaves no new preparation row');
select is(to_jsonb((select count(*) from private.v2_authority_events
  where instance_id='a8000000-0000-4000-8000-000000000001')),
  (select value from project_s_preparation_wait.state where key='audit-events-before'),
  'late audit expiry leaves no authoritative success event');

-- Legacy row/owner contention must never add a blocking old/new wait edge.
select is(dblink_exec('preparation_holder','begin'),'BEGIN','legacy host row holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform id from public.profiles where id='a8100000-0000-4000-8000-000000000002' for update;
end;$$$lock$),'DO','holder owns the mutable legacy host row');
select throws_ok($$select id from public.profiles where id='a8100000-0000-4000-8000-000000000002' for key share nowait$$,
  '55P03',null,'host row contention is independently observed');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new preparation reaches the locked legacy host row');
select ok(pg_temp.preparation_ready_without_wait((select pid from preparation_reader_pid)),'host NOWAIT refusal completes without an observed blocking lock wait');
select is(value::jsonb->>'errorCode','PT503','host row contention maps to bounded authority-busy')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select is(dblink_exec('preparation_holder','commit'),'COMMIT','legacy host row holder releases');
select is(dblink_exec('preparation_holder','begin'),'BEGIN','legacy type row holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform id from public.meeting_types where id='a8700000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the mutable legacy meeting type row');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new preparation reaches the locked legacy meeting type');
select ok(pg_temp.preparation_ready_without_wait((select pid from preparation_reader_pid)),'meeting-type NOWAIT refusal completes without adding a blocking wait edge');
select is(value::jsonb->>'errorCode','PT503','meeting-type contention maps to bounded authority-busy')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select is(dblink_exec('preparation_holder','commit'),'COMMIT','legacy meeting type holder releases');
select is(dblink_exec('preparation_holder','begin'),'BEGIN','legacy owner-fence holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform pg_advisory_xact_lock(hashtextextended('a8100000-0000-4000-8000-000000000002',0));
end;$$$lock$),'DO','holder owns the same legacy schedule fence as v1 and host CRUD');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-later')::text$query$),1,
  'new preparation reaches the contended legacy owner fence');
select ok(pg_temp.preparation_ready_without_wait((select pid from preparation_reader_pid)),'owner try-lock refusal adds no blocking legacy owner wait');
select is(value::jsonb->>'errorCode','PT503','owner-fence contention maps to bounded authority-busy')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select is(dblink_exec('preparation_holder','commit'),'COMMIT','legacy owner-fence holder releases');

select is(dblink_exec('preparation_holder','begin'),'BEGIN','mandate-revoke holder begins');
select is(dblink_exec('preparation_holder',$revoke$do $$begin
  perform public.project_s_revoke_mandate_v2(project_s_preparation_wait.principal(),
    (select (value->>'mandateId')::uuid from project_s_preparation_wait.state where key='mandate-revoke'),1);
end;$$$revoke$),'DO','uncommitted mandate revoke holds the authority fence');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-revoke')::text$query$),1,
  'preparation contends with original mandate revocation');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'preparation is observed waiting for revoke serialization');
select is(dblink_exec('preparation_holder','commit'),'COMMIT','mandate revoke commits before acknowledgement');
select is(value::jsonb->>'errorCode','PT403','subsequently serialized prepare cannot use revoked authority')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);

insert into project_s_preparation_wait.state select 'request-outside',value||jsonb_build_object('startAt',
  private.v2_mandate_instant((value->>'startAt')::timestamptz-interval '15 minutes'))
from project_s_preparation_wait.state where key='request';
insert into project_s_preparation_wait.state values ('step-up',project_s_preparation_wait.prepare('request-outside'));
select is((select value->>'kind' from project_s_preparation_wait.state where key='step-up'),'step_up_required',
  'positive control creates an actual pending out-of-scope review');
select is(dblink_exec('preparation_holder','begin'),'BEGIN','profile-deletion holder begins');
select is(dblink_exec('preparation_holder',$delete$do $$begin
  perform public.project_s_delete_booker_profile_v2(project_s_preparation_wait.principal(),
    'a8200000-0000-4000-8000-000000000001',1);
end;$$$delete$),'DO','uncommitted profile deletion owns the shared principal fence');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare('request-delete')::text$query$),1,
  'new preparation contends with profile-dependent invalidation');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'new preparation is observed waiting for deletion serialization');
select is(dblink_exec('preparation_holder','commit'),'COMMIT','profile deletion and dependent invalidation commit together');
select is(value::jsonb->>'errorCode','PT403','later preparation cannot resurrect authority from the deleted profile')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select ok(not exists(select 1 from private.v2_delegated_preparations where
  instance_id='a8000000-0000-4000-8000-000000000001' and state='pending'),
  'serialized deletion leaves no pending linked preparation');
select ok(not exists(select 1 from private.v2_step_up_requests where
  instance_id='a8000000-0000-4000-8000-000000000001' and state='pending'),
  'serialized deletion leaves no pending linked step-up request');
select ok(not exists(select 1 from private.v2_delegated_preparations where
  instance_id='a8000000-0000-4000-8000-000000000001' and summary is not null),
  'serialized profile deletion clears all preparation summary copies including reviewed timezone');
select ok(not exists(select 1 from private.v2_step_up_requests where
  instance_id='a8000000-0000-4000-8000-000000000001' and summary is not null),
  'serialized profile deletion clears all step-up summary copies including reviewed timezone');
select ok(not exists(select 1 from private.v2_delegated_preparations d join private.v2_booker_profiles p
  on (d.instance_id,d.epoch,d.principal_id,d.profile_id)=(p.instance_id,p.epoch,p.principal_id,p.profile_id)
  where d.instance_id='a8000000-0000-4000-8000-000000000001'
    and (d.invalidated_at is distinct from p.deleted_at or d.invalidated_sequence is distinct from p.deleted_sequence)),
  'preparation invalidation shares the exact committed profile deletion time and ordered event');
select ok(not exists(select 1 from private.v2_step_up_requests r join private.v2_booker_profiles p
  on (r.instance_id,r.epoch,r.principal_id,r.profile_id)=(p.instance_id,p.epoch,p.principal_id,p.profile_id)
  where r.instance_id='a8000000-0000-4000-8000-000000000001'
    and (r.invalidated_at is distinct from p.deleted_at or r.invalidated_sequence is distinct from p.deleted_sequence)),
  'step-up invalidation shares the exact committed profile deletion time and ordered event');
select ok(not exists(select 1 from private.v2_delegated_preparations p where p.instance_id='a8000000-0000-4000-8000-000000000001'
  and to_jsonb(p)::text like '%private-waiting-preparation@example.invalid%'),
  'retained preparations copy no deleted reviewed-profile email');
select ok(not exists(select 1 from private.v2_step_up_requests r where r.instance_id='a8000000-0000-4000-8000-000000000001'
  and to_jsonb(r)::text like '%private-waiting-preparation@example.invalid%'),
  'retained step-up requests copy no deleted reviewed-profile email');

-- A real Auth deletion while admission waits at the principal fence must be
-- visible before any reused context can act, regardless of retained tombstones.
select is(dblink_exec('preparation_holder','begin'),'BEGIN','account-deletion fence holder begins');
select is(dblink_exec('preparation_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='a8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','holder owns the private authority fence without locking Auth');
select is(dblink_send_query('preparation_reader',$query$select project_s_preparation_wait.prepare()::text$query$),1,
  'old verified context starts while its live account still exists');
select ok(pg_temp.wait_for_preparation_lock((select pid from preparation_reader_pid)),'old context is observed waiting before the live Auth check');
delete from auth.users where id='a8100000-0000-4000-8000-000000000001';
select is(dblink_exec('preparation_holder','commit'),'COMMIT','authority fence releases after account deletion');
select is(value::jsonb->>'errorCode','PT401','actual account deletion denies a previously verified waiting context')
  from dblink_get_result('preparation_reader') result(value text);
select * from dblink_get_result('preparation_reader') result(value text);
select is((select count(*)::integer from public.bookings where user_id='a8100000-0000-4000-8000-000000000002'),0,
  'all actual waits, refusals and reviews leave the host booking table unchanged');
select is(dblink_disconnect('preparation_reader'),'OK','preparation contender disconnects');
select is(dblink_disconnect('preparation_holder'),'OK','preparation holder disconnects');

delete from private.v2_delegated_preparations where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_requests where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_mandates where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where instance_id='a8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='a8000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('a8100000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002');
drop schema project_s_preparation_wait cascade;
select * from finish();
