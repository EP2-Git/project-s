create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions,pg_catalog;
select no_plan();

-- Independent sessions require committed fixtures. Reset only this suite's
-- synthetic authority partition and Auth identities if an earlier run aborted.
delete from private.v2_delegated_preparations where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_step_up_requests where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_mandates where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='b8000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('b8100000-0000-4000-8000-000000000001',
  'b8100000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000003');
drop schema if exists project_s_step_up_read_test cascade;
create schema project_s_step_up_read_test;
create table project_s_step_up_read_test.state(key text primary key,value jsonb);

create function project_s_step_up_read_test.principal(p_other boolean default false) returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-step-up-review',
    'principalId',owner_id,'subjectId',owner_id,'instanceId','b8000000-0000-4000-8000-000000000001',
    'epoch',1,'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','ui')
  from (select case when p_other then 'b8100000-0000-4000-8000-000000000002'
    else 'b8100000-0000-4000-8000-000000000001' end) as principal(owner_id);
$$;

create function project_s_step_up_read_test.actor(p_number integer default 1) returns jsonb
language sql set search_path=pg_catalog as $$
  select project_s_step_up_read_test.principal()||jsonb_build_object('transport','http',
    'actorId','b8300000-0000-4000-8000-'||lpad(p_number::text,12,'0'),
    'credentialId','b8400000-0000-4000-8000-'||lpad(p_number::text,12,'0'),
    'credentialRevision',1,'credentialFingerprint',repeat(case p_number when 1 then 'a' else 'b' end,64));
$$;

create function project_s_step_up_read_test.read_result() returns jsonb
language plpgsql set search_path=pg_catalog as $$
begin
  return public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
    'b8500000-0000-4000-8000-000000000001');
exception when others then
  return jsonb_build_object('code',sqlstate,'message',sqlerrm);
end;
$$;

create function pg_temp.step_up_reader_waits(p_pid integer) returns boolean
language plpgsql set search_path=pg_catalog as $$
declare deadline timestamptz:=clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if exists(select 1 from pg_locks where pid=p_pid and not granted) then return true; end if;
    exit when clock_timestamp()>=deadline;
    perform pg_sleep(0.005);
  end loop;
  return false;
end;
$$;

-- The owner read must leave each row and its audit sequence intact.
create function pg_temp.step_up_snapshot() returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('reviews',(select jsonb_agg(to_jsonb(r) order by review_id) from private.v2_step_up_requests r
      where instance_id='b8000000-0000-4000-8000-000000000001'),
    'mandates',(select jsonb_agg(to_jsonb(m) order by mandate_id) from private.v2_mandates m
      where instance_id='b8000000-0000-4000-8000-000000000001'),
    'profiles',(select jsonb_agg(to_jsonb(p) order by profile_id) from private.v2_booker_profiles p
      where instance_id='b8000000-0000-4000-8000-000000000001'),
    'credentials',(select jsonb_agg(to_jsonb(c) order by credential_id) from private.v2_actor_credentials c
      where instance_id='b8000000-0000-4000-8000-000000000001'),
    'principals',(select jsonb_agg(to_jsonb(p) order by principal_id) from private.v2_authority_principals p
      where instance_id='b8000000-0000-4000-8000-000000000001'),
    'events',(select jsonb_agg(to_jsonb(e) order by principal_id,sequence) from private.v2_authority_events e
      where instance_id='b8000000-0000-4000-8000-000000000001'));
$$;

select ok(has_function_privilege('service_role','public.project_s_get_step_up_review_v2(jsonb,uuid)','EXECUTE'),
  'the trusted service can execute the private issuer read');
select ok(not has_function_privilege(role_name,'public.project_s_get_step_up_review_v2(jsonb,uuid)','EXECUTE'),
  role_name||' lacks direct issuer read access')
from (values('anon'),('authenticated')) as roles(role_name);
set role anon;
select throws_ok($$select public.project_s_get_step_up_review_v2('{}','b8500000-0000-4000-8000-000000000001')$$,
  '42501',null,'anonymous SQL caller cannot reach the issuer read');
