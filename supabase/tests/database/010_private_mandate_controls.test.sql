begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- All accounts, policies and display details are isolated synthetic fixtures.
create function pg_temp.mandate_context(
  p_principal uuid default 'd0100000-0000-4000-8000-000000000001'
) returns jsonb language sql set search_path=pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-mandate-test',
    'principalId',p_principal,'subjectId',p_principal,
    'instanceId','d0000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'transport','http');
$$;
create temporary table mandate_results(key text primary key,value jsonb) on commit drop;
insert into mandate_results values ('policy',jsonb_build_object(
  'actorId','d0300000-0000-4000-8000-000000000001',
  'profileId','d0200000-0000-4000-8000-000000000001','profileRevision',1,
  'username','mandate-synthetic-host','meetingTypeId','d0700000-0000-4000-8000-000000000001',
  'meetingWindowStart',to_char((statement_timestamp()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'meetingWindowEnd',to_char((statement_timestamp()+interval '2 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'maxDurationMinutes',30,
  'notBefore',to_char((statement_timestamp()+interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'expiresAt',to_char((statement_timestamp()+interval '1 hour') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
create function pg_temp.mandate_review(
  p_review uuid default 'd0500000-0000-4000-8000-000000000001',
  p_policy jsonb default null,p_context jsonb default null
) returns jsonb language sql set search_path=pg_catalog as $$
  select public.project_s_create_mandate_review_v2(coalesce(p_context,pg_temp.mandate_context()),
    p_review,coalesce(p_policy,(select value from pg_temp.mandate_results where key='policy')));
$$;
create function pg_temp.mandate_approve(
  p_review uuid default 'd0500000-0000-4000-8000-000000000001',
  p_mandate uuid default 'd0600000-0000-4000-8000-000000000001',
  p_revision bigint default 1,p_digest text default null,p_context jsonb default null
) returns jsonb language sql set search_path=pg_catalog as $$
  select public.project_s_approve_mandate_v2(coalesce(p_context,pg_temp.mandate_context()),
    p_review,p_mandate,p_revision,coalesce(p_digest,
      (select value->>'summaryDigest' from pg_temp.mandate_results where key='review')));
$$;

select is((select count(*)::integer from private.v2_authority_instance),0,
  'mandate migration does not configure or enable an authority instance');
select throws_ok($$select pg_temp.mandate_review()$$,'PT401','AUTHENTICATION_REQUIRED',
  'unconfigured authority refuses review');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.v2_mandate_reviews'::regclass,'private.v2_mandates'::regclass)),
  'mandate and review tables both enable RLS');
select is((select count(*)::integer from pg_policy where polrelid in (
  'private.v2_mandate_reviews'::regclass,'private.v2_mandates'::regclass)),0,
  'no client RLS policy exposes private mandates or review PII');
select ok(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),
  role_name||' has no direct table access to '||table_name)
from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('private.v2_mandate_reviews'),('private.v2_mandates')) tables(table_name);
select ok(not has_function_privilege(role_name,fn,'EXECUTE'),role_name||' cannot directly call '||fn)
from (values ('anon'),('authenticated')) roles(role_name)
cross join (values
  ('public.project_s_create_mandate_review_v2(jsonb,uuid,jsonb)'),
  ('public.project_s_approve_mandate_v2(jsonb,uuid,uuid,bigint,text)'),
  ('public.project_s_get_mandate_v2(jsonb,uuid)'),
  ('public.project_s_revoke_mandate_v2(jsonb,uuid,bigint)')) functions(fn);
select ok(has_function_privilege('service_role',fn,'EXECUTE'),'trusted server may call '||fn)
from (values
  ('public.project_s_create_mandate_review_v2(jsonb,uuid,jsonb)'),
  ('public.project_s_approve_mandate_v2(jsonb,uuid,uuid,bigint,text)'),
  ('public.project_s_get_mandate_v2(jsonb,uuid)'),
  ('public.project_s_revoke_mandate_v2(jsonb,uuid,bigint)')) functions(fn);
set local role anon;
select throws_ok($$select public.project_s_create_mandate_review_v2('{}',
  'd0500000-0000-4000-8000-000000000001','{}')$$,'42501',null,
  'anonymous direct review is denied before context interpretation');
select throws_ok($$select public.project_s_get_mandate_v2('{}',
  'd0600000-0000-4000-8000-000000000001')$$,'42501',null,
  'anonymous direct metadata lookup is denied');
reset role;
set local role authenticated;
select throws_ok($$select public.project_s_approve_mandate_v2('{}',
  'd0500000-0000-4000-8000-000000000001','d0600000-0000-4000-8000-000000000001',1,repeat('a',64))$$,
  '42501',null,'ordinary account cannot call privileged approval directly');
select throws_ok($$select public.project_s_revoke_mandate_v2('{}',
  'd0600000-0000-4000-8000-000000000001',1)$$,'42501',null,
  'ordinary account cannot call privileged revoke directly');
reset role;
select is((select count(*)::integer from pg_constraint where contype='f'
  and conrelid in ('private.v2_mandate_reviews'::regclass,'private.v2_mandates'::regclass)
  and confrelid not in ('private.v2_authority_principals'::regclass,
    'private.v2_authority_events'::regclass,'private.v2_actor_credentials'::regclass,
    'private.v2_booker_profiles'::regclass,'private.v2_mandate_reviews'::regclass,
    'private.v2_mandates'::regclass)),0,
  'no mandate or review foreign key enters legacy Auth, profiles, meeting types or bookings');

insert into private.v2_authority_instance(instance_id,epoch,audience) values
  ('d0000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Mandate Host','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values
  ('d0100000-0000-4000-8000-000000000001'::uuid,'mandate-owner-a@example.invalid','mandate-owner-a'),
  ('d0100000-0000-4000-8000-000000000002'::uuid,'mandate-owner-b@example.invalid','mandate-owner-b'),
  ('d0100000-0000-4000-8000-000000000003'::uuid,'mandate-host@example.invalid','mandate-synthetic-host'))
  owners(id,email,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,active) values
  ('d0700000-0000-4000-8000-000000000001','d0100000-0000-4000-8000-000000000003','Synthetic mandate meeting',30,true);
select public.project_s_register_actor_v2(pg_temp.mandate_context(),
  'd0300000-0000-4000-8000-000000000001','d0400000-0000-4000-8000-000000000001',
  decode(repeat('a',64),'hex'),'Synthetic mandate actor',clock_timestamp()+interval '2 days');
select public.project_s_create_booker_profile_v2(pg_temp.mandate_context(),
  'd0200000-0000-4000-8000-000000000001',
  '{"name":"Synthetic Reviewed Booker","email":"reviewed-booker@example.invalid","guestTimeZone":"America/Halifax"}');
select public.project_s_register_actor_v2(pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'),
  'd0300000-0000-4000-8000-000000000002','d0400000-0000-4000-8000-000000000002',
  decode(repeat('b',64),'hex'),'Other synthetic actor',clock_timestamp()+interval '2 days');
select public.project_s_create_booker_profile_v2(pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'),
  'd0200000-0000-4000-8000-000000000002',
  '{"name":"Other Reviewed Booker","email":"other-booker@example.invalid","guestTimeZone":"UTC"}');

select throws_ok($$select pg_temp.mandate_review(p_context=>pg_temp.mandate_context()||
  '{"actorId":"d0300000-0000-4000-8000-000000000001"}')$$,'PT401','AUTHENTICATION_REQUIRED',
  'actor identity is not principal control authority');
select throws_ok($$select pg_temp.mandate_review(p_context=>pg_temp.mandate_context()||
  '{"subjectId":"d0100000-0000-4000-8000-000000000002"}')$$,'PT401','AUTHENTICATION_REQUIRED',
  'control caller cannot override the subject');
select throws_ok($$select pg_temp.mandate_review(p_context=>pg_temp.mandate_context()||'{"epoch":2}')$$,
  'PT401','AUTHENTICATION_REQUIRED','wrong epoch cannot create a review');
select throws_ok(format('select pg_temp.mandate_review(p_policy=>%L::jsonb)',
  ((select value from mandate_results where key='policy')||patch)::text),
  'PT400','VALIDATION_ERROR',description)
from (values
  ('{"confirmed":true}'::jsonb,'client confirmation flag is not authority'),
  ('{"notes":"private notes"}'::jsonb,'review inputs do not accept notes'),
  ('{"principalId":"d0100000-0000-4000-8000-000000000002"}'::jsonb,'body cannot override principal'),
  ('{"maxDurationMinutes":4}'::jsonb,'duration below five minutes refuses'),
  ('{"maxDurationMinutes":1441}'::jsonb,'duration above one day refuses'),
  ('{"maxDurationMinutes":30.5}'::jsonb,'fractional duration refuses'),
  ('{"profileRevision":0}'::jsonb,'nonpositive profile revision refuses'),
  ('{"expiresAt":"infinity"}'::jsonb,'unbounded expiry refuses'),
  ('{"actorId":null}'::jsonb,'null actor reference refuses')) vectors(patch,description);
select throws_ok($$select pg_temp.mandate_review(p_policy=>
  (select value-'username' from mandate_results where key='policy'))$$,'PT400','VALIDATION_ERROR',
  'required policy field cannot be omitted');
select throws_ok($$select pg_temp.mandate_review(p_policy=>'[]')$$,'PT400','VALIDATION_ERROR',
  'raw array cannot be a policy');
select throws_ok(format('select pg_temp.mandate_review(p_policy=>%L::jsonb)',
  ((select value from mandate_results where key='policy')||patch)::text),
  expected_code,expected_message,description)
from (values
  (jsonb_build_object('notBefore',private.v2_mandate_instant(clock_timestamp()-interval '1 minute')),
    'PT409','VERSION_CONFLICT',
    'permission cannot begin before fresh issuance'),
  (jsonb_build_object('expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '25 hours')),
    'PT400','VALIDATION_ERROR',
    'permission expiry cannot exceed fresh issue time plus 24 hours'),
  (jsonb_build_object('expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '5 minutes')),
    'PT400','VALIDATION_ERROR',
    'permission expiry must follow not-before'),
  (jsonb_build_object('meetingWindowEnd',private.v2_mandate_instant(clock_timestamp())),
    'PT400','VALIDATION_ERROR',
    'meeting window must have strictly ordered bounds')) vectors(patch,expected_code,expected_message,description);

insert into mandate_results values ('review',pg_temp.mandate_review());
select is((select value->>'revision' from mandate_results where key='review'),'1',
  'server creates review revision one');
select ok((select (value->>'summaryDigest') ~ '^[0-9a-f]{64}$' from mandate_results where key='review'),
  'summary digest is canonical lowercase SHA-256');
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value from mandate_results where key='review')) keys(key)),
  array['expiresAt','policySummary','reviewId','revision','summaryDigest'],
  'review acknowledgement is the strict principal-only review shape');
select is((select value->'policySummary'->>'name' from mandate_results where key='review'),
  'Synthetic Reviewed Booker','summary uses the stored reviewed name');
select is((select value->'policySummary'->>'email' from mandate_results where key='review'),
  'reviewed-booker@example.invalid','summary uses the stored reviewed email');
select is((select value->'policySummary'->>'hostDisplayName' from mandate_results where key='review'),
  'Synthetic Mandate Host','summary resolves current public host display name');
select is((select value->'policySummary'->>'meetingTypeTitle' from mandate_results where key='review'),
  'Synthetic mandate meeting','summary resolves current public meeting type title');
select ok((select (value->>'expiresAt')::timestamptz > statement_timestamp()
  and (value->>'expiresAt')::timestamptz <= clock_timestamp()+interval '5 minutes'
  from mandate_results where key='review'),'pending review has a finite five-minute ceiling');
select is(pg_temp.mandate_review(),(select value from mandate_results where key='review'),
  'same internal review identity and exact policy returns the original review without extending expiry');
select throws_ok($$select pg_temp.mandate_review(p_policy=>
  (select value||'{"maxDurationMinutes":45}' from mandate_results where key='policy'))$$,
  'PT409','VERSION_CONFLICT','same review identity cannot substitute a different policy');
select throws_ok($$select pg_temp.mandate_approve(p_digest=>repeat('0',64))$$,
  'PT409','VERSION_CONFLICT','wrong summary digest cannot approve');
select throws_ok($$select pg_temp.mandate_approve(p_revision=>2)$$,
  'PT409','VERSION_CONFLICT','stale approval revision cannot approve');
select is((select count(*)::integer from private.v2_mandates),0,'refused approvals create no mandate');

-- Foreign and missing references have indistinguishable bounded refusals.
select throws_ok(format('select pg_temp.mandate_review(p_policy=>%L::jsonb)',
  ((select value from mandate_results where key='policy')||patch)::text),
  'PT403','FORBIDDEN',description)
from (values
  ('{"actorId":"d0300000-0000-4000-8000-000000000002"}'::jsonb,'foreign actor cannot be assigned authority'),
  ('{"actorId":"d0300000-0000-4000-8000-000000000099"}'::jsonb,'missing actor has the same refusal'),
  ('{"profileId":"d0200000-0000-4000-8000-000000000002"}'::jsonb,'foreign profile cannot enter policy'),
  ('{"profileId":"d0200000-0000-4000-8000-000000000099"}'::jsonb,'missing profile has the same refusal'))
  vectors(patch,description);
select throws_ok($$select pg_temp.mandate_approve(p_context=>
  pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,'PT403','FORBIDDEN',
  'other principal cannot approve a known foreign review');
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000099',
  p_context=>pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,'PT403','FORBIDDEN',
  'unknown review has the same ownership refusal');

-- A public host change makes a previously displayed approval stale.
update public.meeting_types set title='Changed synthetic meeting' where id='d0700000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.mandate_approve()$$,'PT409','VERSION_CONFLICT',
  'changed public meeting summary cannot be approved from an old digest');
insert into mandate_results values ('fresh-review',pg_temp.mandate_review('d0500000-0000-4000-8000-000000000002'));
select isnt((select value->>'summaryDigest' from mandate_results where key='fresh-review'),
  (select value->>'summaryDigest' from mandate_results where key='review'),
  'new current-host review has a different server digest');
create function pg_temp.fail_mandate_audit() returns trigger language plpgsql as $$
begin raise exception sqlstate 'P0001' using message='synthetic mandate audit failure'; end;
$$;
insert into mandate_results values ('sequence-before-failure',to_jsonb((select event_sequence
  from private.v2_authority_principals where principal_id='d0100000-0000-4000-8000-000000000001')));
create trigger mandate_audit_failure before insert on private.v2_authority_events
  for each row execute function pg_temp.fail_mandate_audit();
select throws_ok($$select pg_temp.mandate_review('d0500000-0000-4000-8000-000000000099')$$,
  'P0001','synthetic mandate audit failure','audit failure rolls back new pending review');
select is((select count(*)::integer from private.v2_mandate_reviews
  where review_id='d0500000-0000-4000-8000-000000000099'),0,'failed review creates no retained state');
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000002',
  p_digest=>(select value->>'summaryDigest' from mandate_results where key='fresh-review'))$$,
  'P0001','synthetic mandate audit failure','audit failure rolls back approval');
select is((select count(*)::integer from private.v2_mandates),0,'failed approval creates no mandate budget');
select is((select state from private.v2_mandate_reviews where review_id='d0500000-0000-4000-8000-000000000002'),
  'pending','failed approval leaves original pending review');
select is(to_jsonb((select event_sequence from private.v2_authority_principals
  where principal_id='d0100000-0000-4000-8000-000000000001')),
  (select value from mandate_results where key='sequence-before-failure'),
  'audit failures roll back principal event-sequence advancement');
drop trigger mandate_audit_failure on private.v2_authority_events;
insert into mandate_results values ('approved',pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000002',
  p_digest=>(select value->>'summaryDigest' from mandate_results where key='fresh-review')));
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value from mandate_results where key='approved')) keys(key)),
  array['expiresAt','issuedAt','mandateId','revision','state'],
  'approval exposes only mandate metadata and no reviewed PII');
