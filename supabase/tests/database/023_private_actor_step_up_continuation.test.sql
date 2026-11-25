begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- Use disposable fixtures and the actual prepare, approve and commit RPCs.
create temporary table actor_continuation_fixture (key text primary key, value jsonb) on commit drop;

create function pg_temp.continuation_id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:actor-continuation-test:' || p_label) placing '4' from 13 for 1)
    placing '8' from 17 for 1)::uuid;
$$;

create function pg_temp.continuation_value(p_key text) returns jsonb
language sql set search_path = pg_catalog as $$
  select value from pg_temp.actor_continuation_fixture where key = p_key;
$$;

create function pg_temp.continuation_principal(p_owner integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-actor-continuation',
    'instanceId',pg_temp.continuation_id('instance'),'epoch',1,
    'principalId',pg_temp.continuation_id('owner-' || p_owner),
    'subjectId',pg_temp.continuation_id('owner-' || p_owner),
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','http');
$$;

create function pg_temp.continuation_actor(p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select pg_temp.continuation_principal(case when p_actor=2 then 2 else 1 end) || jsonb_build_object(
    'actorId',pg_temp.continuation_id('actor-' || p_actor),
    'credentialId',pg_temp.continuation_id('credential-' || p_actor),
    'credentialRevision',1,'credentialFingerprint',repeat(case p_actor when 1 then 'a' when 2 then 'b' else 'c' end,64));
$$;

create function pg_temp.continuation_slot(p_time time) returns text
language sql set search_path = pg_catalog as $$
  select private.v2_mandate_instant(
    (((pg_temp.continuation_value('day')#>>'{}')::date + p_time) at time zone 'UTC'));
$$;

create function pg_temp.continuation_read(p_label text, p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_get_delegated_step_up_v2(pg_temp.continuation_actor(p_actor),
    pg_temp.continuation_id('request-' || p_label));
$$;

create function pg_temp.continuation_approve(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_approve_step_up_v2(pg_temp.continuation_principal(),
    pg_temp.continuation_id('request-' || p_label),pg_temp.continuation_id('preparation-' || p_label),
    pg_temp.continuation_id('grant-' || p_label),1,
    public.project_s_get_step_up_review_v2(pg_temp.continuation_principal(),
      pg_temp.continuation_id('request-' || p_label))->>'summaryDigest');
$$;

create function pg_temp.continuation_sequence() returns bigint
language sql set search_path = pg_catalog as $$
  select event_sequence from private.v2_authority_principals
  where instance_id=pg_temp.continuation_id('instance') and epoch=1
    and principal_id=pg_temp.continuation_id('owner-1');
$$;

select ok(has_function_privilege('service_role','public.project_s_get_delegated_step_up_v2(jsonb,uuid)','EXECUTE'),
  'the verified server can invoke the continuation RPC');
set local role anon;
select throws_ok($$select public.project_s_get_delegated_step_up_v2('{}',null)$$,
  '42501',null,'anonymous clients cannot directly invoke the continuation RPC');
reset role;
set local role authenticated;
select throws_ok($$select public.project_s_get_delegated_step_up_v2('{}',null)$$,
  '42501',null,'signed-in accounts cannot directly invoke the continuation RPC');
reset role;

insert into private.v2_authority_instance(instance_id,epoch,audience)
values (pg_temp.continuation_id('instance'),1,'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id,epoch)
values (pg_temp.continuation_id('instance'),1);
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.continuation_id(label),'authenticated','authenticated',
  username || '@example.invalid',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Continuation Account','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values ('owner-1','synthetic-continuation-a'),('owner-2','synthetic-continuation-b'),
  ('host','synthetic-continuation-host')) users(label,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,slot_interval_minutes,minimum_notice_minutes,active)
values (pg_temp.continuation_id('meeting'),pg_temp.continuation_id('host'),'Synthetic Continuation Meeting',30,15,0,true);
insert into actor_continuation_fixture values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values (pg_temp.continuation_id('host'),(pg_temp.continuation_value('day')#>>'{}')::date,'available','09:00','18:00');

do $$
declare
  actor integer;
  label text;
  review jsonb;
  permission_start timestamptz;
begin
  for actor in 1..3 loop
    perform public.project_s_register_actor_v2(pg_temp.continuation_principal(case when actor=2 then 2 else 1 end),
      pg_temp.continuation_id('actor-' || actor),pg_temp.continuation_id('credential-' || actor),
      decode(repeat(case actor when 1 then 'a' when 2 then 'b' else 'c' end,64),'hex'),
      'Synthetic continuation actor',clock_timestamp()+interval '2 days');
  end loop;
  perform public.project_s_create_booker_profile_v2(pg_temp.continuation_principal(),pg_temp.continuation_id('profile'),
    '{"name":"Synthetic Private Booker","email":"private-continuation@example.invalid","guestTimeZone":"UTC"}');
  permission_start:=clock_timestamp()+interval '5 seconds';
  foreach label in array array['main','pending-expired','approved-expired','declined','revoked','deleted'] loop
    review:=public.project_s_create_mandate_review_v2(pg_temp.continuation_principal(),
      pg_temp.continuation_id('issuance-' || label),jsonb_build_object(
        'actorId',pg_temp.continuation_id('actor-1'),'profileId',pg_temp.continuation_id('profile'),
        'profileRevision',1,'username','synthetic-continuation-host','meetingTypeId',pg_temp.continuation_id('meeting'),
        'meetingWindowStart',pg_temp.continuation_slot('09:00'),'meetingWindowEnd',pg_temp.continuation_slot('11:00'),
        'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
        'expiresAt',private.v2_mandate_instant(permission_start+interval '1 hour')));
    perform public.project_s_approve_mandate_v2(pg_temp.continuation_principal(),(review->>'reviewId')::uuid,
      pg_temp.continuation_id('mandate-' || label),1,review->>'summaryDigest');
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start-clock_timestamp()+interval '20 milliseconds')))::double precision);
end;
$$;

insert into actor_continuation_fixture
select 'requested-' || label,public.project_s_prepare_delegated_booking_v2(pg_temp.continuation_actor(),
  pg_temp.continuation_id('ordinary-' || label),pg_temp.continuation_id('request-' || label),jsonb_build_object(
    'mandateId',pg_temp.continuation_id('mandate-' || label),'username','synthetic-continuation-host',
    'meetingTypeId',pg_temp.continuation_id('meeting'),'startAt',pg_temp.continuation_slot(slot::time)))
from (values ('main','12:00'),('pending-expired','13:00'),('approved-expired','14:00'),
  ('declined','15:00'),('revoked','16:00'),('deleted','17:00')) requested(label,slot);

insert into actor_continuation_fixture values ('pending-sequence',to_jsonb(pg_temp.continuation_sequence()));
select is(pg_temp.continuation_read('main'),jsonb_build_object('reviewId',pg_temp.continuation_id('request-main'),
  'state','pending','expiresAt',pg_temp.continuation_value('requested-main')#>>'{stepUp,expiresAt}'),
  'the original actor reads only the pending reference, state and deadline');
select throws_ok($$select pg_temp.continuation_read('main',2)$$,'PT403','FORBIDDEN',
  'another principal cannot read the pending request');
select throws_ok($$select pg_temp.continuation_read('main',3)$$,'PT403','FORBIDDEN',
  'a different actor of the same principal cannot read the pending request');
select throws_ok($$select pg_temp.continuation_read('missing')$$,'PT403','FORBIDDEN',
  'missing and foreign references receive the same refusal');
select throws_ok($$select public.project_s_get_delegated_step_up_v2(pg_temp.continuation_principal(),
  pg_temp.continuation_id('request-main'))$$,'PT401','AUTHENTICATION_REQUIRED',
  'a principal-only context cannot use the actor continuation');
select throws_ok($$select public.project_s_get_delegated_step_up_v2(pg_temp.continuation_actor(),null)$$,
  'PT400','VALIDATION_ERROR','a live actor must give an exact review reference');
select throws_ok($$select public.project_s_get_delegated_step_up_v2(
  pg_temp.continuation_actor()||'{"epoch":2}'::jsonb,pg_temp.continuation_id('request-main'))$$,
  'PT401','AUTHENTICATION_REQUIRED','the context must match the current authority epoch');
update auth.users set is_anonymous=true where id=pg_temp.continuation_id('owner-1');
select throws_ok($$select pg_temp.continuation_read('main')$$,'PT401','AUTHENTICATION_REQUIRED',
  'the actor must still belong to a live nonanonymous account');
update auth.users set is_anonymous=false where id=pg_temp.continuation_id('owner-1');
select is(to_jsonb(pg_temp.continuation_sequence()),pg_temp.continuation_value('pending-sequence'),
  'pending reads and refusals do not advance the authority sequence');

update private.v2_step_up_requests set expires_at=created_at+interval '1 microsecond'
where review_id=pg_temp.continuation_id('request-pending-expired');
select throws_ok($$select pg_temp.continuation_read('pending-expired')$$,'PT403','FORBIDDEN',
  'an expired pending request uses the opaque refusal');
select public.project_s_revoke_step_up_v2(pg_temp.continuation_principal(),pg_temp.continuation_id('request-declined'),1);
select throws_ok($$select pg_temp.continuation_read('declined')$$,'PT403','FORBIDDEN',
  'declining a pending request does not expose terminal history or a preparation');

insert into actor_continuation_fixture values ('approval-main',pg_temp.continuation_approve('main'));
-- Move only the old review deadline to just after the actual approval. The
-- approved grant still has its original live deadline, and approval stays valid.
update private.v2_step_up_requests set expires_at=approved_at+interval '1 microsecond'
where review_id=pg_temp.continuation_id('request-main');
insert into actor_continuation_fixture values ('approved-sequence',to_jsonb(pg_temp.continuation_sequence()));
insert into actor_continuation_fixture values ('actor-approved',pg_temp.continuation_read('main'));
select is(pg_temp.continuation_value('actor-approved'),jsonb_build_object(
  'reviewId',pg_temp.continuation_id('request-main'),'state','approved',
  'expiresAt',pg_temp.continuation_value('approval-main')->>'expiresAt',
  'preparationId',pg_temp.continuation_id('preparation-main')),
  'the original actor sees only the approved reference and replacement deadline after the review deadline');
select is(pg_temp.continuation_read('main'),pg_temp.continuation_value('actor-approved'),
  'repeated reads return the same preparation and deadline');
select throws_ok($$select pg_temp.continuation_read('main',2)$$,'PT403','FORBIDDEN',
  'another principal cannot discover the approved preparation');
select throws_ok($$select pg_temp.continuation_read('main',3)$$,'PT403','FORBIDDEN',
  'another live actor of the same principal cannot discover the approved preparation');
select is(to_jsonb(pg_temp.continuation_sequence()),pg_temp.continuation_value('approved-sequence'),
  'approved reads and refusals create no authority event');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.continuation_id('host')),0,
  'approval and continuation leave the slot unbooked');

-- Commit using the preparation from the actor's read and its own retry key.
insert into actor_continuation_fixture values ('receipt-main',public.project_s_commit_delegated_booking_v2(
  pg_temp.continuation_actor(),(pg_temp.continuation_value('actor-approved')->>'preparationId')::uuid,
  pg_temp.continuation_id('retry-key')));
select is(pg_temp.continuation_value('receipt-main')#>>'{booking,startAt}',pg_temp.continuation_slot('12:00'),
  'the original actor commits the exact approved slot it discovered through the handoff');
select throws_ok($$select pg_temp.continuation_read('main')$$,'PT403','FORBIDDEN',
  'consumed approval cannot yield a preparation to begin another commit');
select is(public.project_s_commit_delegated_booking_v2(pg_temp.continuation_actor(),
  (pg_temp.continuation_value('actor-approved')->>'preparationId')::uuid,pg_temp.continuation_id('retry-key')),
  pg_temp.continuation_value('receipt-main'),'the original actor can still replay its exact commit for the same receipt');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.continuation_id('host')),1,
  'the continuation and exact commit retry create only one booking');

select pg_temp.continuation_approve('approved-expired');
update private.v2_step_up_grants set expires_at=issued_at+interval '1 microsecond'
where grant_id=pg_temp.continuation_id('grant-approved-expired');
update private.v2_step_up_preparations set expires_at=created_at+interval '1 microsecond'
where preparation_id=pg_temp.continuation_id('preparation-approved-expired');
select throws_ok($$select pg_temp.continuation_read('approved-expired')$$,'PT403','FORBIDDEN',
  'a live original review deadline cannot extend the expired replacement grant');
select pg_temp.continuation_approve('revoked');
select public.project_s_revoke_mandate_v2(pg_temp.continuation_principal(),pg_temp.continuation_id('mandate-revoked'),1);
select throws_ok($$select pg_temp.continuation_read('revoked')$$,'PT403','FORBIDDEN',
  'revoking the original mandate closes access to its replacement');
select pg_temp.continuation_approve('deleted');
select public.project_s_delete_booker_profile_v2(pg_temp.continuation_principal(),pg_temp.continuation_id('profile'),1);
select throws_ok($$select pg_temp.continuation_read('deleted')$$,'PT403','FORBIDDEN',
  'deleting the supporting profile closes access to the approved preparation');
select public.project_s_revoke_actor_v2(pg_temp.continuation_principal(),pg_temp.continuation_id('actor-1'),1);
select throws_ok($$select pg_temp.continuation_read('deleted')$$,'PT401','AUTHENTICATION_REQUIRED',
  'a revoked credential cannot use the continuation');

select * from finish();
rollback;