reset role;
set role authenticated;
select throws_ok($$select public.project_s_get_step_up_review_v2('{}','b8500000-0000-4000-8000-000000000001')$$,
  '42501',null,'authenticated SQL caller cannot bypass the trusted issuer boundary');
reset role;

insert into private.v2_authority_instance(instance_id,epoch,audience)
values('b8000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',username||'@example.invalid',
  clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Step-Up Host','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values
  ('b8100000-0000-4000-8000-000000000001'::uuid,'step-up-review-owner'),
  ('b8100000-0000-4000-8000-000000000002'::uuid,'step-up-review-other'),
  ('b8100000-0000-4000-8000-000000000003'::uuid,'step-up-review-host')) as users(id,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,minimum_notice_minutes,active)
values('b8700000-0000-4000-8000-000000000001','b8100000-0000-4000-8000-000000000003','Synthetic review meeting',30,0,true);
insert into project_s_step_up_read_test.state values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values('b8100000-0000-4000-8000-000000000003',
  (select (value #>> '{}')::date from project_s_step_up_read_test.state where key='day'),'available','09:00','17:00');
select public.project_s_register_actor_v2(project_s_step_up_read_test.principal(),
  (a->>'actorId')::uuid,(a->>'credentialId')::uuid,decode(a->>'credentialFingerprint','hex'),
  'Synthetic step-up actor',clock_timestamp()+interval '2 days')
from (select project_s_step_up_read_test.actor(i) as a from generate_series(1,2) i) as actors;
select public.project_s_create_booker_profile_v2(project_s_step_up_read_test.principal(),
  'b8200000-0000-4000-8000-000000000001',
  '{"name":"  Synthetic Private Booker  ","email":"OWNER-PRIVATE-REVIEW@example.invalid","guestTimeZone":"America/Halifax"}');
select public.project_s_create_booker_profile_v2(project_s_step_up_read_test.principal(true),
  'b8200000-0000-4000-8000-000000000002',
  '{"name":"Synthetic Foreign Booker","email":"foreign-private-review@example.invalid","guestTimeZone":"UTC"}');

do $$
declare
  fixture record;
  issuer_review jsonb;
  mandate jsonb;
  permission jsonb;
  requested_day date;
  day_start timestamptz;
  permission_start timestamptz:=clock_timestamp()+interval '5 seconds';
begin
  select (value #>> '{}')::date into requested_day from project_s_step_up_read_test.state where key='day';
  day_start:=requested_day::timestamp at time zone 'UTC';
  for fixture in select * from (values('main',1,1),('mandate-revoke',2,1),('actor-revoke',3,2)) as cases(key,id,actor) loop
    permission:=jsonb_build_object('actorId',project_s_step_up_read_test.actor(fixture.actor)->>'actorId',
      'profileId','b8200000-0000-4000-8000-000000000001','profileRevision',1,
      'username','step-up-review-host','meetingTypeId','b8700000-0000-4000-8000-000000000001',
      'meetingWindowStart',private.v2_mandate_instant(day_start+interval '10 hours'),
      'meetingWindowEnd',private.v2_mandate_instant(day_start+interval '14 hours'),
      'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
      'expiresAt',private.v2_mandate_instant(permission_start+interval '1 hour'));
    issuer_review:=public.project_s_create_mandate_review_v2(project_s_step_up_read_test.principal(),
      extensions.gen_random_uuid(),permission);
    mandate:=public.project_s_approve_mandate_v2(project_s_step_up_read_test.principal(),
      (issuer_review->>'reviewId')::uuid,extensions.gen_random_uuid(),1,issuer_review->>'summaryDigest');
    insert into project_s_step_up_read_test.state values ('mandate-'||fixture.key,mandate);
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start+interval '20 milliseconds'-clock_timestamp())))::double precision);
  for fixture in select * from (values('main',1,1),('mandate-revoke',2,1),('actor-revoke',3,2)) as cases(key,id,actor) loop
    select value into mandate from project_s_step_up_read_test.state where key='mandate-'||fixture.key;
    insert into project_s_step_up_read_test.state values ('actor-result-'||fixture.key,
      public.project_s_prepare_delegated_booking_v2(project_s_step_up_read_test.actor(fixture.actor),
        extensions.gen_random_uuid(),('b8500000-0000-4000-8000-'||lpad(fixture.id::text,12,'0'))::uuid,
        jsonb_build_object('mandateId',mandate->>'mandateId','username','step-up-review-host',
          'meetingTypeId','b8700000-0000-4000-8000-000000000001',
          'startAt',private.v2_mandate_instant(day_start+interval '9 hours 45 minutes'))));
  end loop;