select is((select value->>'state' from mandate_results where key='approved'),'active',
  'exact reviewed approval creates active mandate');
select is(pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000002',
  p_digest=>(select value->>'summaryDigest' from mandate_results where key='fresh-review')),
  (select value from mandate_results where key='approved'),
  'exact approval retry returns the original mandate without another budget');
select is((select count(*)::integer from private.v2_mandates),1,
  'approval retries cannot create a second mandate');
select is(pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000002',
  'd0600000-0000-4000-8000-000000000099',p_digest=>(select value->>'summaryDigest' from mandate_results where key='fresh-review')),
  (select value from mandate_results where key='approved'),
  'uncertain approval reconciles original mandate even if an adapter proposes a fresh internal UUID');
select ok((select policy_summary is null from private.v2_mandate_reviews
  where review_id='d0500000-0000-4000-8000-000000000002'),
  'successful approval redacts copied review PII while retaining immutable linkage');
insert into mandate_results values ('metadata',public.project_s_get_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001'));
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value from mandate_results where key='metadata')) keys(key)),
  array['expiresAt','issuedAt','mandateId','remainingUses','revision','state'],
  'owner lookup omits profile, credential, host IDs and arbitrary booking lookup');
select is((select value->>'remainingUses' from mandate_results where key='metadata'),'1',
  'new mandate has exactly one remaining use');
