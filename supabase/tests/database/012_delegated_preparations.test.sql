begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- Every identity, booking and policy below belongs to this rollback-only fixture.
create temporary table preparation_results(key text primary key,value jsonb) on commit drop;
create function pg_temp.preparation_principal(p_other boolean default false) returns jsonb
language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-preparation-test',
    'principalId',case when p_other then 'f1000000-0000-4000-8000-000000000002' else 'f1000000-0000-4000-8000-000000000001' end,
    'subjectId',case when p_other then 'f1000000-0000-4000-8000-000000000002' else 'f1000000-0000-4000-8000-000000000001' end,
    'instanceId','f0000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','http');
$$;
create function pg_temp.preparation_actor(p_actor integer default 1) returns jsonb
language sql set search_path=pg_catalog as $$
  select pg_temp.preparation_principal(p_actor=2)||jsonb_build_object(
    'actorId',format('f3000000-0000-4000-8000-%s',lpad(p_actor::text,12,'0')),
    'credentialId',format('f4000000-0000-4000-8000-%s',lpad(p_actor::text,12,'0')),
    'credentialRevision',1,'credentialFingerprint',repeat(case p_actor when 1 then 'a' when 2 then 'b' else 'c' end,64));
$$;
create function pg_temp.prepare_delegated(p_request jsonb default null,p_context jsonb default null,
  p_preparation uuid default null,p_review uuid default null) returns jsonb
language sql set search_path=pg_catalog as $$
  select public.project_s_prepare_delegated_booking_v2(coalesce(p_context,pg_temp.preparation_actor()),
    coalesce(p_preparation,extensions.gen_random_uuid()),coalesce(p_review,extensions.gen_random_uuid()),
    coalesce(p_request,(select value from pg_temp.preparation_results where key='request')));
$$;
create function pg_temp.issue_preparation_mandate(p_policy jsonb,p_other boolean default false) returns jsonb
language plpgsql set search_path=pg_catalog as $$
declare v_review jsonb;
begin
  v_review:=public.project_s_create_mandate_review_v2(pg_temp.preparation_principal(p_other),extensions.gen_random_uuid(),p_policy);
  return public.project_s_approve_mandate_v2(pg_temp.preparation_principal(p_other),(v_review->>'reviewId')::uuid,
    extensions.gen_random_uuid(),1,v_review->>'summaryDigest');
end;
$$;

select is((select count(*)::integer from private.v2_authority_instance),0,
  'preparation migration does not configure an authority instance');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.v2_delegated_preparations'::regclass,'private.v2_step_up_requests'::regclass)),
  'both new preparation/review tables enable default-deny RLS');
select is((select count(*)::integer from pg_policy where polrelid in (
  'private.v2_delegated_preparations'::regclass,'private.v2_step_up_requests'::regclass)),0,
  'no client policy exposes private preparations or step-up requests');
select ok(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),
  role_name||' has no direct access to '||table_name)