end;
$$;

select is(value->>'kind','step_up_required',key||' is a genuine actor-created pending review')
from project_s_step_up_read_test.state where key like 'actor-result-%' order by key;
select is((select array_agg(key order by key) from jsonb_object_keys(value->'stepUp') as fields(key)),
  array['expiresAt','reviewId','reviewUrl'],'the actor receives only the opaque review reference')
from project_s_step_up_read_test.state where key='actor-result-main';

insert into project_s_step_up_read_test.state values ('before-reads',pg_temp.step_up_snapshot());
insert into project_s_step_up_read_test.state values ('owner-result',public.project_s_get_step_up_review_v2(
  project_s_step_up_read_test.principal(),'b8500000-0000-4000-8000-000000000001'));
select is(value-'exactSummary'-'differences',jsonb_build_object('reviewId',r.review_id,'revision',1,'state','pending',
  'summaryDigest',r.summary_digest,'expiresAt',private.v2_mandate_instant(r.expires_at)),
  'issuer envelope contains the exact pending identity, digest and unchanged expiry')
from project_s_step_up_read_test.state s cross join private.v2_step_up_requests r
where s.key='owner-result' and r.review_id='b8500000-0000-4000-8000-000000000001';
with scheduled as (
  select ((value #>> '{}')::date::timestamp at time zone 'UTC') as day_start
  from project_s_step_up_read_test.state where key='day'
)
select is(value->'exactSummary',jsonb_build_object('username','step-up-review-host','hostDisplayName','Synthetic Step-Up Host',
  'meetingTypeId','b8700000-0000-4000-8000-000000000001','meetingTypeTitle','Synthetic review meeting',
  'startAt',private.v2_mandate_instant(day_start+interval '9 hours 45 minutes'),
  'endAt',private.v2_mandate_instant(day_start+interval '10 hours 15 minutes'),
  'hostTimeZone','UTC','guestTimeZone','America/Halifax','name','Synthetic Private Booker',
  'email','owner-private-review@example.invalid'),
  'the owner receives precisely the reviewed profile and recorded host, type and times')
from project_s_step_up_read_test.state cross join scheduled where key='owner-result';
select is(value->'differences',jsonb_build_array(jsonb_build_object('field','meeting_window',
  'proposed',(value#>>'{exactSummary,startAt}')||' / '||(value#>>'{exactSummary,endAt}'),
  'reviewed',(m.policy->>'meetingWindowStart')||' / '||(m.policy->>'meetingWindowEnd'))),
  'issuer sees the exact reviewed and proposed window display difference')
from project_s_step_up_read_test.state s cross join private.v2_mandates m
where s.key='owner-result' and m.mandate_id=(select (value->>'mandateId')::uuid
  from project_s_step_up_read_test.state where key='mandate-main');
select is(public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000001'),
  (select value from project_s_step_up_read_test.state where key='owner-result'),
  'repeated owner read returns the same pending review without refreshing it');
select ok(pg_temp.step_up_snapshot()=(select value from project_s_step_up_read_test.state where key='before-reads'),
  'reads leave reviews, mandates, profiles, credentials, events and sequences unchanged');

-- Only the source fields defined by the issuer contract may cross the read
-- boundary, even if a private record contains additional legacy JSON keys.
insert into project_s_step_up_read_test.state
select 'projection-source',to_jsonb(r) from private.v2_step_up_requests r
where review_id='b8500000-0000-4000-8000-000000000001';
update private.v2_step_up_requests set
  summary=summary||'{"name":"Copied Profile Name","email":"copied-profile@example.invalid","hostId":"synthetic-private-owner"}'::jsonb,
  differences=jsonb_set(differences,'{0,credentialId}',to_jsonb('synthetic-private-reference'::text))
where review_id='b8500000-0000-4000-8000-000000000001';
select is(public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000001'),
  (select value from project_s_step_up_read_test.state where key='owner-result'),
  'extra stored fields are omitted and reviewed name and email come from the live owned profile');
update private.v2_step_up_requests set differences=jsonb_set(differences,'{0,field}',to_jsonb('credential'::text))
where review_id='b8500000-0000-4000-8000-000000000001';
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000001')$$,'PT409','VERSION_CONFLICT','unknown difference field fails closed');
update private.v2_step_up_requests r set summary=s.value->'summary',differences=s.value->'differences'
from project_s_step_up_read_test.state s where s.key='projection-source'
  and r.review_id='b8500000-0000-4000-8000-000000000001';

select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.actor(),
  'b8500000-0000-4000-8000-000000000001')$$,'PT401','AUTHENTICATION_REQUIRED','actor context cannot reveal issuer-only PII');
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(true),
  'b8500000-0000-4000-8000-000000000001')$$,'PT403','FORBIDDEN','another live principal cannot read a known private review');
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000099')$$,'PT403','FORBIDDEN','missing review uses the same denial as a foreign review');
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),null)$$,
  'PT400','VALIDATION_ERROR','authenticated read requires a review identifier');