select throws_ok(format('select public.project_s_get_mandate_v2(pg_temp.mandate_context(%L),%L)',
  'd0100000-0000-4000-8000-000000000002',mandate_id),'PT403','FORBIDDEN',description)
from (values
  ('d0600000-0000-4000-8000-000000000001','other principal cannot inspect a known mandate'),
  ('d0600000-0000-4000-8000-000000000099','unknown mandate receives identical refusal')) probes(mandate_id,description);
select throws_ok($$select public.project_s_revoke_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001',2)$$,'PT409','VERSION_CONFLICT',
  'stale mandate revision cannot revoke');

create trigger mandate_audit_failure before insert on private.v2_authority_events
  for each row execute function pg_temp.fail_mandate_audit();
select throws_ok($$select public.project_s_revoke_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001',1)$$,'P0001','synthetic mandate audit failure',
  'authoritative audit failure rolls back revocation');
select is(public.project_s_get_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001')->>'state','active',
  'failed revoke leaves original active state');
select throws_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.mandate_context(),
  'd0200000-0000-4000-8000-000000000001',1)$$,'P0001','synthetic mandate audit failure',
  'audit failure rolls back dependent invalidation and profile erasure together');
select is((select state from private.v2_booker_profiles where profile_id='d0200000-0000-4000-8000-000000000001'),
  'active','failed profile deletion retains profile state');