from (values('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values('private.v2_delegated_preparations'),('private.v2_step_up_requests')) tables(table_name);
select ok(not has_function_privilege(role_name,
  'public.project_s_prepare_delegated_booking_v2(jsonb,uuid,uuid,jsonb)','EXECUTE'),
  role_name||' cannot invoke the privileged preparation RPC')
from (values('anon'),('authenticated')) roles(role_name);
select ok(has_function_privilege('service_role',
  'public.project_s_prepare_delegated_booking_v2(jsonb,uuid,uuid,jsonb)','EXECUTE'),
  'trusted server alone may invoke preparation');
set local role anon;
select throws_ok($$select public.project_s_prepare_delegated_booking_v2('{}',
  'f5000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001','{}')$$,
  '42501',null,'anonymous direct preparation is denied');
reset role;
set local role authenticated;
select throws_ok($$select public.project_s_prepare_delegated_booking_v2('{}',
  'f5000000-0000-4000-8000-000000000001','f6000000-0000-4000-8000-000000000001','{}')$$,
  '42501',null,'authenticated direct preparation is denied');
reset role;
select is((select count(*)::integer from pg_constraint where contype='f'
  and conrelid in ('private.v2_delegated_preparations'::regclass,'private.v2_step_up_requests'::regclass)
  and confrelid not in ('private.v2_authority_principals'::regclass,'private.v2_authority_events'::regclass,
    'private.v2_actor_credentials'::regclass,'private.v2_booker_profiles'::regclass,'private.v2_mandates'::regclass)),0,
  'new preparation references never add a legacy Auth/profile/type/booking FK or cascade');

insert into private.v2_authority_instance(instance_id,epoch,audience) values
  ('f0000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Preparation Host','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values
  ('f1000000-0000-4000-8000-000000000001'::uuid,'preparation-owner-a@example.invalid','preparation-owner-a'),
  ('f1000000-0000-4000-8000-000000000002'::uuid,'preparation-owner-b@example.invalid','preparation-owner-b'),
  ('f1000000-0000-4000-8000-000000000003'::uuid,'preparation-host-a@example.invalid','preparation-host-a'),
  ('f1000000-0000-4000-8000-000000000004'::uuid,'preparation-host-b@example.invalid','preparation-host-b')) users(id,email,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,minimum_notice_minutes,active) values
  ('f7000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000003','Synthetic preparation meeting',30,0,true),
  ('f7000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000003','Another public preparation type',30,0,true),
  ('f7000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000004','Another public host meeting',30,0,true);
insert into preparation_results values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
select id,(select (value #>> '{}')::date from preparation_results where key='day'),'available','09:00','17:00'
from (values('f1000000-0000-4000-8000-000000000003'::uuid),('f1000000-0000-4000-8000-000000000004'::uuid)) hosts(id);
select public.project_s_register_actor_v2(pg_temp.preparation_principal(actor=2),
  format('f3000000-0000-4000-8000-%s',lpad(actor::text,12,'0'))::uuid,
  format('f4000000-0000-4000-8000-%s',lpad(actor::text,12,'0'))::uuid,
  decode(repeat(case actor when 1 then 'a' when 2 then 'b' else 'c' end,64),'hex'),
  'Synthetic preparation actor',clock_timestamp()+interval '2 days') from generate_series(1,3) actor;
select public.project_s_create_booker_profile_v2(pg_temp.preparation_principal(profile=2),
  format('f2000000-0000-4000-8000-%s',lpad(profile::text,12,'0'))::uuid,
  '{"name":"Synthetic Private Booker","email":"private-preparation@example.invalid","guestTimeZone":"America/Halifax"}')
from generate_series(1,3) profile;
insert into preparation_results values ('start',to_jsonb(private.v2_mandate_instant(
  ((select (value #>> '{}')::date from preparation_results where key='day')::timestamp at time zone 'UTC')+interval '10 hours')));
insert into preparation_results values ('policy',jsonb_build_object(
  'actorId','f3000000-0000-4000-8000-000000000001','profileId','f2000000-0000-4000-8000-000000000001','profileRevision',1,
  'username','preparation-host-a','meetingTypeId','f7000000-0000-4000-8000-000000000001',
  'meetingWindowStart',(select value #>> '{}' from preparation_results where key='start'),
  'meetingWindowEnd',private.v2_mandate_instant((select (value #>> '{}')::timestamptz from preparation_results where key='start')+interval '30 minutes'),
  'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(clock_timestamp()+interval '5 seconds'),
  'expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '1 hour')));
insert into preparation_results values ('mandate',pg_temp.issue_preparation_mandate((select value from preparation_results where key='policy')));
insert into preparation_results select 'wide-policy',value||jsonb_build_object(
  'meetingWindowStart',private.v2_mandate_instant((value->>'meetingWindowStart')::timestamptz-interval '1 hour'),
  'meetingWindowEnd',private.v2_mandate_instant((value->>'meetingWindowStart')::timestamptz+interval '7 hours'))
from preparation_results where key='policy';
insert into preparation_results values ('wide-mandate',pg_temp.issue_preparation_mandate((select value from preparation_results where key='wide-policy')));
insert into preparation_results values ('other-mandate',pg_temp.issue_preparation_mandate(
  (select value||'{"actorId":"f3000000-0000-4000-8000-000000000002","profileId":"f2000000-0000-4000-8000-000000000002"}' from preparation_results where key='policy'),true));
insert into preparation_results values ('rate-mandate',pg_temp.issue_preparation_mandate(
  (select value||'{"actorId":"f3000000-0000-4000-8000-000000000003","profileId":"f2000000-0000-4000-8000-000000000003"}' from preparation_results where key='wide-policy')));
insert into preparation_results values ('future-mandate',pg_temp.issue_preparation_mandate(
  (select value||jsonb_build_object('notBefore',private.v2_mandate_instant(clock_timestamp()+interval '1 minute')) from preparation_results where key='policy')));
insert into preparation_results values ('request',jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='mandate'),
  'username','preparation-host-a','meetingTypeId','f7000000-0000-4000-8000-000000000001',
  'startAt',(select value #>> '{}' from preparation_results where key='start')));
-- Wait only for the real, explicitly issued permission's not-before boundary.
select pg_sleep(greatest(0,extract(epoch from (
  (select (value->>'notBefore')::timestamptz from preparation_results where key='policy')
  +interval '20 milliseconds'-clock_timestamp()))::double precision));

select throws_ok(format('select pg_temp.prepare_delegated(p_context=>%L::jsonb)',
  (pg_temp.preparation_actor()||patch)::text),'PT401','AUTHENTICATION_REQUIRED',description)
from (values
  ('{"subjectId":"f1000000-0000-4000-8000-000000000002"}'::jsonb,'a different subject is not actor authority'),
  ('{"principalId":"f1000000-0000-4000-8000-000000000002"}'::jsonb,'principal override is not authority'),
  ('{"credentialFingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,'wrong verifier fingerprint refuses'),
  ('{"credentialRevision":2}'::jsonb,'stale credential revision refuses'),
  ('{"transport":"ui"}'::jsonb,'principal UI transport is not an actor context'),
  ('{"epoch":2}'::jsonb,'wrong epoch refuses'),
  ('{"confirmed":true}'::jsonb,'extra actor context fields refuse')) vectors(patch,description);
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_principal())$$,
  'PT401','AUTHENTICATION_REQUIRED','a verified principal context cannot impersonate the registered actor');
select throws_ok(format('select pg_temp.prepare_delegated(p_request=>%L::jsonb)',
  ((select value from preparation_results where key='request')||patch)::text),'PT400','VALIDATION_ERROR',description)
from (values
  ('{"confirmed":true}'::jsonb,'client confirmation cannot create permission'),
  ('{"booker":{"name":"Injected Booker"}}'::jsonb,'actor cannot replace reviewed booker details'),
  ('{"endAt":"2030-01-01T00:00:00.000000Z"}'::jsonb,'actor cannot select derived end time'),
  ('{"durationMinutes":30}'::jsonb,'actor cannot select derived duration'),
  ('{"username":" PREPARATION-HOST-A "}'::jsonb,'SQL refuses a noncanonical internal username'),
  ('{"startAt":"infinity"}'::jsonb,'unbounded requested start refuses')) vectors(patch,description);
select throws_ok($$select pg_temp.prepare_delegated(p_request=>'[]')$$,'PT400','VALIDATION_ERROR','raw array is not a preparation request');
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value-'startAt' from preparation_results where key='request'))$$,
  'PT400','VALIDATION_ERROR','missing requested start refuses');
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(2))$$,
  'PT403','FORBIDDEN','another live actor cannot use a known foreign mandate');
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value||'{"mandateId":"f8000000-0000-4000-8000-000000000099"}' from preparation_results where key='request'))$$,
  'PT403','FORBIDDEN','unknown mandate has the same bounded ownership refusal');
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object('mandateId',
  (select value->>'mandateId' from preparation_results where key='future-mandate')) from preparation_results where key='request'))$$,
  'PT403','FORBIDDEN','active permission before its not-before instant creates neither preparation nor review');
select is((select count(*)::integer from private.v2_delegated_preparations),0,'hard denials retain no preparation');
select is((select count(*)::integer from private.v2_step_up_requests),0,'hard denials retain no step-up review');

insert into preparation_results values ('prepared',pg_temp.prepare_delegated());
select is((select value->>'kind' from preparation_results where key='prepared'),'prepared',
  'meeting exactly on both inclusive outer window bounds is prepared');
select is((select value#>>'{data,summary,startAt}' from preparation_results where key='prepared'),
  (select value #>> '{}' from preparation_results where key='start'),'prepared start is canonical and exact');
select is((select value#>>'{data,summary,endAt}' from preparation_results where key='prepared'),
  (select value->>'meetingWindowEnd' from preparation_results where key='policy'),'end is derived from the current30-minute type');
select is((select value#>>'{data,summary,guestTimeZone}' from preparation_results where key='prepared'),'America/Halifax',
  'actor summary uses reviewed guest timezone without exposing name or email');
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value->'data' from preparation_results where key='prepared')) fields(key)),
  array['expiresAt','notHeld','preparationId','summary','summaryDigest'],'prepared result has the exact strict actor data shape');
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value#>'{data,summary}' from preparation_results where key='prepared')) fields(key)),
  array['endAt','guestTimeZone','hostDisplayName','hostTimeZone','meetingTypeId','meetingTypeTitle','startAt','username'],
  'actor summary contains only reviewed public display and time fields');
select is((select value#>>'{data,notHeld}' from preparation_results where key='prepared'),'true','preparation truthfully reserves no slot');
select is((select expires_at-created_at from private.v2_delegated_preparations
  where preparation_id=(select (value#>>'{data,preparationId}')::uuid from preparation_results where key='prepared')),
  interval '10 minutes','ordinary preparation lifetime is exactly ten minutes');
insert into preparation_results values ('sequence-before-retry',to_jsonb((select event_sequence from private.v2_authority_principals
  where principal_id='f1000000-0000-4000-8000-000000000001')));
select is(pg_temp.prepare_delegated(),(select value from preparation_results where key='prepared'),
  'same live caller/mandate/intent returns original pending identity and expiry despite fresh proposed IDs');
select is(to_jsonb((select event_sequence from private.v2_authority_principals
  where principal_id='f1000000-0000-4000-8000-000000000001')),
  (select value from preparation_results where key='sequence-before-retry'),'deduplication appends no second audit event');
select is((select count(*)::integer from public.bookings where user_id in (
  'f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000004')),0,
  'preparation never creates or holds an actual booking');
select is(public.project_s_get_mandate_v2(pg_temp.preparation_principal(),
  (select (value->>'mandateId')::uuid from preparation_results where key='mandate'))->>'remainingUses','1',
  'preparation and exact retries consume no booking budget');
select throws_ok($$select pg_temp.prepare_delegated(
  p_preparation=>(select (value#>>'{data,preparationId}')::uuid from preparation_results where key='prepared'),
  p_request=>(select value||jsonb_build_object('mandateId',(select value->>'mandateId' from preparation_results where key='wide-mandate'),
    'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '3 hours'))
    from preparation_results where key='request'))$$,'PT409','VERSION_CONFLICT',
  'a proposed existing preparation identity cannot substitute another immutable intent');
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '1 microsecond'))
  from preparation_results where key='request'))$$,'PT409','SLOT_UNAVAILABLE',
  'microsecond start precision is retained rather than rounded onto an available slot');
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value||'{"username":"missing-preparation-host"}'
  from preparation_results where key='request'))$$,'PT404','MEETING_TYPE_UNAVAILABLE',
  'an unavailable public host/type does not produce a fabricated step-up reference');

insert into preparation_results values ('outside-start',pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz-interval '15 minutes')) from preparation_results where key='request')));
insert into preparation_results values ('outside-end',pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '15 minutes')) from preparation_results where key='request')));
select is(value->>'kind','step_up_required',description)
from preparation_results join (values('outside-start','whole meeting cannot begin before the policy window'),
  ('outside-end','whole meeting cannot finish after the policy window')) cases(key,description) using(key);
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value->'stepUp' from preparation_results where key='outside-start')) fields(key)),
  array['expiresAt','reviewId','reviewUrl'],'actor escalation contains only an opaque strict review reference');
