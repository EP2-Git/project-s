begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.profile_context(
  p_principal uuid default 'c8100000-0000-4000-8000-000000000001'
) returns jsonb language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-profile-test',
    'principalId',p_principal,'subjectId',p_principal,
    'instanceId','c8000000-0000-4000-8000-000000000001','epoch',1,
    'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'transport','http');
$$;
create function pg_temp.review_profile(
  p_profile_id uuid default 'c8200000-0000-4000-8000-000000000001',
  p_profile jsonb default '{"name":"Synthetic Booker","email":"booker@example.invalid","guestTimeZone":"UTC"}',
  p_context jsonb default null
) returns jsonb language sql set search_path = pg_catalog as $$
  select public.project_s_create_booker_profile_v2(
    coalesce(p_context,pg_temp.profile_context()),p_profile_id,p_profile);
$$;

select is((select count(*)::integer from private.v2_authority_instance),0,
  'profile migration does not configure or enable an authority instance');
select throws_ok($$select pg_temp.review_profile()$$,'PT401','AUTHENTICATION_REQUIRED',
  'unconfigured instance cannot review a profile');
select ok((select relrowsecurity from pg_class where oid='private.v2_booker_profiles'::regclass),
  'reviewed profiles enable row-level security');
select is((select count(*)::integer from pg_policy where polrelid='private.v2_booker_profiles'::regclass),0,
  'no row policy grants private profile access');
select ok(not has_table_privilege(role_name,'private.v2_booker_profiles','SELECT,INSERT,UPDATE,DELETE'),
  role_name||' has no direct profile table access')
from (values ('anon'),('authenticated'),('service_role')) roles(role_name);
select ok(not has_function_privilege(role_name,fn,'EXECUTE'),role_name||' cannot directly call '||fn)
from (values ('anon'),('authenticated')) roles(role_name)
cross join (values
  ('public.project_s_create_booker_profile_v2(jsonb,uuid,jsonb)'),
  ('public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint)')) functions(fn);
select ok(has_function_privilege('service_role',fn,'EXECUTE'),'trusted server can call '||fn)
from (values
  ('public.project_s_create_booker_profile_v2(jsonb,uuid,jsonb)'),
  ('public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint)')) functions(fn);
set local role anon;
select throws_ok($$select public.project_s_create_booker_profile_v2('{}',
  'c8200000-0000-4000-8000-000000000001','{}')$$,'42501',null,
  'anonymous direct create is denied before context interpretation');
reset role;
set local role authenticated;
select throws_ok($$select public.project_s_delete_booker_profile_v2('{}',
  'c8200000-0000-4000-8000-000000000001',1)$$,'42501',null,
  'ordinary authenticated clients cannot directly delete profiles');
reset role;
select is((select count(*)::integer from pg_constraint where conrelid='private.v2_booker_profiles'::regclass
  and contype='f' and confrelid not in ('private.v2_authority_principals'::regclass,
  'private.v2_authority_events'::regclass)),0,
  'reviewed profiles have no foreign key or cascade into legacy accounts or bookings');

insert into private.v2_authority_instance(instance_id,epoch,audience) values
  ('c8000000-0000-4000-8000-000000000001',1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic profile owner','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values
  ('c8100000-0000-4000-8000-000000000001'::uuid,'profile-owner-a@example.invalid','profile-owner-a'),
  ('c8100000-0000-4000-8000-000000000002'::uuid,'profile-owner-b@example.invalid','profile-owner-b')) owners(id,email,username);

select throws_ok($$select pg_temp.review_profile(p_context=>pg_temp.profile_context()||
  '{"actorId":"c8300000-0000-4000-8000-000000000001"}')$$,
  'PT401','AUTHENTICATION_REQUIRED','actor context cannot act as a principal control');
select throws_ok($$select pg_temp.review_profile(p_context=>pg_temp.profile_context()||
  '{"subjectId":"c8100000-0000-4000-8000-000000000002"}')$$,
  'PT401','AUTHENTICATION_REQUIRED','caller cannot substitute another subject');
select throws_ok($$select pg_temp.review_profile(p_context=>pg_temp.profile_context()||'{"epoch":2}')$$,
  'PT401','AUTHENTICATION_REQUIRED','wrong epoch denies profile creation');