select is(public.project_s_get_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001')->>'state','active',
  'failed profile deletion does not partially invalidate a mandate');
drop trigger mandate_audit_failure on private.v2_authority_events;
insert into mandate_results values ('revoked',public.project_s_revoke_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001',1));
select is((select value->>'state' from mandate_results where key='revoked'),'revoked',
  'owner revoke returns durable revoked state');
select is((select value->>'revision' from mandate_results where key='revoked'),'2',
  'revoke advances mandate revision exactly once');
select is(public.project_s_revoke_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001',1),(select value from mandate_results where key='revoked'),
  'exact revoke retry returns original acknowledgement');
select is(public.project_s_get_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000001')->>'remainingUses','0',
  'revoked mandate has no usable budget');
select is((select count(*)::integer from private.v2_authority_events
  where principal_id='d0100000-0000-4000-8000-000000000001' and action='mandate_revoked'),1,
  'exact revoke retry adds no second event or revision');
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000002',
  p_digest=>(select value->>'summaryDigest' from mandate_results where key='fresh-review'))$$,
  'PT409','VERSION_CONFLICT','approval retry cannot revive a revoked mandate');

-- A second active dependent is invalidated before profile deletion acknowledges.
insert into mandate_results values ('delete-review',pg_temp.mandate_review('d0500000-0000-4000-8000-000000000003'));
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000003',
  'd0600000-0000-4000-8000-000000000001',p_digest=>(select value->>'summaryDigest' from mandate_results where key='delete-review'))$$,
  'PT409','VERSION_CONFLICT','new review cannot overwrite or adopt an existing mandate identity');