select is((select value#>>'{stepUp,reviewUrl}' from preparation_results where key='outside-start'),
  'http://127.0.0.1:54321/authority/review#review='||(select value#>>'{stepUp,reviewId}' from preparation_results where key='outside-start'),
  'review URL uses the configured origin and the exact stored opaque review ID');
select is((select expires_at-created_at from private.v2_step_up_requests
  where review_id=(select (value#>>'{stepUp,reviewId}')::uuid from preparation_results where key='outside-start')),
  interval '5 minutes','ordinary step-up request lifetime is exactly five minutes');
select is(pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz-interval '15 minutes')) from preparation_results where key='request')),
  (select value from preparation_results where key='outside-start'),'same pending out-of-scope intent deduplicates without extending its review');
select is(pg_temp.prepare_delegated(p_request=>(select value||'{"meetingTypeId":"f7000000-0000-4000-8000-000000000002"}' from preparation_results where key='request'))->>'kind',
  'step_up_required','another public meeting type requires principal step-up');
select is(pg_temp.prepare_delegated(p_request=>(select value||'{"username":"preparation-host-b","meetingTypeId":"f7000000-0000-4000-8000-000000000003"}' from preparation_results where key='request'))->>'kind',
  'step_up_required','another public host requires principal step-up');

update public.meeting_types set duration_minutes=15 where id='f7000000-0000-4000-8000-000000000001';
insert into preparation_results values ('changed-type',pg_temp.prepare_delegated());
select is((select value#>>'{data,summary,endAt}' from preparation_results where key='changed-type'),
  private.v2_mandate_instant((select (value #>> '{}')::timestamptz from preparation_results where key='start')+interval '15 minutes'),
  'new preparation derives changed current type duration rather than reusing old facts');
select isnt((select value#>>'{data,preparationId}' from preparation_results where key='changed-type'),
  (select value#>>'{data,preparationId}' from preparation_results where key='prepared'),
  'changed host facts require a new immutable preparation identity');
select is((select summary->>'endAt' from private.v2_delegated_preparations
  where preparation_id=(select (value#>>'{data,preparationId}')::uuid from preparation_results where key='prepared')),
  (select value->>'meetingWindowEnd' from preparation_results where key='policy'),'old preparation summary stays immutable');
update public.meeting_types set duration_minutes=45 where id='f7000000-0000-4000-8000-000000000001';
select is(pg_temp.prepare_delegated()->>'kind','step_up_required','derived duration beyond the maximum requires principal step-up');
update public.meeting_types set duration_minutes=30 where id='f7000000-0000-4000-8000-000000000001';
update public.meeting_types set minimum_notice_minutes=525600 where id='f7000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.prepare_delegated()$$,'PT409','OUTSIDE_BOOKING_WINDOW','fresh minimum notice remains authoritative');
update public.meeting_types set minimum_notice_minutes=0,maximum_advance_days=1 where id='f7000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.prepare_delegated()$$,'PT409','OUTSIDE_BOOKING_WINDOW','fresh maximum advance remains authoritative');
update public.meeting_types set maximum_advance_days=60 where id='f7000000-0000-4000-8000-000000000001';
insert into public.bookings(id,user_id,meeting_type_id,start_time,duration_minutes,booker_name,booker_email,
  guest_timezone,meeting_type_title,host_timezone,idempotency_key,request_fingerprint)
select 'f9000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000003',
  'f7000000-0000-4000-8000-000000000001',(select (value #>> '{}')::timestamptz from preparation_results where key='start'),30,
  'Synthetic Existing Guest','existing-preparation@example.invalid','UTC','Synthetic preparation meeting','UTC',
  extensions.gen_random_uuid(),decode(repeat('d',64),'hex');
select throws_ok($$select pg_temp.prepare_delegated()$$,'PT409','SLOT_UNAVAILABLE','fresh confirmed booking conflicts refuse without a slot hold');
delete from public.bookings where id='f9000000-0000-4000-8000-000000000001';

-- Fail the authoritative event insertion, not a mock gateway sink.
create function pg_temp.fail_preparation_audit() returns trigger language plpgsql as $$
begin raise exception sqlstate 'P0001' using message='synthetic preparation audit failure'; end;
$$;
insert into preparation_results values ('sequence-before-failure',to_jsonb((select event_sequence
  from private.v2_authority_principals where principal_id='f1000000-0000-4000-8000-000000000001')));
create trigger preparation_audit_failure before insert on private.v2_authority_events
  for each row execute function pg_temp.fail_preparation_audit();
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='wide-mandate'),
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '3 hours')) from preparation_results where key='request'))$$,
  'P0001','synthetic preparation audit failure','failed audit rolls back an in-scope preparation');
select throws_ok($$select pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='wide-mandate'),
  'username','preparation-host-b','meetingTypeId','f7000000-0000-4000-8000-000000000003',
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '4 hours')) from preparation_results where key='request'))$$,
  'P0001','synthetic preparation audit failure','failed audit rolls back a pending step-up request');
drop trigger preparation_audit_failure on private.v2_authority_events;
select is(to_jsonb((select event_sequence from private.v2_authority_principals
  where principal_id='f1000000-0000-4000-8000-000000000001')),
  (select value from preparation_results where key='sequence-before-failure'),'failed audit also rolls back ordered sequence advancement');
select is((select count(*)::integer from private.v2_delegated_preparations where request->>'startAt'=
  private.v2_mandate_instant((select (value #>> '{}')::timestamptz from preparation_results where key='start')+interval '3 hours')),0,
  'failed preparation retains no state or rate-budget record');
select is((select count(*)::integer from private.v2_step_up_requests where request->>'startAt'=
  private.v2_mandate_instant((select (value #>> '{}')::timestamptz from preparation_results where key='start')+interval '4 hours')),0,
  'failed escalation retains no state or rate-budget record');

insert into preparation_results values
  ('bounds-mandate-expiry',to_jsonb((select expires_at from private.v2_mandates
    where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='wide-mandate')))),
  ('bounds-credential-expiry',to_jsonb((select expires_at from private.v2_actor_credentials
    where credential_id='f4000000-0000-4000-8000-000000000001'))),
  ('bounds-profile-expiry',to_jsonb((select expires_at from private.v2_booker_profiles
    where profile_id='f2000000-0000-4000-8000-000000000001')));
update private.v2_mandates set expires_at=clock_timestamp()+interval '2 minutes'
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='wide-mandate');
insert into preparation_results values ('mandate-bound-preparation',pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='wide-mandate'),
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '4 hours')) from preparation_results where key='request')));
select is((select (value#>>'{data,expiresAt}')::timestamptz from preparation_results where key='mandate-bound-preparation'),
  (select expires_at from private.v2_mandates where mandate_id=(select (value->>'mandateId')::uuid
    from preparation_results where key='wide-mandate')),'shorter original mandate expiry bounds preparation lifetime');
update private.v2_actor_credentials set expires_at=clock_timestamp()+interval '90 seconds'
  where credential_id='f4000000-0000-4000-8000-000000000001';
insert into preparation_results values ('credential-bound-preparation',pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='wide-mandate'),
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '255 minutes')) from preparation_results where key='request')));
select is((select (value#>>'{data,expiresAt}')::timestamptz from preparation_results where key='credential-bound-preparation'),
  (select expires_at from private.v2_actor_credentials where credential_id='f4000000-0000-4000-8000-000000000001'),
  'shorter live credential expiry bounds preparation lifetime');
update private.v2_booker_profiles set expires_at=clock_timestamp()+interval '60 seconds'
  where profile_id='f2000000-0000-4000-8000-000000000001';
insert into preparation_results values ('profile-bound-review',pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '5 hours')) from preparation_results where key='request')));
select is((select (value#>>'{stepUp,expiresAt}')::timestamptz from preparation_results where key='profile-bound-review'),
  (select expires_at from private.v2_booker_profiles where profile_id='f2000000-0000-4000-8000-000000000001'),
  'shorter live reviewed-profile expiry bounds step-up review lifetime');
update private.v2_mandates set expires_at=(select (value #>> '{}')::timestamptz from preparation_results where key='bounds-mandate-expiry')
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='wide-mandate');
update private.v2_actor_credentials set expires_at=(select (value #>> '{}')::timestamptz from preparation_results where key='bounds-credential-expiry')
  where credential_id='f4000000-0000-4000-8000-000000000001';
update private.v2_booker_profiles set expires_at=(select (value #>> '{}')::timestamptz from preparation_results where key='bounds-profile-expiry')
  where profile_id='f2000000-0000-4000-8000-000000000001';

update private.v2_authority_principals set disabled=true where principal_id='f1000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.prepare_delegated()$$,'PT401','AUTHENTICATION_REQUIRED',
  'disabled principal cannot use an otherwise active actor and mandate');
update private.v2_authority_principals set disabled=false where principal_id='f1000000-0000-4000-8000-000000000001';

-- Expiry simulations adjust only these owned synthetic rows, never the clock
-- used by real wait tests in013 or a shared service configuration.
insert into preparation_results values ('original-expiry',to_jsonb((select expires_at from private.v2_mandates
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='mandate'))));
update private.v2_mandates set expires_at=clock_timestamp()-interval '1 millisecond'
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='mandate');
select throws_ok($$select pg_temp.prepare_delegated()$$,'PT410','MANDATE_EXPIRED','expired active permission is not automatic step-up');
update private.v2_mandates set expires_at=(select (value #>> '{}')::timestamptz from preparation_results where key='original-expiry')
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='mandate');
insert into preparation_results values ('credential-expiry',to_jsonb((select expires_at from private.v2_actor_credentials
  where credential_id='f4000000-0000-4000-8000-000000000001')));
update private.v2_actor_credentials set expires_at=clock_timestamp()-interval '1 millisecond'
  where credential_id='f4000000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.prepare_delegated()$$,'PT401','AUTHENTICATION_REQUIRED','live credential expiry denies even a pending exact retry');
update private.v2_actor_credentials set expires_at=(select (value #>> '{}')::timestamptz from preparation_results where key='credential-expiry')
  where credential_id='f4000000-0000-4000-8000-000000000001';

-- The cap is shared across all preparations/reviews for one actor, not per key.
insert into preparation_results
select 'rate-'||i,pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(3),p_request=>jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='rate-mandate'),
  'username','preparation-host-a','meetingTypeId','f7000000-0000-4000-8000-000000000001',
  'startAt',private.v2_mandate_instant((select (value #>> '{}')::timestamptz from preparation_results where key='start')
    -interval '1 hour'+i*interval '15 minutes'))) from generate_series(0,19) i;
select is((select count(*)::integer from private.v2_delegated_preparations where actor_id='f3000000-0000-4000-8000-000000000003'),20,
  'twenty distinct live pending preparations are allowed for the actor');
select is(pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(3),p_request=>jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='rate-mandate'),
  'username','preparation-host-a','meetingTypeId','f7000000-0000-4000-8000-000000000001',
  'startAt',private.v2_mandate_instant((select (value #>> '{}')::timestamptz from preparation_results where key='start')-interval '1 hour'))),
  (select value from preparation_results where key='rate-0'),'exact pending retry still succeeds at the cap without creating another record');
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(3),p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='rate-mandate'),
  'startAt',private.v2_mandate_instant((value->>'startAt')::timestamptz+interval '4 hours')) from preparation_results where key='request'))$$,
  'PT429','RATE_LIMITED','twenty-first live pending preparation is refused');
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(3),p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='rate-mandate'),
  'meetingTypeId','f7000000-0000-4000-8000-000000000002') from preparation_results where key='request'))$$,
  'PT429','RATE_LIMITED','an out-of-scope review cannot bypass the shared pending cap');

