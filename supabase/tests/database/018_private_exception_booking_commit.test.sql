begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- All authority, accounts and bookings in this test roll back together.
create temporary table exception_booking_fixture (key text primary key, value jsonb) on commit drop;

create function pg_temp.exception_id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:exception-commit-test:' || p_label) placing '4' from 13 for 1)
    placing '8' from 17 for 1)::uuid;
$$;

create function pg_temp.exception_value(p_key text) returns jsonb
language sql set search_path = pg_catalog as $$
  select value from pg_temp.exception_booking_fixture where key=p_key;
$$;

create function pg_temp.exception_principal(p_owner integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion',2,'requestId','synthetic-exception-commit',
    'instanceId',pg_temp.exception_id('instance'),'epoch',1,
    'principalId',pg_temp.exception_id('owner-' || p_owner),
    'subjectId',pg_temp.exception_id('owner-' || p_owner),
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','http');
$$;

create function pg_temp.exception_actor(p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select pg_temp.exception_principal(case when p_actor=2 then 2 else 1 end) || jsonb_build_object(
    'actorId',pg_temp.exception_id('actor-' || p_actor),'credentialId',pg_temp.exception_id('credential-' || p_actor),
    'credentialRevision',1,'credentialFingerprint',repeat(case p_actor when 1 then 'a' when 2 then 'b' else 'c' end,64));
$$;

create function pg_temp.exception_slot(p_time time) returns text
language sql set search_path = pg_catalog as $$
  select private.v2_mandate_instant(
    (((pg_temp.exception_value('day')#>>'{}')::date + p_time) at time zone 'UTC'));
$$;

create function pg_temp.exception_prepare(p_mandate text,p_time time) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_prepare_delegated_booking_v2(pg_temp.exception_actor(),
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),jsonb_build_object(
      'mandateId',pg_temp.exception_id('mandate-' || p_mandate),
      'username','synthetic-exception-host','meetingTypeId',pg_temp.exception_id('meeting'),
      'startAt',pg_temp.exception_slot(p_time)));
$$;

create function pg_temp.exception_review_id(p_label text) returns uuid
language sql set search_path = pg_catalog as $$
  select (pg_temp.exception_value('request-' || p_label)#>>'{stepUp,reviewId}')::uuid;
$$;

create function pg_temp.exception_approve(p_label text,p_owner integer default 1,p_digest text default null) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_approve_step_up_v2(pg_temp.exception_principal(p_owner),
    pg_temp.exception_review_id(p_label),pg_temp.exception_id('prep-' || p_label),
    pg_temp.exception_id('grant-' || p_label),1,
    coalesce(p_digest,pg_temp.exception_value('review-' || p_label)->>'summaryDigest'));
$$;

create function pg_temp.exception_commit(p_label text,p_key text,p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_commit_delegated_booking_v2(pg_temp.exception_actor(p_actor),
    pg_temp.exception_id('prep-' || p_label),pg_temp.exception_id(p_key));
$$;

create function pg_temp.exception_read(p_actor integer default 1) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_read_delegated_booking_receipt_v2(pg_temp.exception_actor(p_actor),
    (pg_temp.exception_value('receipt-main')->>'receiptId')::uuid);
$$;

create function pg_temp.exception_snapshot() returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object(
    'sequence',(select event_sequence from private.v2_authority_principals
      where principal_id=pg_temp.exception_id('owner-1')),
    'reviews',(select jsonb_agg(to_jsonb(r) order by review_id) from private.v2_step_up_requests r),
    'grants',(select jsonb_agg(to_jsonb(g) order by grant_id) from private.v2_step_up_grants g),
    'preparations',(select jsonb_agg(to_jsonb(p) order by preparation_id) from private.v2_step_up_preparations p),
    'bookings',(select jsonb_agg(to_jsonb(b) order by id) from public.bookings b
      where user_id=pg_temp.exception_id('host')),
    'receipts',(select jsonb_agg(to_jsonb(r) order by receipt_id) from private.v2_booking_receipts r));
$$;

insert into private.v2_authority_instance(instance_id,epoch,audience)
values (pg_temp.exception_id('instance'),1,'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id,epoch)
values (pg_temp.exception_id('instance'),1);
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',pg_temp.exception_id(label),'authenticated','authenticated',
  username || '@example.invalid',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Exception Account','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values ('owner-1','synthetic-exception-a'),('owner-2','synthetic-exception-b'),
  ('host','synthetic-exception-host')) users(label,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,slot_interval_minutes,
  buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,active)
values (pg_temp.exception_id('meeting'),pg_temp.exception_id('host'),'Synthetic Exception Meeting',30,15,5,5,0,true);
insert into exception_booking_fixture values ('day',to_jsonb((clock_timestamp() at time zone 'UTC')::date+3));
insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
values (pg_temp.exception_id('host'),(pg_temp.exception_value('day')#>>'{}')::date,'available','09:00','18:00');

do $$
declare
  actor integer;
  label text;
  review jsonb;
  permission_start timestamptz;
begin
  for actor in 1..3 loop
    perform public.project_s_register_actor_v2(pg_temp.exception_principal(case when actor=2 then 2 else 1 end),
      pg_temp.exception_id('actor-' || actor),pg_temp.exception_id('credential-' || actor),
      decode(repeat(case actor when 1 then 'a' when 2 then 'b' else 'c' end,64),'hex'),
      'Synthetic exception actor',clock_timestamp()+interval '2 days');
  end loop;
  perform public.project_s_create_booker_profile_v2(pg_temp.exception_principal(),pg_temp.exception_id('profile'),
    '{"name":"Synthetic Private Exception Booker","email":"private-exception-booker@example.invalid","guestTimeZone":"+05:30"}');
  permission_start:=clock_timestamp()+interval '5 seconds';
  foreach label in array array['main','expired','revoked','original-revoke','stale'] loop
    review:=public.project_s_create_mandate_review_v2(pg_temp.exception_principal(),
      pg_temp.exception_id('issuance-' || label),jsonb_build_object(
        'actorId',pg_temp.exception_id('actor-1'),'profileId',pg_temp.exception_id('profile'),
        'profileRevision',1,'username','synthetic-exception-host','meetingTypeId',pg_temp.exception_id('meeting'),
        'meetingWindowStart',pg_temp.exception_slot('09:00'),'meetingWindowEnd',pg_temp.exception_slot('11:00'),
        'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
        'expiresAt',private.v2_mandate_instant(clock_timestamp()+interval '1 hour')));
    perform public.project_s_approve_mandate_v2(pg_temp.exception_principal(),(review->>'reviewId')::uuid,
      pg_temp.exception_id('mandate-' || label),1,review->>'summaryDigest');
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start-clock_timestamp()+interval '20 milliseconds')))::double precision);
end;
$$;

insert into exception_booking_fixture values ('ordinary-main',pg_temp.exception_prepare('main','10:00'));
insert into exception_booking_fixture
select 'request-' || label,pg_temp.exception_prepare(mandate,slot::time)
from (values ('main','main','12:00'),('sibling','main','12:45'),('expired','expired','13:30'),
  ('revoked','revoked','14:15'),('original-revoke','original-revoke','15:00'),
  ('stale','stale','15:45')) requested(label,mandate,slot);
insert into exception_booking_fixture
select 'review-' || label,public.project_s_get_step_up_review_v2(pg_temp.exception_principal(),pg_temp.exception_review_id(label))
from unnest(array['main','sibling','expired','revoked','original-revoke','stale']) labels(label);

select is(pg_temp.exception_value('ordinary-main')->>'kind','prepared',
  'the original mandate can prepare an in-scope slot before replacement');
select is(pg_temp.exception_value('request-main')->>'kind','step_up_required',
  'the 12:00 request lies outside the original window ending at 11:00');
select is(pg_temp.exception_value('review-main')#>>'{exactSummary,startAt}',pg_temp.exception_slot('12:00'),
  'issuer sees the exact exception slot before approval');
select is(pg_temp.exception_value('review-main')#>>'{exactSummary,email}','private-exception-booker@example.invalid',
  'issuer review shows the approved contact only in the issuer path');
select ok(pg_temp.exception_value('request-main')::text not like '%private-exception-booker@example.invalid%',
  'actor escalation carries an opaque review reference instead of contact details');
select throws_ok($$select public.project_s_commit_delegated_booking_v2(
  pg_temp.exception_actor(),pg_temp.exception_review_id('main'),pg_temp.exception_id('key-main'))$$,
  'PT403','FORBIDDEN','a pending review ID cannot authorize a booking');
select throws_ok($$select pg_temp.exception_commit('main','key-main')$$,
  'PT403','FORBIDDEN','a proposed replacement preparation is unusable before approval');
select throws_ok($$select pg_temp.exception_approve('main',2)$$,
  'PT403','FORBIDDEN','another principal cannot approve a known exception');
select throws_ok($$select pg_temp.exception_approve('main',p_digest=>repeat('f',64))$$,
  'PT409','VERSION_CONFLICT','human approval with a different summary digest is refused');

insert into exception_booking_fixture values ('approved-main',pg_temp.exception_approve('main'));
select is(pg_temp.exception_value('approved-main')->>'preparationId',pg_temp.exception_id('prep-main')::text,
  'exact approval creates a separate replacement preparation');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.exception_id('host')),0,
  'approval alone creates no booking');
select throws_ok($$select public.project_s_commit_delegated_booking_v2(pg_temp.exception_actor(),
  (pg_temp.exception_value('ordinary-main')#>>'{data,preparationId}')::uuid,pg_temp.exception_id('key-main'))$$,
  'PT403','FORBIDDEN','the superseded standing preparation cannot use the original budget');
select throws_ok($$select pg_temp.exception_approve('sibling')$$,
  'PT409','VERSION_CONFLICT','approval invalidates a sibling review of the original mandate');
select throws_ok($$select pg_temp.exception_commit('sibling','key-main')$$,
  'PT403','FORBIDDEN','the sibling cannot produce a usable replacement preparation');
select throws_ok($$select pg_temp.exception_commit('main','key-main',2)$$,
  'PT403','FORBIDDEN','another principal cannot use the approved replacement');
select throws_ok($$select pg_temp.exception_commit('main','key-main',3)$$,
  'PT403','FORBIDDEN','another credential of the original principal cannot use the replacement');

create function pg_temp.reject_exception_commit_audit() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.action='booking_committed' then
    raise exception sqlstate 'P0001' using message='synthetic exception booking audit failure';
  end if;
  return new;
end;
$$;
create trigger exception_commit_reject_audit before insert on private.v2_authority_events
for each row execute function pg_temp.reject_exception_commit_audit();
insert into exception_booking_fixture values ('before-audit-failure',pg_temp.exception_snapshot());
select throws_ok($$select pg_temp.exception_commit('main','key-main')$$,
  'P0001','synthetic exception booking audit failure','audit failure aborts the exact approved booking');
select is(pg_temp.exception_snapshot(),pg_temp.exception_value('before-audit-failure'),
  'failed audit changes no booking, receipt, grant, preparation or sequence');
drop trigger exception_commit_reject_audit on private.v2_authority_events;

insert into exception_booking_fixture values ('receipt-main',pg_temp.exception_commit('main','key-main'));
select is((select array_agg(field order by field) from jsonb_object_keys(pg_temp.exception_value('receipt-main')) fields(field)),
  array['booking','receiptExpiresAt','receiptId'],'exception uses the strict existing receipt data shape');
select is((select array_agg(field order by field) from jsonb_object_keys(pg_temp.exception_value('receipt-main')->'booking') fields(field)),
  array['confirmationCode','endAt','guestTimeZone','hostTimeZone','meetingTypeId','meetingTypeTitle','startAt','status','username'],
  'exception receipt contains only approved booking display fields');
select is(pg_temp.exception_value('receipt-main')#>>'{booking,startAt}',
  pg_temp.exception_value('review-main')#>>'{exactSummary,startAt}','commit uses the exact human-reviewed start');
select is(pg_temp.exception_value('receipt-main')#>>'{booking,endAt}',
  pg_temp.exception_value('review-main')#>>'{exactSummary,endAt}','commit uses the exact human-reviewed end');
select is(pg_temp.exception_value('receipt-main')#>>'{booking,guestTimeZone}','+05:30',
  'exception receipt preserves the exact reviewed guest timezone');
select ok((select r.mandate_id=pg_temp.exception_id('mandate-main') and r.preparation_id=pg_temp.exception_id('prep-main')
    and b.guest_timezone is null and b.preparation_id is null and b.status='confirmed'
    and b.booker_email='private-exception-booker@example.invalid'
    and b.buffer_before_minutes=5 and b.buffer_after_minutes=5
  from private.v2_booking_receipts r join public.bookings b on b.id=r.booking_id
  where r.receipt_id=(pg_temp.exception_value('receipt-main')->>'receiptId')::uuid),
  'receipt consumes the original mandate while the legacy booking keeps approved contact and scheduling fields');
select is((select count(*)::integer from public.bookings where user_id=pg_temp.exception_id('host')),1,
  'the exact exception creates one booking');

insert into exception_booking_fixture values ('after-success',pg_temp.exception_snapshot());
select is(pg_temp.exception_commit('main','key-main'),pg_temp.exception_value('receipt-main'),
  'an identical retry returns the original exception receipt');
select is(pg_temp.exception_read(),pg_temp.exception_value('receipt-main'),
  'the original actor can read the same receipt');
select throws_ok($$select pg_temp.exception_read(2)$$,
  'PT403','FORBIDDEN','another principal cannot read the exception receipt');
select throws_ok($$select pg_temp.exception_read(3)$$,
  'PT403','FORBIDDEN','another credential of the same principal cannot read the exception receipt');
select throws_ok($$select public.project_s_commit_delegated_booking_v2(pg_temp.exception_actor(),
  (pg_temp.exception_value('ordinary-main')#>>'{data,preparationId}')::uuid,pg_temp.exception_id('key-main'))$$,
  'PT409','IDEMPOTENCY_KEY_REUSED','the exception key cannot switch to the standing preparation');
select throws_ok($$select pg_temp.exception_commit('main','key-different')$$,
  'PT403','FORBIDDEN','a different key cannot spend the same original budget again');
select throws_ok($$select pg_temp.exception_approve('main')$$,
  'PT409','VERSION_CONFLICT','approval retry cannot revive a spent replacement');
select is(pg_temp.exception_snapshot(),pg_temp.exception_value('after-success'),
  'eligible replays and refusals create no new booking, receipt, authority or event');

select is(public.project_s_revoke_step_up_v2(pg_temp.exception_principal(),pg_temp.exception_review_id('main'),2)->>'state',
  'revoked','the issuer can revoke the already-used exact exception');
select ok(pg_temp.exception_commit('main','key-main')=pg_temp.exception_value('receipt-main')
  and (select count(*) from public.bookings where user_id=pg_temp.exception_id('host'))=1,
  'revoking used authority still allows the original credential to recover exactly one booking receipt');

insert into exception_booking_fixture
select 'approved-' || label,pg_temp.exception_approve(label)
from unnest(array['expired','revoked','original-revoke','stale']) labels(label);
update private.v2_step_up_grants set expires_at=issued_at+interval '1 microsecond'
where grant_id=pg_temp.exception_id('grant-expired');
update private.v2_step_up_preparations set expires_at=created_at+interval '1 microsecond'
where preparation_id=pg_temp.exception_id('prep-expired');
select throws_ok($$select pg_temp.exception_commit('expired','key-expired')$$,
  'PT409','PREPARATION_STALE','an expired approved replacement cannot make a first commit');

select public.project_s_revoke_step_up_v2(pg_temp.exception_principal(),pg_temp.exception_review_id('revoked'),2);
select throws_ok($$select pg_temp.exception_commit('revoked','key-revoked')$$,
  'PT403','FORBIDDEN','revoking the exact exception closes its first write');
select public.project_s_revoke_mandate_v2(pg_temp.exception_principal(),
  pg_temp.exception_id('mandate-original-revoke'),1);
select throws_ok($$select pg_temp.exception_commit('original-revoke','key-original-revoke')$$,
  'PT403','FORBIDDEN','revoking the original mandate also closes its approved replacement');

-- Force a UUID collision across the two provider tables for the same actor.
update private.v2_delegated_preparations set preparation_id=pg_temp.exception_id('prep-stale')
where preparation_id=(pg_temp.exception_value('ordinary-main')#>>'{data,preparationId}')::uuid;
select throws_ok($$select pg_temp.exception_commit('stale','key-stale')$$,
  'PT403','FORBIDDEN','a preparation ID resolving to both providers is ambiguous');
update private.v2_delegated_preparations
set preparation_id=(pg_temp.exception_value('ordinary-main')#>>'{data,preparationId}')::uuid
where preparation_id=pg_temp.exception_id('prep-stale');

update public.meeting_types set title='Updated Synthetic Exception Meeting' where id=pg_temp.exception_id('meeting');
select throws_ok($$select pg_temp.exception_commit('stale','key-stale')$$,
  'PT409','PREPARATION_STALE','changed host scheduling facts make the exact preparation stale');

select public.project_s_revoke_actor_v2(pg_temp.exception_principal(),pg_temp.exception_id('actor-1'),1);
select throws_ok($$select pg_temp.exception_read()$$,'PT401','AUTHENTICATION_REQUIRED',
  'credential revocation closes original receipt access');
select throws_ok($$select pg_temp.exception_commit('main','key-main')$$,'PT401','AUTHENTICATION_REQUIRED',
  'credential revocation closes exact retry');
select is((select count(*)::integer from private.v2_booking_receipts),1,
  'expiry, revocation and stale refusals preserve exactly one shared consumption fence');
select is((select count(*)::integer from private.v2_authority_events where action='booking_committed'),1,
  'only the successful exact booking records a commit event');
select ok(not exists(select 1 from private.v2_authority_events e where action='booking_committed'
  and (to_jsonb(e)::text like '%private-exception-booker@example.invalid%'
    or to_jsonb(e)::text like '%' || pg_temp.exception_id('key-main') || '%')),
  'authoritative audit carries no contact fields or raw client key');

select * from finish();
rollback;