insert into mandate_results values ('delete-mandate',pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000003',
  'd0600000-0000-4000-8000-000000000003',p_digest=>(select value->>'summaryDigest' from mandate_results where key='delete-review')));
insert into mandate_results values ('pending-review',pg_temp.mandate_review('d0500000-0000-4000-8000-000000000004'));
select lives_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.mandate_context(),
  'd0200000-0000-4000-8000-000000000001',1)$$,'explicit profile deletion invalidates active dependents');
select is(public.project_s_get_mandate_v2(pg_temp.mandate_context(),
  'd0600000-0000-4000-8000-000000000003')->>'state','revoked',
  'profile deletion cannot acknowledge while an outstanding mandate remains active');
select ok((select name is null and email is null and guest_time_zone is null from private.v2_booker_profiles
  where profile_id='d0200000-0000-4000-8000-000000000001'),'profile deletion erases original profile PII');
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000004',
  'd0600000-0000-4000-8000-000000000004',p_digest=>(select value->>'summaryDigest' from mandate_results where key='pending-review'))$$,
  'PT409','VERSION_CONFLICT','pending review cannot issue authority after its reviewed profile is deleted');
select ok(not exists(select 1 from private.v2_mandate_reviews r where
  r.principal_id='d0100000-0000-4000-8000-000000000001' and
  (to_jsonb(r)::text like '%Synthetic Reviewed Booker%' or to_jsonb(r)::text like '%reviewed-booker@example.invalid%')),
  'profile deletion also redacts retained review copies of the deleted profile PII');
select ok(not exists(select 1 from private.v2_mandates m where
  to_jsonb(m)::text like '%Synthetic Reviewed Booker%' or to_jsonb(m)::text like '%reviewed-booker@example.invalid%'),
  'mandate storage does not retain reviewed profile PII');