select lives_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.preparation_principal(),
  'f2000000-0000-4000-8000-000000000003',1)$$,'profile deletion invalidates twenty owned preparations atomically');
select ok(not exists(select 1 from private.v2_delegated_preparations
  where profile_id='f2000000-0000-4000-8000-000000000003' and state='pending'),
  'deleted profile leaves no pending preparation usable');
select ok(not exists(select 1 from private.v2_delegated_preparations
  where profile_id='f2000000-0000-4000-8000-000000000003' and summary is not null),
  'profile deletion also removes cached summaries containing its reviewed timezone');
select public.project_s_create_booker_profile_v2(pg_temp.preparation_principal(),
  'f2000000-0000-4000-8000-000000000004',
  '{"name":"Replacement Synthetic Booker","email":"replacement-preparation@example.invalid","guestTimeZone":"UTC"}');
insert into preparation_results values ('replacement-rate-mandate',pg_temp.issue_preparation_mandate((select value||jsonb_build_object(
  'actorId','f3000000-0000-4000-8000-000000000003','profileId','f2000000-0000-4000-8000-000000000004',
  'notBefore',private.v2_mandate_instant(clock_timestamp()+interval '1 second'),
  'expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '1 hour')) from preparation_results where key='wide-policy')));
select pg_sleep(greatest(0,extract(epoch from ((select (policy->>'notBefore')::timestamptz from private.v2_mandates
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='replacement-rate-mandate'))
  +interval '20 milliseconds'-clock_timestamp()))::double precision));
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(3),p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='replacement-rate-mandate')) from preparation_results where key='request'))$$,
  'PT429','RATE_LIMITED','new profile and mandate cannot bypass recent actor creation rate after invalidation');