update private.v2_authority_instance set epoch=2 where instance_id='b8000000-0000-4000-8000-000000000001';
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000001')$$,'PT401','AUTHENTICATION_REQUIRED','old instance epoch cannot read the retained review');
update private.v2_authority_instance set epoch=1 where instance_id='b8000000-0000-4000-8000-000000000001';

-- Expire each supporting row while the review itself remains pending and live.
do $$
declare
  support record;
  original_expiry timestamptz;
begin
  for support in select * from (values
    ('v2_actor_credentials','credential_id','b8400000-0000-4000-8000-000000000001'::uuid),
    ('v2_booker_profiles','profile_id','b8200000-0000-4000-8000-000000000001'::uuid),
    ('v2_mandates','mandate_id',(select (value->>'mandateId')::uuid
      from project_s_step_up_read_test.state where key='mandate-main'))) as supports(table_name,id_column,id_value)
  loop
    execute format('select expires_at from private.%I where %I=$1',support.table_name,support.id_column)
      into original_expiry using support.id_value;
    execute format('update private.%I set expires_at=clock_timestamp()-interval ''1 millisecond'' where %I=$1',
      support.table_name,support.id_column) using support.id_value;
    insert into project_s_step_up_read_test.state values ('expired-'||support.table_name,project_s_step_up_read_test.read_result());
    execute format('update private.%I set expires_at=$2 where %I=$1',support.table_name,support.id_column)
      using support.id_value,original_expiry;
  end loop;
end;
$$;
select is(value,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,key||' denies disclosure despite a pending live review')
from project_s_step_up_read_test.state where key like 'expired-%' order by key;

select public.project_s_revoke_mandate_v2(project_s_step_up_read_test.principal(),
  (select (value->>'mandateId')::uuid from project_s_step_up_read_test.state where key='mandate-mandate-revoke'),1);
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000002')$$,'PT409','VERSION_CONFLICT','revoking the original mandate closes review disclosure');
select public.project_s_revoke_actor_v2(project_s_step_up_read_test.principal(),'b8300000-0000-4000-8000-000000000002',1);
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000003')$$,'PT409','VERSION_CONFLICT','revoking the bound actor closes review disclosure');