select is((select string_agg(attname,',' order by attnum) from pg_attribute
  where attrelid='private.v2_authority_events'::regclass and attnum>0 and not attisdropped),
  'instance_id,epoch,principal_id,sequence,action,occurred_at',
  'authority audit retains only minimal partition, order, action and time');

-- A distinct owner supplies positive controls for live dependency expiry and
-- principal/account checks without restoring any deleted authority or PII.
insert into mandate_results select 'other-policy',value||jsonb_build_object(
  'actorId','d0300000-0000-4000-8000-000000000002',
  'profileId','d0200000-0000-4000-8000-000000000002') from mandate_results where key='policy';
insert into mandate_results values ('other-review',pg_temp.mandate_review(
  'd0500000-0000-4000-8000-000000000010',(select value from mandate_results where key='other-policy'),
  pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002')));
update private.v2_actor_credentials set expires_at=clock_timestamp()-interval '1 millisecond'
  where credential_id='d0400000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000010',
  'd0600000-0000-4000-8000-000000000010',p_digest=>(select value->>'summaryDigest' from mandate_results where key='other-review'),
  p_context=>pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,
  'PT409','VERSION_CONFLICT','approval rechecks supporting credential expiry');
update private.v2_actor_credentials set expires_at=issued_at+interval '2 days'
  where credential_id='d0400000-0000-4000-8000-000000000002';
-- Preserve exact original expiry for the digest before retrying the review.
insert into mandate_results values ('other-profile-expiry',to_jsonb((select expires_at
  from private.v2_booker_profiles where profile_id='d0200000-0000-4000-8000-000000000002')));
update private.v2_booker_profiles set expires_at=clock_timestamp()-interval '1 millisecond'
  where profile_id='d0200000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000010',
  'd0600000-0000-4000-8000-000000000010',p_digest=>(select value->>'summaryDigest' from mandate_results where key='other-review'),
  p_context=>pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,
  'PT409','VERSION_CONFLICT','approval rechecks supporting reviewed-profile expiry');
update private.v2_booker_profiles set expires_at=(select (value #>> '{}')::timestamptz
  from mandate_results where key='other-profile-expiry') where profile_id='d0200000-0000-4000-8000-000000000002';
update private.v2_authority_principals set disabled=true
  where principal_id='d0100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.mandate_review('d0500000-0000-4000-8000-000000000011',
  (select value from mandate_results where key='other-policy'),
  pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,'PT401','AUTHENTICATION_REQUIRED',
  'disabled principal cannot issue a fresh review');
update private.v2_authority_principals set disabled=false
  where principal_id='d0100000-0000-4000-8000-000000000002';
select public.project_s_revoke_actor_v2(pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'),
  'd0300000-0000-4000-8000-000000000002',1);
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000010',
  'd0600000-0000-4000-8000-000000000010',p_digest=>(select value->>'summaryDigest' from mandate_results where key='other-review'),
  p_context=>pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,
  'PT409','VERSION_CONFLICT','revoked supporting actor cannot approve a displayed policy');
delete from auth.users where id='d0100000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.mandate_approve('d0500000-0000-4000-8000-000000000010',
  'd0600000-0000-4000-8000-000000000010',p_digest=>(select value->>'summaryDigest' from mandate_results where key='other-review'),
  p_context=>pg_temp.mandate_context('d0100000-0000-4000-8000-000000000002'))$$,
  'PT401','AUTHENTICATION_REQUIRED','deleted live account cannot approve retained review state');
select is((select count(*)::integer from public.bookings
  where user_id in ('d0100000-0000-4000-8000-000000000001','d0100000-0000-4000-8000-000000000003')),0,
  'review, approval, get, revoke and deletion never create or mutate bookings');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=pg_catalog',
  'lock_timeout=1s','statement_timeout=5s']) from pg_proc where oid in (
  'public.project_s_create_mandate_review_v2(jsonb,uuid,jsonb)'::regprocedure,
  'public.project_s_approve_mandate_v2(jsonb,uuid,uuid,bigint,text)'::regprocedure,
  'public.project_s_get_mandate_v2(jsonb,uuid)'::regprocedure,
  'public.project_s_revoke_mandate_v2(jsonb,uuid,bigint)'::regprocedure)),
  'all mandate controls retain fixed definer search paths and scoped lock/deadline settings');

select * from finish();
rollback;