update private.v2_delegated_preparations set created_at=created_at-interval '11 minutes',expires_at=expires_at-interval '11 minutes'
  where actor_id='f3000000-0000-4000-8000-000000000003';
select is(pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(3),p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='replacement-rate-mandate')) from preparation_results where key='request'))->>'kind',
  'prepared','expired records outside the creation window need no successful cleanup worker before new preparation');

-- Existing reviewed-profile spellings must reach the actual UTC slot search.
-- They are presentation preferences, not a reason to reinterpret the instant.
create temporary table preparation_zone_vectors(key text primary key,profile_id uuid,zone text) on commit drop;
insert into preparation_zone_vectors values
  ('offset','f2000000-0000-4000-8000-000000000005','+01:00'),
  ('alias','f2000000-0000-4000-8000-000000000006','US/Eastern'),
  ('case','f2000000-0000-4000-8000-000000000007','utc');
insert into preparation_results
select 'zone-profile-'||key,public.project_s_create_booker_profile_v2(pg_temp.preparation_principal(true),profile_id,
  jsonb_build_object('name','Synthetic Timezone Booker','email','zone-preparation@example.invalid','guestTimeZone',zone))
from preparation_zone_vectors;
insert into preparation_results
select 'zone-mandate-'||z.key,pg_temp.issue_preparation_mandate(p.value||jsonb_build_object(
  'actorId','f3000000-0000-4000-8000-000000000002','profileId',z.profile_id,
  'notBefore',private.v2_mandate_instant(clock_timestamp()+interval '1 second')),true)