select throws_ok($$select pg_temp.review_profile(p_context=>pg_temp.profile_context(
  'c8100000-0000-4000-8000-000000000003'))$$,
  'PT401','AUTHENTICATION_REQUIRED','missing live account cannot create a profile');
select is((select count(*)::integer from private.v2_authority_principals),0,
  'failed account creation rolls back a newly bootstrapped fence');
select throws_ok(format('select pg_temp.review_profile(p_profile=>%L::jsonb)',profile::text),
  'PT400','VALIDATION_ERROR',description)
from (values
  ('[]'::jsonb,'array is not profile input'),
  ('null'::jsonb,'null is not profile input'),
  ('{}'::jsonb,'all three profile fields are required'),
  ('{"name":"Synthetic Booker","email":"booker@example.invalid","guestTimeZone":"UTC","notes":"private"}'::jsonb,
    'notes are not accepted'),
  ('{"name":"Synthetic Booker","email":"booker@example.invalid","guestTimeZone":"UTC","principalId":"c8100000-0000-4000-8000-000000000002"}'::jsonb,
    'profile body cannot override caller identity'),
  ('{"name":1,"email":"booker@example.invalid","guestTimeZone":"UTC"}'::jsonb,'non-string name is refused'),
  ('{"name":"A","email":"booker@example.invalid","guestTimeZone":"UTC"}'::jsonb,'one-character name is refused'),
  ('{"name":"Synthetic\nBooker","email":"booker@example.invalid","guestTimeZone":"UTC"}'::jsonb,
    'control characters in name are refused'),
  ('{"name":"Synthetic Booker","email":"not-an-email","guestTimeZone":"UTC"}'::jsonb,'invalid email is refused'),
  ('{"name":"Synthetic Booker","email":"booker@example.invalid","guestTimeZone":"Invalid/Zone"}'::jsonb,
    'invalid time zone is refused')) vectors(profile,description);

create temporary table profile_results(key text primary key,value jsonb) on commit drop;
insert into profile_results values ('created',pg_temp.review_profile(p_profile=>
  '{"name":"  Synthetic Booker  ","email":"  BOOKER@EXAMPLE.INVALID  ","guestTimeZone":"America/Halifax"}'));
select is((select value->>'revision' from profile_results where key='created'),'1',
  'server issues immutable profile revision one');
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value from profile_results where key='created')) as keys(key)),
  array['expiresAt','profileId','reviewedAt','revision'],'create acknowledgement has only reviewed metadata');
select is((select (value->>'expiresAt')::timestamptz-(value->>'reviewedAt')::timestamptz
  from profile_results where key='created'),interval '168 hours',
  'server derives the exact seven-day lifetime without losing fractional precision');
select is((select name from private.v2_booker_profiles where profile_id='c8200000-0000-4000-8000-000000000001'),
  'Synthetic Booker','name normalization trims ASCII spaces');
select is((select email from private.v2_booker_profiles where profile_id='c8200000-0000-4000-8000-000000000001'),
  'booker@example.invalid','email normalization trims ASCII spaces and lowercases');
select is((select guest_time_zone from private.v2_booker_profiles where profile_id='c8200000-0000-4000-8000-000000000001'),
  'America/Halifax','reviewed time-zone spelling is preserved');
select is(pg_temp.review_profile(p_profile=>
  '{"name":"Synthetic Booker","email":"booker@example.invalid","guestTimeZone":"America/Halifax"}'),
  (select value from profile_results where key='created'),'exact normalized create retry returns the original metadata');
select is((select event_sequence::integer from private.v2_authority_principals
  where principal_id='c8100000-0000-4000-8000-000000000001'),1,
  'exact create retry does not append an event');
select throws_ok($$select pg_temp.review_profile(p_profile=>
  '{"name":"Changed Booker","email":"booker@example.invalid","guestTimeZone":"America/Halifax"}')$$,
  'PT409','VERSION_CONFLICT','same profile reference cannot replace reviewed details');

-- Positive control for the second owner before known-foreign and unknown probes.
insert into profile_results values ('other',pg_temp.review_profile(
  'c8200000-0000-4000-8000-000000000002',p_context=>pg_temp.profile_context('c8100000-0000-4000-8000-000000000002')));
select throws_ok($$select pg_temp.review_profile('c8200000-0000-4000-8000-000000000001',
  p_context=>pg_temp.profile_context('c8100000-0000-4000-8000-000000000002'))$$,
  'PT403','FORBIDDEN','another principal cannot recreate or inspect a known foreign profile');