select is(dblink_connect('step_up_holder',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','independent step-up holder connects');
select is(dblink_connect('step_up_reader',format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',current_database())),
  'OK','independent issuer reader connects');
create temporary table step_up_reader_pid(pid integer);
insert into step_up_reader_pid select pid from dblink('step_up_reader','select pg_backend_pid()') as reader(pid integer);

select is(dblink_exec('step_up_holder','begin'),'BEGIN','expiry holder begins');
select is(dblink_exec('step_up_holder',$lock$do $$begin
  perform 1 from private.v2_authority_principals where principal_id='b8100000-0000-4000-8000-000000000001' for update;
end;$$$lock$),'DO','expiry holder owns the live issuer fence');
insert into project_s_step_up_read_test.state values ('deadline',to_jsonb(clock_timestamp()+interval '400 milliseconds'));
update private.v2_step_up_requests set expires_at=(select (value #>> '{}')::timestamptz
  from project_s_step_up_read_test.state where key='deadline') where review_id='b8500000-0000-4000-8000-000000000001';
select is(dblink_send_query('step_up_reader','select project_s_step_up_read_test.read_result()::text'),1,
  'issuer read starts while the review is live');
select ok(pg_temp.step_up_reader_waits((select pid from step_up_reader_pid)),
  'the independent issuer read is observed waiting at the real fence');
select ok(clock_timestamp()<(select (value #>> '{}')::timestamptz from project_s_step_up_read_test.state where key='deadline'),
  'the reader reached the fence before the review deadline');
select pg_sleep(greatest(0,extract(epoch from ((select (value #>> '{}')::timestamptz
  from project_s_step_up_read_test.state where key='deadline')+interval '30 milliseconds'-clock_timestamp())))::double precision);
select is(dblink_exec('step_up_holder','commit'),'COMMIT','the issuer fence releases after review expiry');
select is(value::jsonb,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,
  'post-wait expiry refuses instead of disclosing the exact summary')
from dblink_get_result('step_up_reader') as result(value text);
select * from dblink_get_result('step_up_reader') as result(value text);
update private.v2_step_up_requests set expires_at=(select (value->>'expiresAt')::timestamptz
  from project_s_step_up_read_test.state where key='owner-result') where review_id='b8500000-0000-4000-8000-000000000001';

select is(dblink_exec('step_up_holder','begin'),'BEGIN','profile-deletion holder begins');
select is(dblink_exec('step_up_holder',$delete$do $$begin
  perform public.project_s_delete_booker_profile_v2(project_s_step_up_read_test.principal(),
    'b8200000-0000-4000-8000-000000000001',1);
end;$$$delete$),'DO','uncommitted real profile deletion owns the issuer fence');
select is(dblink_send_query('step_up_reader','select project_s_step_up_read_test.read_result()::text'),1,
  'issuer read starts while deletion is in flight');
select ok(pg_temp.step_up_reader_waits((select pid from step_up_reader_pid)),
  'the reader is observed waiting for serialized profile deletion');
select is(dblink_exec('step_up_holder','commit'),'COMMIT','profile deletion and dependent redaction commit together');
select is(value::jsonb,'{"code":"PT409","message":"VERSION_CONFLICT"}'::jsonb,
  'serialized owner read cannot recover the deleted profile or stale summary')
from dblink_get_result('step_up_reader') as result(value text);
select * from dblink_get_result('step_up_reader') as result(value text);
select ok((select state='invalidated' and summary is null from private.v2_step_up_requests
  where review_id='b8500000-0000-4000-8000-000000000001'),'profile deletion invalidates and clears the stored review summary');
select is(dblink_disconnect('step_up_reader'),'OK','independent issuer reader disconnects');
select is(dblink_disconnect('step_up_holder'),'OK','independent step-up holder disconnects');

delete from auth.users where id='b8100000-0000-4000-8000-000000000001';
select throws_ok($$select public.project_s_get_step_up_review_v2(project_s_step_up_read_test.principal(),
  'b8500000-0000-4000-8000-000000000001')$$,'PT401','AUTHENTICATION_REQUIRED','a deleted Auth account cannot use its old issuer context');
select is((select count(*) from private.v2_delegated_preparations where instance_id='b8000000-0000-4000-8000-000000000001'),
  0::bigint,'step-up references and issuer reads create no preparation');
select is((select count(*) from public.bookings where user_id='b8100000-0000-4000-8000-000000000003'),
  0::bigint,'step-up references and issuer reads create no booking');

delete from private.v2_step_up_requests where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_mandates where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_mandate_reviews where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_actor_credentials where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_booker_profiles where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_events where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_principals where instance_id='b8000000-0000-4000-8000-000000000001';
delete from private.v2_authority_instance where instance_id='b8000000-0000-4000-8000-000000000001';
delete from auth.users where id in ('b8100000-0000-4000-8000-000000000002','b8100000-0000-4000-8000-000000000003');
drop schema project_s_step_up_read_test cascade;
select * from finish();