from preparation_zone_vectors z cross join preparation_results p where p.key='policy';
select pg_sleep(greatest(0,extract(epoch from ((select max((m.policy->>'notBefore')::timestamptz)
  from private.v2_mandates m join preparation_zone_vectors z on m.profile_id=z.profile_id)
  +interval '20 milliseconds'-clock_timestamp()))::double precision));
insert into preparation_results
select 'zone-prepared-'||z.key,pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(2),
  p_request=>r.value||jsonb_build_object('mandateId',m.value->>'mandateId'))
from preparation_zone_vectors z join preparation_results m on m.key='zone-mandate-'||z.key
  cross join preparation_results r where r.key='request';
select is(r.value->>'kind','prepared',z.zone||' reviewed preference reaches a genuine current slot preparation')
from preparation_zone_vectors z join preparation_results r on r.key='zone-prepared-'||z.key;
select is(r.value#>>'{data,summary,guestTimeZone}',z.zone,z.zone||' reviewed spelling is preserved exactly in the actor summary')
from preparation_zone_vectors z join preparation_results r on r.key='zone-prepared-'||z.key;
select is(p.guest_time_zone,z.zone,z.zone||' profile retains the exact accepted reviewed timezone')
from preparation_zone_vectors z join private.v2_booker_profiles p on p.profile_id=z.profile_id;
select is(r.value#>>'{data,summary,startAt}',s.value#>>'{}',z.zone||' preference does not shift the requested UTC meeting instant')
from preparation_zone_vectors z join preparation_results r on r.key='zone-prepared-'||z.key
  cross join preparation_results s where s.key='start';

-- Public names and caller-chosen type UUIDs may be reclaimed after an Auth
-- deletion. The original grant must still bind the original resolved host ID.
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
values('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000005',
  'authenticated','authenticated','original-reused-host@example.invalid',clock_timestamp(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"preparation-reused-host","full_name":"Synthetic Reused Host","timezone":"UTC"}',
  clock_timestamp(),clock_timestamp(),'','','','',false);
insert into public.meeting_types(id,user_id,title,duration_minutes,minimum_notice_minutes,active)
values('f7000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000005','Synthetic reused type',30,0,true);
insert into preparation_results values ('reused-host-mandate',pg_temp.issue_preparation_mandate((select value||jsonb_build_object(
  'username','preparation-reused-host','meetingTypeId','f7000000-0000-4000-8000-000000000004',
  'notBefore',private.v2_mandate_instant(clock_timestamp()+interval '1 second'),
  'expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '1 hour')) from preparation_results where key='wide-policy')));
select pg_sleep(greatest(0,extract(epoch from ((select (policy->>'notBefore')::timestamptz from private.v2_mandates
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='reused-host-mandate'))
  +interval '20 milliseconds'-clock_timestamp()))::double precision));
delete from auth.users where id='f1000000-0000-4000-8000-000000000005';
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
values('00000000-0000-0000-0000-000000000000','f1000000-0000-4000-8000-000000000006',
  'authenticated','authenticated','replacement-reused-host@example.invalid',clock_timestamp(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"preparation-reused-host","full_name":"Synthetic Reused Host","timezone":"UTC"}',
  clock_timestamp(),clock_timestamp(),'','','','',false);
insert into public.meeting_types(id,user_id,title,duration_minutes,minimum_notice_minutes,active)
values('f7000000-0000-4000-8000-000000000004','f1000000-0000-4000-8000-000000000006','Synthetic reused type',30,0,true);
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values('f1000000-0000-4000-8000-000000000006',(select (value #>> '{}')::date from preparation_results where key='day'),
  'available','09:00','17:00');
select ok(exists(select 1 from private.compute_free_slots_v1('preparation-reused-host',
  'f7000000-0000-4000-8000-000000000004',(select (value #>> '{}')::date from preparation_results where key='day'),'UTC',clock_timestamp())
  where slot_start=(select (value #>> '{}')::timestamptz from preparation_results where key='start')),
  'reclaimed username/type has a genuine current public slot as a positive control');
insert into preparation_results values ('reused-host-stepup',pg_temp.prepare_delegated(p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='reused-host-mandate'),
  'username','preparation-reused-host','meetingTypeId','f7000000-0000-4000-8000-000000000004') from preparation_results where key='request')));
select is((select value->>'kind' from preparation_results where key='reused-host-stepup'),'step_up_required',
  'same public username and type UUID owned by a different host cannot inherit the original permission');
select ok((select differences @> '[{"field":"host"}]'::jsonb from private.v2_step_up_requests
  where review_id=(select (value#>>'{stepUp,reviewId}')::uuid from preparation_results where key='reused-host-stepup')),
  'issuer differences record the changed resolved host even when its public name is identical');
select is((select host_snapshot->>'hostId' from private.v2_mandates
  where mandate_id=(select (value->>'mandateId')::uuid from preparation_results where key='reused-host-mandate')),
  'f1000000-0000-4000-8000-000000000005','original immutable mandate retains the deleted original host binding');
select ok((select value::text not like '%f1000000-0000-4000-8000-000000000005%'
  and value::text not like '%f1000000-0000-4000-8000-000000000006%' from preparation_results where key='reused-host-stepup'),
  'actor escalation response reveals neither original nor replacement host UUID');

select lives_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.preparation_principal(),
  'f2000000-0000-4000-8000-000000000001',1)$$,'profile deletion invalidates its pending preparation and review records');
select ok(not exists(select 1 from private.v2_delegated_preparations
  where profile_id='f2000000-0000-4000-8000-000000000001' and state='pending'),
  'no linked preparation stays pending after acknowledged profile deletion');
select ok(not exists(select 1 from private.v2_step_up_requests
  where profile_id='f2000000-0000-4000-8000-000000000001' and state='pending'),
  'no linked step-up request stays pending after acknowledged profile deletion');
select ok(not exists(select 1 from private.v2_delegated_preparations
  where profile_id='f2000000-0000-4000-8000-000000000001' and summary is not null),
  'profile deletion removes every cached preparation summary, including reviewed timezone');
select ok(not exists(select 1 from private.v2_step_up_requests
  where profile_id='f2000000-0000-4000-8000-000000000001' and summary is not null),
  'profile deletion removes every cached step-up summary, including reviewed timezone');
select ok(not exists(select 1 from private.v2_delegated_preparations p
  where to_jsonb(p)::text like '%Synthetic Private Booker%' or to_jsonb(p)::text like '%private-preparation@example.invalid%'),
  'preparation storage contains no copied profile name/email');
select ok(not exists(select 1 from private.v2_step_up_requests r
  where to_jsonb(r)::text like '%Synthetic Private Booker%' or to_jsonb(r)::text like '%private-preparation@example.invalid%'),
  'step-up storage contains no copied profile name/email');
select is((select string_agg(attname,',' order by attnum) from pg_attribute where
  attrelid='private.v2_authority_events'::regclass and attnum>0 and not attisdropped),
  'instance_id,epoch,principal_id,sequence,action,occurred_at','authority events keep their minimal private field allowlist');
select public.project_s_revoke_actor_v2(pg_temp.preparation_principal(true),'f3000000-0000-4000-8000-000000000002',1);
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(2),p_request=>(select value||jsonb_build_object(
  'mandateId',(select value->>'mandateId' from preparation_results where key='other-mandate')) from preparation_results where key='request'))$$,
  'PT401','AUTHENTICATION_REQUIRED','revoked credential cannot use its own otherwise live authority');
delete from auth.users where id='f1000000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.prepare_delegated(p_context=>pg_temp.preparation_actor(2))$$,
  'PT401','AUTHENTICATION_REQUIRED','deleted Auth account cannot use retained authority references');
select is((select count(*)::integer from public.bookings where user_id in (
  'f1000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000004')),0,
  'all prepare/escalate/refusal paths leave actual booking state unchanged');

select * from finish();
rollback;