select throws_ok(format('select public.project_s_delete_booker_profile_v2(pg_temp.profile_context(%L),%L,1)',
  'c8100000-0000-4000-8000-000000000002',profile_id),'PT403','FORBIDDEN',description)
from (values
  ('c8200000-0000-4000-8000-000000000001','other principal cannot delete a known foreign profile'),
  ('c8200000-0000-4000-8000-000000000099','unknown profile has the same uniform refusal')) probes(profile_id,description);
select throws_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.profile_context(),
  'c8200000-0000-4000-8000-000000000001',2)$$,'PT409','VERSION_CONFLICT','stale delete revision refuses');
update private.v2_authority_principals set disabled=true where principal_id='c8100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.review_profile()$$,'PT401','AUTHENTICATION_REQUIRED','disabled principal cannot review');
select throws_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.profile_context(),
  'c8200000-0000-4000-8000-000000000001',1)$$,'PT401','AUTHENTICATION_REQUIRED','disabled principal cannot delete');
update private.v2_authority_principals set disabled=false where principal_id='c8100000-0000-4000-8000-000000000001';
update auth.users set is_anonymous=true where id='c8100000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.review_profile()$$,'PT401','AUTHENTICATION_REQUIRED','anonymous account cannot review');
update auth.users set is_anonymous=false where id='c8100000-0000-4000-8000-000000000001';

create function pg_temp.fail_profile_audit() returns trigger language plpgsql as $$
begin raise exception sqlstate 'P0001' using message='synthetic profile audit failure'; end;
$$;
create trigger profile_audit_failure before insert on private.v2_authority_events
  for each row execute function pg_temp.fail_profile_audit();
select throws_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.profile_context(),
  'c8200000-0000-4000-8000-000000000001',1)$$,'P0001','synthetic profile audit failure',
  'audit failure rolls back deletion');
select is((select state from private.v2_booker_profiles where profile_id='c8200000-0000-4000-8000-000000000001'),
  'active','failed delete leaves profile active');
select is((select name from private.v2_booker_profiles where profile_id='c8200000-0000-4000-8000-000000000001'),
  'Synthetic Booker','failed delete does not partially erase profile PII');
select throws_ok($$select pg_temp.review_profile('c8200000-0000-4000-8000-000000000003')$$,
  'P0001','synthetic profile audit failure','audit failure rolls back new review');
select is((select count(*)::integer from private.v2_booker_profiles),2,'failed review leaves no new profile');
select is((select event_sequence::integer from private.v2_authority_principals
  where principal_id='c8100000-0000-4000-8000-000000000001'),1,'audit failure rolls back event sequence');
drop trigger profile_audit_failure on private.v2_authority_events;

insert into profile_results values ('deleted',public.project_s_delete_booker_profile_v2(
  pg_temp.profile_context(),'c8200000-0000-4000-8000-000000000001',1));
select is((select value->>'state' from profile_results where key='deleted'),'deleted','delete returns its durable outcome');
select is((select array_agg(key order by key) from jsonb_object_keys(
  (select value from profile_results where key='deleted')) as keys(key)),
  array['deletedAt','profileId','state'],'delete acknowledgement exposes no profile PII');
select ok((select state='deleted' and name is null and email is null and guest_time_zone is null
  and deleted_at is not null and revision=1 from private.v2_booker_profiles
  where profile_id='c8200000-0000-4000-8000-000000000001'),
  'delete clears every reviewed PII field and retains only the immutable revision/tombstone');
select is(public.project_s_delete_booker_profile_v2(pg_temp.profile_context(),
  'c8200000-0000-4000-8000-000000000001',1),(select value from profile_results where key='deleted'),
  'exact delete retry returns the original timestamp and acknowledgement');
select is((select event_sequence::integer from private.v2_authority_principals
  where principal_id='c8100000-0000-4000-8000-000000000001'),2,'exact delete retry has no second event');
select throws_ok($$select pg_temp.review_profile()$$,'PT409','VERSION_CONFLICT',
  'create retry cannot restore a deleted profile');

-- Expiry is enforced on retry even when the explicit cleanup/deletion is late.
update private.v2_booker_profiles set reviewed_at=statement_timestamp()-interval '169 hours',
  expires_at=statement_timestamp()-interval '1 hour' where profile_id='c8200000-0000-4000-8000-000000000002';
