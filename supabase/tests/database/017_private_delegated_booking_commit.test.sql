begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- All accounts, schedules, keys and bookings are disposable transaction fixtures.
create temporary table delegated_commit_fixture (key text primary key, value jsonb) on commit drop;

create function pg_temp.commit_id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:delegated-commit-test:' || p_label) placing '4' from 13 for 1)
    placing '8' from 17 for 1)::uuid;
$$;

create function pg_temp.commit_value(p_key text) returns jsonb
language sql set search_path = pg_catalog as $$
  select value from pg_temp.delegated_commit_fixture where key = p_key;
$$;

create function pg_temp.commit_principal(p_owner integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-commit-test',
    'instanceId',pg_temp.commit_id('instance'),'epoch',1,
    'principalId',pg_temp.commit_id('owner-' || p_owner),'subjectId',pg_temp.commit_id('owner-' || p_owner),
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','http');
$$;

create function pg_temp.commit_actor(p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select pg_temp.commit_principal(case when p_actor = 2 then 2 else 1 end) || jsonb_build_object(
    'actorId',pg_temp.commit_id('actor-' || p_actor),'credentialId',pg_temp.commit_id('credential-' || p_actor),
    'credentialRevision',1,'credentialFingerprint',repeat(case p_actor when 1 then 'a' when 2 then 'b' else 'c' end,64));
$$;

create function pg_temp.commit_slot(p_time time) returns text
language sql set search_path = pg_catalog as $$
  select private.v2_mandate_instant(
    (((pg_temp.commit_value('day') #>> '{}')::date + p_time) at time zone 'UTC'));
$$;

create function pg_temp.commit_request(p_mandate text, p_time time) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('mandateId',pg_temp.commit_value('mandate-' || p_mandate)->>'mandateId',
    'username','synthetic-commit-host','meetingTypeId',pg_temp.commit_id('meeting'),
    'startAt',pg_temp.commit_slot(p_time));
$$;

create function pg_temp.commit_prepare(p_mandate text, p_time time, p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_prepare_delegated_booking_v2(pg_temp.commit_actor(p_actor),
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),pg_temp.commit_request(p_mandate,p_time));
$$;

create function pg_temp.commit_booking(p_preparation text, p_key text, p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_commit_delegated_booking_v2(pg_temp.commit_actor(p_actor),
    (pg_temp.commit_value('prep-' || p_preparation)#>>'{data,preparationId}')::uuid,pg_temp.commit_id(p_key));
$$;

create function pg_temp.commit_read(p_receipt text, p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_read_delegated_booking_receipt_v2(pg_temp.commit_actor(p_actor),
    (pg_temp.commit_value('receipt-' || p_receipt)->>'receiptId')::uuid);
$$;

select ok(not has_function_privilege(role_name,signature,'EXECUTE'),
  role_name || ' cannot execute ' || signature)
from (values ('anon'),('authenticated')) roles(role_name)
cross join (values ('public.project_s_commit_delegated_booking_v2(jsonb,uuid,uuid)'),
  ('public.project_s_read_delegated_booking_receipt_v2(jsonb,uuid)')) methods(signature);
select ok(has_function_privilege('service_role',signature,'EXECUTE'),
  'trusted server can execute ' || signature)
from (values ('public.project_s_commit_delegated_booking_v2(jsonb,uuid,uuid)'),
  ('public.project_s_read_delegated_booking_receipt_v2(jsonb,uuid)')) methods(signature);
select ok(not has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE'),
  role_name || ' cannot access ' || table_name)
from (values ('anon'),('authenticated'),('service_role')) roles(role_name)
cross join (values ('private.v2_booking_epoch_keys'),('private.v2_booking_receipts')) tables(table_name);
select is((select count(*)::integer from private.v2_booking_epoch_keys),0,
  'migration provisions no authority epoch key');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.v2_booking_epoch_keys'::regclass,'private.v2_booking_receipts'::regclass)),
  'new key and receipt tables enable default-deny RLS');

insert into private.v2_authority_instance(instance_id,epoch,audience)
values (pg_temp.commit_id('instance'),1,'http://127.0.0.1:54321');
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.commit_id(label),'authenticated','authenticated',
  username || '@example.invalid',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Commit Account','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values ('owner-1','synthetic-commit-a'),('owner-2','synthetic-commit-b'),
  ('host','synthetic-commit-host')) users(label,username);

insert into public.meeting_types(id,user_id,title,duration_minutes,slot_interval_minutes,
  buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,active)
values (pg_temp.commit_id('meeting'),pg_temp.commit_id('host'),'Synthetic Commit Meeting',30,15,5,5,0,true);
insert into delegated_commit_fixture values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values (pg_temp.commit_id('host'),(pg_temp.commit_value('day')#>>'{}')::date,'available','09:00','18:00');

do $$
declare
  actor integer;
  profile record;
  mandate record;
  review jsonb;
  permission_start timestamptz;
begin
  for actor in 1..3 loop
    perform public.project_s_register_actor_v2(pg_temp.commit_principal(case when actor = 2 then 2 else 1 end),
      pg_temp.commit_id('actor-' || actor),pg_temp.commit_id('credential-' || actor),
      decode(repeat(case actor when 1 then 'a' when 2 then 'b' else 'c' end,64),'hex'),
      'Synthetic commit actor',clock_timestamp()+interval '2 days');
  end loop;
  for profile in select * from (values ('offset','+05:30',1),('iana','America/Halifax',1),
    ('alias','america/halifax',1),('other','UTC',2)) profiles(label,zone,owner) loop
    perform public.project_s_create_booker_profile_v2(pg_temp.commit_principal(profile.owner),
      pg_temp.commit_id('profile-' || profile.label),jsonb_build_object(
      'name','Synthetic Private Commit Booker','email','private-commit-booker@example.invalid','guestTimeZone',profile.zone));
  end loop;
  permission_start := clock_timestamp()+interval '5 seconds';
  for mandate in select * from (values ('offset','offset',1,1),('iana','iana',1,1),
    ('alias','alias',1,1),('expiry','offset',1,1),('mandate-expiry','offset',1,1),
    ('revoked','offset',1,1),('profile','alias',1,1),('mixed','offset',1,1),
    ('conflict','other',2,2)) mandates(label,profile,actor,owner) loop
    review := public.project_s_create_mandate_review_v2(pg_temp.commit_principal(mandate.owner),
      pg_temp.commit_id('review-' || mandate.label),jsonb_build_object(
        'actorId',pg_temp.commit_id('actor-' || mandate.actor),'profileId',pg_temp.commit_id('profile-' || mandate.profile),
        'profileRevision',1,'username','synthetic-commit-host','meetingTypeId',pg_temp.commit_id('meeting'),
        'meetingWindowStart',pg_temp.commit_slot('09:00'),'meetingWindowEnd',pg_temp.commit_slot('16:00'),
        'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
        'expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '1 hour')));
    insert into pg_temp.delegated_commit_fixture values ('mandate-' || mandate.label,
      public.project_s_approve_mandate_v2(pg_temp.commit_principal(mandate.owner),(review->>'reviewId')::uuid,
        pg_temp.commit_id('mandate-' || mandate.label),1,review->>'summaryDigest'));
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start-clock_timestamp()+interval '20 milliseconds')))::double precision);
end;
$$;

insert into delegated_commit_fixture
select 'prep-' || label,pg_temp.commit_prepare(mandate,slot::time,actor)
from (values ('offset','offset','10:00',1),('alternate','offset','10:45',1),('iana','iana','11:30',1),
  ('alias','alias','12:30',1),('expiry','expiry','13:15',1),('mandate-expiry','mandate-expiry','13:45',1),
  ('revoked','revoked','14:00',1),('profile','profile','14:30',1),('mixed','mixed','15:15',1),
  ('conflict','conflict','10:00',2)) preparations(label,mandate,slot,actor);
insert into delegated_commit_fixture values ('step-up',pg_temp.commit_prepare('offset','16:30'));
select is((select count(*)::integer from delegated_commit_fixture where key like 'prep-%' and value->>'kind'='prepared'),10,
  'fixtures came from the real in-scope prepare operation');
select is(pg_temp.commit_value('step-up')->>'kind','step_up_required',
  'an exact out-of-scope review exists before its original mandate is used');

select throws_ok($$select pg_temp.commit_booking('offset','key-offset')$$,
  'PT503','AUTHORITY_BUSY','missing epoch key fails closed');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.commit_id('host')),0,
  'missing key creates no booking');
select is((select count(*)::integer from private.v2_booking_receipts),0,
  'missing key leaves no consumption or receipt');
insert into private.v2_booking_epoch_keys(instance_id,epoch) values (pg_temp.commit_id('instance'),1);
select throws_ok($$update private.v2_booking_epoch_keys set key=extensions.gen_random_bytes(32)
  where instance_id=pg_temp.commit_id('instance') and epoch=1$$,
  '22023','IMMUTABLE_BOOKING_EPOCH_KEY','a provisioned epoch key cannot be replaced in place');

select throws_ok($$select pg_temp.commit_booking('offset','key-offset',2)$$,
  'PT403','FORBIDDEN','another principal cannot spend a known preparation');
select throws_ok($$select pg_temp.commit_booking('offset','key-offset',3)$$,
  'PT403','FORBIDDEN','another live actor of the same principal cannot spend a known preparation');
select throws_ok($$select public.project_s_commit_delegated_booking_v2(
  pg_temp.commit_principal(),pg_temp.commit_id('missing-preparation'),pg_temp.commit_id('unknown-key'))$$,
  'PT401','AUTHENTICATION_REQUIRED','a principal context cannot impersonate a booking actor');

insert into delegated_commit_fixture values ('receipt-offset',pg_temp.commit_booking('offset','key-offset'));
select is((select array_agg(field order by field) from jsonb_object_keys(pg_temp.commit_value('receipt-offset')) fields(field)),
  array['booking','receiptExpiresAt','receiptId'],'receipt data matches the strict v2 envelope');
select is((select array_agg(field order by field) from jsonb_object_keys(pg_temp.commit_value('receipt-offset')->'booking') fields(field)),
  array['confirmationCode','endAt','guestTimeZone','hostTimeZone','meetingTypeId','meetingTypeTitle','startAt','status','username'],
  'receipt booking contains only the reviewed v2 fields');
select is(pg_temp.commit_value('receipt-offset')#>>'{booking,guestTimeZone}','+05:30',
  'receipt keeps the exact reviewed fixed-offset timezone');
select is(pg_temp.commit_value('receipt-offset')#>>'{booking,startAt}',pg_temp.commit_slot('10:00'),
  'the booked instant matches the prepared request');
select is(pg_temp.commit_value('receipt-offset')#>>'{booking,endAt}',pg_temp.commit_slot('10:30'),
  'the end instant is computed from the approved duration');
select ok((select b.guest_timezone is null and b.preparation_id is null
    and b.idempotency_key <> pg_temp.commit_id('key-offset')
    and b.booker_name='Synthetic Private Commit Booker' and b.booker_email='private-commit-booker@example.invalid'
    and b.notes is null and b.buffer_before_minutes=5 and b.buffer_after_minutes=5
  from private.v2_booking_receipts r join public.bookings b on b.id=r.booking_id
  where r.receipt_id=(pg_temp.commit_value('receipt-offset')->>'receiptId')::uuid),
  'legacy booking preserves reviewed contact fields and schedule buffers with a null unsupported timezone and separate v1 authority');
select ok((select octet_length(key_digest)=32 and key_digest<>convert_to(pg_temp.commit_id('key-offset')::text,'UTF8')
    and key_digest<>extensions.digest(convert_to(pg_temp.commit_id('key-offset')::text,'UTF8'),'sha256')
  from private.v2_booking_receipts where receipt_id=(pg_temp.commit_value('receipt-offset')->>'receiptId')::uuid),
  'receipt binds a keyed digest instead of a raw UUID or unkeyed digest');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.commit_id('host')),1,
  'first commit creates exactly one booking');
select is(pg_temp.commit_booking('offset','key-offset'),pg_temp.commit_value('receipt-offset'),
  'an identical retry returns the stored receipt');
select is(pg_temp.commit_read('offset'),pg_temp.commit_value('receipt-offset'),
  'direct receipt read returns the same caller-bound data');
select throws_ok($$select pg_temp.commit_read('offset',2)$$,
  'PT403','FORBIDDEN','a different principal cannot read a receipt');
select throws_ok($$select pg_temp.commit_read('offset',3)$$,
  'PT403','FORBIDDEN','a different actor of the original principal cannot read a receipt');
select throws_ok($$select pg_temp.commit_booking('alternate','key-offset')$$,
  'PT409','IDEMPOTENCY_KEY_REUSED','the original key cannot be applied to another preparation');
select throws_ok($$select pg_temp.commit_booking('alternate','key-alternate')$$,
  'PT403','FORBIDDEN','a different key and preparation cannot spend the consumed mandate');
select throws_ok($$select pg_temp.commit_booking('offset','key-new')$$,
  'PT403','FORBIDDEN','a different key cannot mint another receipt for the same preparation');
select throws_ok($$select pg_temp.commit_booking('conflict','key-offset',2)$$,
  'PT409','SLOT_UNAVAILABLE','another credential may use the same client key but cannot occupy a booked slot');
select is((select count(*)::integer from private.v2_authority_events where action='booking_committed'),1,
  'retries and denials add no success events');
select is((select count(*)::integer from private.v2_booking_receipts),1,
  'retries and denials add no consumption or receipt');
select ok((select p.state='invalidated' and p.summary is null and p.invalidated_sequence=r.committed_sequence
  from private.v2_delegated_preparations p join private.v2_booking_receipts r using(preparation_id)
  where r.receipt_id=(pg_temp.commit_value('receipt-offset')->>'receiptId')::uuid),
  'successful commit clears the preparation summary and retains the refusal fence');
select is(public.project_s_get_mandate_v2(pg_temp.commit_principal(),pg_temp.commit_id('mandate-offset'))->>'remainingUses',
  '0','issuer sees the consumed mandate has no remaining use');
select throws_ok($$select pg_temp.commit_prepare('offset','10:45')$$,
  'PT403','FORBIDDEN','existing or fresh prepares cannot reuse a consumed mandate');
select throws_ok($$select public.project_s_approve_step_up_v2(pg_temp.commit_principal(),
  (pg_temp.commit_value('step-up')#>>'{stepUp,reviewId}')::uuid,pg_temp.commit_id('step-prep'),pg_temp.commit_id('step-grant'),1,
  (select summary_digest from private.v2_step_up_requests
   where review_id=(pg_temp.commit_value('step-up')#>>'{stepUp,reviewId}')::uuid))$$,
  'PT403','FORBIDDEN','a pending exception cannot mint a replacement for a consumed mandate');

create function pg_temp.reject_delegated_commit_audit() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.action = 'booking_committed' then
    raise exception sqlstate 'P0001' using message='synthetic booking commit audit failure';
  end if;
  return new;
end;
$$;
create trigger commit_reject_audit before insert on private.v2_authority_events
for each row execute function pg_temp.reject_delegated_commit_audit();
insert into delegated_commit_fixture
select 'sequence-before',to_jsonb(event_sequence) from private.v2_authority_principals
where principal_id=pg_temp.commit_id('owner-1');
select throws_ok($$select pg_temp.commit_booking('iana','key-iana')$$,
  'P0001','synthetic booking commit audit failure','an audit insert failure aborts the atomic commit');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.commit_id('host')),1,
  'failed audit leaves no booking');
select is((select count(*)::integer from private.v2_booking_receipts),1,
  'failed audit leaves no receipt or consumption');
select is((select to_jsonb(event_sequence) from private.v2_authority_principals
  where principal_id=pg_temp.commit_id('owner-1')),pg_temp.commit_value('sequence-before'),
  'failed audit leaves no sequence increment');
drop trigger commit_reject_audit on private.v2_authority_events;

insert into delegated_commit_fixture values ('receipt-iana',pg_temp.commit_booking('iana','key-iana'));
insert into delegated_commit_fixture values ('receipt-alias',pg_temp.commit_booking('alias','key-alias'));
select is(pg_temp.commit_value('receipt-iana')#>>'{booking,guestTimeZone}','America/Halifax',
  'a valid retry after audit rollback preserves the named timezone');
select is((select b.guest_timezone from private.v2_booking_receipts r join public.bookings b on b.id=r.booking_id
  where r.receipt_id=(pg_temp.commit_value('receipt-iana')->>'receiptId')::uuid),
  'America/Halifax','the exact compatible name is retained in the legacy booking');
select is(pg_temp.commit_value('receipt-alias')#>>'{booking,guestTimeZone}','america/halifax',
  'receipt keeps exact reviewed spelling of a case variant');
select ok((select b.guest_timezone is null from private.v2_booking_receipts r join public.bookings b on b.id=r.booking_id
  where r.receipt_id=(pg_temp.commit_value('receipt-alias')->>'receiptId')::uuid),
  'legacy booking uses null for the unsupported case variant');

update private.v2_delegated_preparations
set summary=jsonb_set(summary,'{guestTimeZone}','"UTC"')
where preparation_id=(pg_temp.commit_value('prep-expiry')#>>'{data,preparationId}')::uuid;
select throws_ok($$select pg_temp.commit_booking('expiry','key-expiry')$$,
  'PT409','PREPARATION_STALE','a changed stored summary cannot be committed under the original digest');
update private.v2_delegated_preparations set summary=pg_temp.commit_value('prep-expiry')#>'{data,summary}'
where preparation_id=(pg_temp.commit_value('prep-expiry')#>>'{data,preparationId}')::uuid;

-- The attempt counter survives the rejected SQL subtransaction so this
-- assertion proves the candidate reached the late audit boundary.
create temporary sequence delegated_commit_late_attempts;
create function pg_temp.delay_delegated_commit_audit() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.action = 'booking_committed' then
    perform nextval('pg_temp.delegated_commit_late_attempts'::regclass);
    perform pg_sleep(greatest(0,extract(epoch from (
      (select expires_at from private.v2_delegated_preparations
       where preparation_id=(pg_temp.commit_value('prep-expiry')#>>'{data,preparationId}')::uuid)
      -clock_timestamp()+interval '25 milliseconds')))::double precision);
  end if;
  return new;
end;
$$;
create trigger commit_delay_audit before insert on private.v2_authority_events
for each row execute function pg_temp.delay_delegated_commit_audit();
update private.v2_delegated_preparations set expires_at=clock_timestamp()+interval '2 seconds'
where preparation_id=(pg_temp.commit_value('prep-expiry')#>>'{data,preparationId}')::uuid;
select throws_ok($$select pg_temp.commit_booking('expiry','key-expiry')$$,
  'PT409','PREPARATION_STALE','preparation expiry during the audit step rolls back the commit');
select ok((select is_called from pg_temp.delegated_commit_late_attempts),
  'the expired attempt reached the audit trigger before refusal');
select ok((select state='pending' and summary is not null from private.v2_delegated_preparations
  where preparation_id=(pg_temp.commit_value('prep-expiry')#>>'{data,preparationId}')::uuid),
  'late expiry preserves the original preparation record');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.commit_id('host')),3,
  'late expiry leaves no fourth booking');
select is((select count(*)::integer from private.v2_booking_receipts),3,
  'late expiry leaves no fourth consumption fence');
drop trigger commit_delay_audit on private.v2_authority_events;
select throws_ok($$select pg_temp.commit_booking('expiry','key-expiry')$$,
  'PT409','PREPARATION_STALE','an expired preparation refuses first commit');
update private.v2_mandates set issued_at=clock_timestamp()-interval '3 minutes',
  expires_at=clock_timestamp()-interval '2 minutes'
where mandate_id=pg_temp.commit_id('mandate-mandate-expiry');
select throws_ok($$select pg_temp.commit_booking('mandate-expiry','key-mandate-expiry')$$,
  'PT410','MANDATE_EXPIRED','an expired mandate refuses first commit');

select public.project_s_revoke_mandate_v2(pg_temp.commit_principal(),pg_temp.commit_id('mandate-revoked'),1);
select throws_ok($$select pg_temp.commit_booking('revoked','key-revoked')$$,
  'PT403','FORBIDDEN','a revoked mandate refuses first commit');
select public.project_s_revoke_mandate_v2(pg_temp.commit_principal(),pg_temp.commit_id('mandate-offset'),1);
select is(pg_temp.commit_booking('offset','key-offset'),pg_temp.commit_value('receipt-offset'),
  'eligible exact replay survives original mandate revocation');
select is(pg_temp.commit_read('offset'),pg_temp.commit_value('receipt-offset'),
  'eligible receipt access survives original mandate revocation');
select public.project_s_delete_booker_profile_v2(pg_temp.commit_principal(),pg_temp.commit_id('profile-alias'),1);
select throws_ok($$select pg_temp.commit_booking('profile','key-profile')$$,
  'PT403','FORBIDDEN','deleting a reviewed profile forbids an outstanding first commit');
select is(pg_temp.commit_read('alias'),pg_temp.commit_value('receipt-alias'),
  'eligible receipt contains minimal immutable display fields after profile deletion');

-- Exercise the live v1 preparation/confirmation/commit path against the same
-- host and slot as the existing v2 preparation. Both paths use the owner fence.
create function pg_temp.commit_v1_context(p_actor text, p_grant jsonb default null) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'requestId','commit-mixed-synthetic','actorKind',p_actor,'transport',case when p_actor='human' then 'ui' else 'http' end,
    'clientId',case when p_actor='human' then 'project-s-confirmation-ui' else 'mixed-commit-client' end,
    'scopes','["bookings:prepare","bookings:create"]'::jsonb,
    'provenance',jsonb_build_object('source',case when p_actor='human' then 'project_s_ui' else 'project_s_sdk' end,
      'clientVersion','0.1.0','networkKeyHash',repeat('e',64)),'confirmationGrant',p_grant));
$$;
insert into delegated_commit_fixture values ('v1-preparation',
  public.prepare_public_booking_v1(jsonb_build_object(
    'username','synthetic-commit-host','meetingTypeId',pg_temp.commit_id('meeting'),
    'startAt',pg_temp.commit_slot('15:15'),'guestTimeZone','UTC',
    'booker',jsonb_build_object('name','Synthetic Legacy Booker','email','legacy-commit-booker@example.invalid')),
    pg_temp.commit_v1_context('anonymous')));
select public.confirm_public_booking_preparation_v1(
  jsonb_build_object('preparationToken',pg_temp.commit_value('v1-preparation')->>'preparationToken'),
  pg_temp.commit_v1_context('human',jsonb_build_object('grantId',extensions.gen_random_uuid(),
    'confirmedAt',private.v2_mandate_instant(clock_timestamp()),'method','human_browser')));
insert into delegated_commit_fixture values ('v1-booking',public.commit_prepared_booking_v1(
  jsonb_build_object('preparationToken',pg_temp.commit_value('v1-preparation')->>'preparationToken',
    'idempotencyKey',pg_temp.commit_id('key-offset')),pg_temp.commit_v1_context('anonymous')));
select is(pg_temp.commit_value('v1-booking')->>'status','confirmed',
  'v1 can commit on the shared owner using the same raw client key as an unrelated v2 receipt');
select throws_ok($$select pg_temp.commit_booking('mixed','key-mixed')$$,
  'PT409','SLOT_UNAVAILABLE','v2 refuses an earlier v1 booking on its prepared slot');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.commit_id('host')
  and start_time=pg_temp.commit_slot('15:15')::timestamptz),1,
  'the mixed v1/v2 attempt leaves exactly one booking on the shared slot');

update private.v2_booking_receipts set committed_at=statement_timestamp()-interval '48 hours',
  expires_at=statement_timestamp()-interval '24 hours'
where receipt_id=(pg_temp.commit_value('receipt-iana')->>'receiptId')::uuid;
select throws_ok($$select pg_temp.commit_read('iana')$$,'PT410','RECEIPT_UNAVAILABLE',
  'expired receipt access refuses');
select throws_ok($$select pg_temp.commit_booking('iana','key-iana')$$,'PT410','RECEIPT_UNAVAILABLE',
  'expired receipt replay does not fall through to another first write');

select set_config('request.jwt.claim.sub',pg_temp.commit_id('host')::text,true);
select public.cancel_booking_v1((select booking_id from private.v2_booking_receipts
  where receipt_id=(pg_temp.commit_value('receipt-offset')->>'receiptId')::uuid),1);
select throws_ok($$select pg_temp.commit_read('offset')$$,'PT409','SLOT_UNAVAILABLE',
  'a cancelled booking does not return a confirmed receipt');
select throws_ok($$select pg_temp.commit_booking('offset','key-offset')$$,'PT409','SLOT_UNAVAILABLE',
  'cancelled exact replay does not recreate the booking');

delete from public.bookings where id=(select booking_id from private.v2_booking_receipts
  where receipt_id=(pg_temp.commit_value('receipt-alias')->>'receiptId')::uuid);
select throws_ok($$select pg_temp.commit_read('alias')$$,'PT410','RECEIPT_UNAVAILABLE',
  'a removed legacy booking leaves a refusal fence instead of a confirmed receipt');
select throws_ok($$select pg_temp.commit_booking('alias','key-alias')$$,'PT410','RECEIPT_UNAVAILABLE',
  'a removed legacy booking cannot be recreated by exact replay');
update private.v2_actor_credentials set issued_at=clock_timestamp()-interval '3 minutes',
  expires_at=clock_timestamp()-interval '2 minutes'
where credential_id=pg_temp.commit_id('credential-2');
select throws_ok($$select pg_temp.commit_booking('conflict','key-expired-actor',2)$$,
  'PT401','AUTHENTICATION_REQUIRED','expired credential cannot make a first commit');
select public.project_s_revoke_actor_v2(pg_temp.commit_principal(),pg_temp.commit_id('actor-1'),1);
select throws_ok($$select pg_temp.commit_read('alias')$$,'PT401','AUTHENTICATION_REQUIRED',
  'credential revocation closes original caller receipt access');
select throws_ok($$select pg_temp.commit_booking('alias','key-alias')$$,'PT401','AUTHENTICATION_REQUIRED',
  'credential revocation closes original caller replay');
select is((select count(*)::integer from private.v2_booking_receipts),3,
  'all refused retries preserve exactly three consumption fences');
select is((select count(*)::integer from private.v2_authority_events where action='booking_committed'),3,
  'there is exactly one success event for each successful delegated booking');
select ok(not exists(select 1 from private.v2_authority_events where action='booking_committed'
  and (to_jsonb(v2_authority_events)::text like '%private-commit-booker@example.invalid%'
    or to_jsonb(v2_authority_events)::text like '%' || pg_temp.commit_id('key-offset') || '%')),
  'the authoritative success audit carries no contact fields or raw client key');

select * from finish();
rollback;