select throws_ok($$select pg_temp.review_profile('c8200000-0000-4000-8000-000000000002',
  p_context=>pg_temp.profile_context('c8100000-0000-4000-8000-000000000002'))$$,
  'PT409','VERSION_CONFLICT','expired reviewed profile cannot be revived by retry');
select lives_ok($$select public.project_s_delete_booker_profile_v2(
  pg_temp.profile_context('c8100000-0000-4000-8000-000000000002'),
  'c8200000-0000-4000-8000-000000000002',1)$$,'explicit delete removes expired profile PII');

delete from auth.users where id='c8100000-0000-4000-8000-000000000001';
select throws_ok($$select public.project_s_delete_booker_profile_v2(pg_temp.profile_context(),
  'c8200000-0000-4000-8000-000000000001',1)$$,'PT401','AUTHENTICATION_REQUIRED',
  'deleted account cannot recover an old delete acknowledgement');
select throws_ok($$select pg_temp.review_profile('c8200000-0000-4000-8000-000000000003')$$,
  'PT401','AUTHENTICATION_REQUIRED','deleted account cannot create a new profile');
select is((select count(*)::integer from private.v2_booker_profiles),2,
  'out-of-band account deletion preserves minimal private tombstones');
select is((select string_agg(attname,',' order by attnum) from pg_attribute
  where attrelid='private.v2_authority_events'::regclass and attnum>0 and not attisdropped),
  'instance_id,epoch,principal_id,sequence,action,occurred_at',
  'audit contains no profile name, email, zone, raw profile ID or request body');
select is((select array_agg(action order by sequence) from private.v2_authority_events
  where principal_id='c8100000-0000-4000-8000-000000000001'),
  array['profile_reviewed','profile_deleted'],'only one minimal event records each lifecycle transition');

-- Boundary and alias vectors retain the existing JavaScript public validators'
-- UTF-16 limits and accepted Intl spellings; these do not enable any endpoint.
select lives_ok(format('select pg_temp.review_profile(%L,%L::jsonb,pg_temp.profile_context(%L))',
  profile_id,jsonb_build_object('name',name,'email','boundary@example.invalid','guestTimeZone',zone)::text,
  'c8100000-0000-4000-8000-000000000002'),description)
from (values
  ('c8200000-0000-4000-8000-000000000010',repeat('A',120),'utc','120 UTF-16 name units and case-insensitive UTC are valid'),
  ('c8200000-0000-4000-8000-000000000011',repeat(U&'\+01F600',60),'US/Eastern','60 astral symbols use exactly 120 UTF-16 units'),
  ('c8200000-0000-4000-8000-000000000012','Synthetic Booker','CET','legacy Intl time-zone alias remains valid'),
  ('c8200000-0000-4000-8000-000000000013','Synthetic Booker','+01','hour-only Intl offset remains valid'),
  ('c8200000-0000-4000-8000-000000000014','Synthetic Booker','+0100','compact Intl offset remains valid'),
  ('c8200000-0000-4000-8000-000000000015','Synthetic Booker','-23:59','maximum valid negative Intl offset remains valid'))
  vectors(profile_id,name,zone,description);
select throws_ok(format('select pg_temp.review_profile(%L,%L::jsonb,pg_temp.profile_context(%L))',
  'c8200000-0000-4000-8000-000000000020',
  jsonb_build_object('name',name,'email','boundary@example.invalid','guestTimeZone',zone)::text,
  'c8100000-0000-4000-8000-000000000002'),'PT400','VALIDATION_ERROR',description)
from (values
  (repeat('A',121),'UTC','121 UTF-16 name units are invalid'),
  (repeat(U&'\+01F600',60)||'A','UTC','astral name exceeding 120 UTF-16 units is invalid'),
  ('Synthetic Booker','+24:00','out-of-range Intl offset is invalid'),
  ('Synthetic Booker','+0','incomplete Intl offset is invalid')) vectors(name,zone,description);
select ok((select bool_and(prosecdef and proconfig @> array['search_path=pg_catalog',
  'lock_timeout=1s','statement_timeout=5s']) from pg_proc where oid in (
  'public.project_s_create_booker_profile_v2(jsonb,uuid,jsonb)'::regprocedure,
  'public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint)'::regprocedure)),
  'profile RPCs have fixed search path and scoped lock/deadline settings');

select * from finish();
rollback;
