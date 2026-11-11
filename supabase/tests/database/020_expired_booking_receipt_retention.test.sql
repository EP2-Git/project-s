begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.receipt_retention_id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:receipt-retention:' || p_label)
    placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
$$;

create function pg_temp.receipt_retention_principal(p_owner text) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion', 2, 'requestId', 'synthetic-receipt-retention',
    'instanceId', pg_temp.receipt_retention_id('instance'), 'epoch', 1,
    'principalId', pg_temp.receipt_retention_id(p_owner), 'subjectId', pg_temp.receipt_retention_id(p_owner),
    'verifiedAt', private.v2_mandate_instant(clock_timestamp()), 'transport', 'http');
$$;

create function pg_temp.receipt_retention_actor(p_owner text) returns jsonb
language sql set search_path = pg_catalog as $$
  select pg_temp.receipt_retention_principal(p_owner) || jsonb_build_object(
    'actorId', pg_temp.receipt_retention_id(p_owner || '-actor'),
    'credentialId', pg_temp.receipt_retention_id(p_owner || '-credential'),
    'credentialRevision', 1, 'credentialFingerprint', repeat(case when p_owner = 'issuer-a' then 'a' else 'b' end, 64));
$$;

create function pg_temp.receipt_redact(p_owner text, p_limit integer, p_epoch bigint default 1) returns integer
language sql set search_path = pg_catalog as $$
  select private.v2_redact_expired_booking_receipts(
    pg_temp.receipt_retention_id('instance'), p_epoch, pg_temp.receipt_retention_id(p_owner), p_limit);
$$;

create temporary table receipt_retention_fixture (
  label text primary key,
  issuer text not null,
  slot_start time not null,
  step_up boolean not null,
  expiry_offset interval,
  result jsonb
) on commit drop;

insert into receipt_retention_fixture (label, issuer, slot_start, step_up, expiry_offset) values
  ('standing', 'issuer-a', '09:30', false, interval '20 milliseconds'),
  ('exception', 'issuer-a', '13:00', true, interval '40 milliseconds'),
  ('live', 'issuer-a', '10:30', false, null),
  ('foreign', 'issuer-b', '11:30', false, interval '20 milliseconds');

create function pg_temp.receipt_retention_retry(p_label text, p_key text default null) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_commit_delegated_booking_v2(pg_temp.receipt_retention_actor(issuer),
    pg_temp.receipt_retention_id(p_label || '-prep'), pg_temp.receipt_retention_id(coalesce(p_key, p_label || '-key')))
  from pg_temp.receipt_retention_fixture where label = p_label;
$$;

create function pg_temp.receipt_retention_read(p_label text, p_issuer text default null) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_read_delegated_booking_receipt_v2(pg_temp.receipt_retention_actor(coalesce(p_issuer, issuer)),
    (result->>'receiptId')::uuid)
  from pg_temp.receipt_retention_fixture where label = p_label;
$$;

select ok(not p.prosecdef, 'cleanup runs with database caller privileges')
from pg_proc p where p.oid = 'private.v2_redact_expired_booking_receipts(uuid,bigint,uuid,integer)'::regprocedure;
select ok(not exists (
  select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = 'private.v2_redact_expired_booking_receipts(uuid,bigint,uuid,integer)'::regprocedure
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), 'PUBLIC cannot execute receipt cleanup');
select ok(not has_function_privilege(role_name,
  'private.v2_redact_expired_booking_receipts(uuid,bigint,uuid,integer)', 'EXECUTE'),
  role_name || ' cannot execute receipt cleanup')
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select throws_ok($$select pg_temp.receipt_redact('issuer-a', 1)$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'cleanup requires an active authority instance');
select throws_ok(format('select pg_temp.receipt_redact(%L, %L::integer)', 'issuer-a', batch_limit),
  '22023', 'INVALID_RETENTION_ARGUMENT', 'invalid limit is rejected: ' || coalesce(batch_limit::text, 'null'))
from (values (0), (101), (null::integer)) limits(batch_limit);

insert into private.v2_authority_instance(instance_id, epoch, audience)
values (pg_temp.receipt_retention_id('instance'), 1, 'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id, epoch)
values (pg_temp.receipt_retention_id('instance'), 1);
select throws_ok($$select pg_temp.receipt_redact('issuer-a', 1, 2)$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'cleanup rejects a wrong epoch');
select is(pg_temp.receipt_redact('unknown', 1), 0, 'a missing principal returns no work');

insert into auth.users(instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, is_anonymous)
select '00000000-0000-0000-0000-000000000000', pg_temp.receipt_retention_id(label), 'authenticated', 'authenticated',
  username || '@example.invalid', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', username, 'full_name', 'Synthetic Receipt Account', 'timezone', 'UTC'),
  clock_timestamp(), clock_timestamp(), '', '', '', '', false
from (values ('issuer-a', 'receipt-issuer-a'), ('issuer-b', 'receipt-issuer-b'), ('host', 'receipt-synthetic-host')) fixtures(label, username);
insert into public.meeting_types(id, user_id, title, duration_minutes, slot_interval_minutes,
  buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, active)
values (pg_temp.receipt_retention_id('meeting'), pg_temp.receipt_retention_id('host'),
  'Synthetic Receipt Meeting', 30, 15, 5, 5, 0, true);

do $$
declare
  fixture_day date := (clock_timestamp() at time zone 'UTC')::date + 3;
  permission_start timestamptz;
  issuer_name text;
  fixture record;
  request jsonb;
  review jsonb;
  prepared jsonb;
  review_id uuid;
begin
  insert into public.specific_date_availabilities(user_id, date, status, start_time, end_time)
  values (pg_temp.receipt_retention_id('host'), fixture_day, 'available', '09:00', '18:00');
  foreach issuer_name in array array['issuer-a', 'issuer-b'] loop
    perform public.project_s_register_actor_v2(pg_temp.receipt_retention_principal(issuer_name),
      pg_temp.receipt_retention_id(issuer_name || '-actor'), pg_temp.receipt_retention_id(issuer_name || '-credential'),
      decode(repeat(case when issuer_name = 'issuer-a' then 'a' else 'b' end, 64), 'hex'),
      'Synthetic receipt actor', clock_timestamp() + interval '2 days');
    perform public.project_s_create_booker_profile_v2(pg_temp.receipt_retention_principal(issuer_name),
      pg_temp.receipt_retention_id(issuer_name || '-profile'),
      '{"name":"Synthetic Receipt Booker","email":"receipt-booker@example.invalid","guestTimeZone":"+05:30"}');
  end loop;

  request := jsonb_build_object('username', 'receipt-synthetic-host', 'meetingTypeId', pg_temp.receipt_retention_id('meeting'));
  permission_start := clock_timestamp() + interval '5 seconds';
  for fixture in select * from receipt_retention_fixture loop
    review := public.project_s_create_mandate_review_v2(pg_temp.receipt_retention_principal(fixture.issuer),
      pg_temp.receipt_retention_id(fixture.label || '-issuance'), request || jsonb_build_object(
        'actorId', pg_temp.receipt_retention_id(fixture.issuer || '-actor'),
        'profileId', pg_temp.receipt_retention_id(fixture.issuer || '-profile'), 'profileRevision', 1,
        'meetingWindowStart', private.v2_mandate_instant((fixture_day + time '09:00') at time zone 'UTC'),
        'meetingWindowEnd', private.v2_mandate_instant((fixture_day + time '12:00') at time zone 'UTC'),
        'maxDurationMinutes', 30, 'notBefore', private.v2_mandate_instant(permission_start),
        'expiresAt', private.v2_mandate_instant(permission_start + interval '1 hour')));
    perform public.project_s_approve_mandate_v2(pg_temp.receipt_retention_principal(fixture.issuer),
      (review->>'reviewId')::uuid, pg_temp.receipt_retention_id(fixture.label || '-mandate'), 1, review->>'summaryDigest');
  end loop;
  perform pg_sleep(greatest(0, extract(epoch from permission_start - clock_timestamp() + interval '20 milliseconds')));

  for fixture in select * from receipt_retention_fixture loop
    prepared := public.project_s_prepare_delegated_booking_v2(pg_temp.receipt_retention_actor(fixture.issuer),
      pg_temp.receipt_retention_id(fixture.label || '-prep'), pg_temp.receipt_retention_id(fixture.label || '-review'),
      request || jsonb_build_object('mandateId', pg_temp.receipt_retention_id(fixture.label || '-mandate'),
        'startAt', private.v2_mandate_instant((fixture_day + fixture.slot_start) at time zone 'UTC')));
    if fixture.step_up then
      review_id := (prepared#>>'{stepUp,reviewId}')::uuid;
      review := public.project_s_get_step_up_review_v2(pg_temp.receipt_retention_principal(fixture.issuer), review_id);
      perform public.project_s_approve_step_up_v2(pg_temp.receipt_retention_principal(fixture.issuer), review_id,
        pg_temp.receipt_retention_id(fixture.label || '-prep'), pg_temp.receipt_retention_id(fixture.label || '-grant'),
        1, review->>'summaryDigest');
    end if;
    update receipt_retention_fixture set result = pg_temp.receipt_retention_retry(fixture.label)
    where label = fixture.label;
  end loop;
end;
$$;

select is(r.provider, case when f.step_up then 'principal_step_up' else 'local_mandate' end,
  f.label || ' booking committed with the expected provider')
from receipt_retention_fixture f left join private.v2_booking_receipts r on r.receipt_id = (f.result->>'receiptId')::uuid;
select is(pg_temp.receipt_retention_read(label), result, label || ' active receipt can be read exactly')
from receipt_retention_fixture;

-- Advance only the selected fixture receipt deadlines, preserving their 24-hour
-- constraint. The wall clock has passed these deadlines, unlike now().
update private.v2_booking_receipts r
set committed_at = transaction_timestamp() + f.expiry_offset - interval '24 hours',
  expires_at = transaction_timestamp() + f.expiry_offset
from receipt_retention_fixture f
where r.receipt_id = (f.result->>'receiptId')::uuid and f.expiry_offset is not null;

create temporary table receipt_retention_before on commit drop as
select r.* from private.v2_booking_receipts r join receipt_retention_fixture f on r.receipt_id = (f.result->>'receiptId')::uuid;
create temporary table receipt_bookings_before on commit drop as
select b.* from public.bookings b join receipt_retention_before r on r.booking_id = b.id;
create temporary table receipt_events_before on commit drop as
select * from private.v2_authority_events where instance_id = pg_temp.receipt_retention_id('instance');

select throws_ok(format('select pg_temp.receipt_retention_read(%L)', label),
  'PT410', 'RECEIPT_UNAVAILABLE', label || ' expiry already denies a receipt read before cleanup')
from receipt_retention_fixture where expiry_offset is not null;
select throws_ok(format('select pg_temp.receipt_retention_retry(%L)', label),
  'PT410', 'RECEIPT_UNAVAILABLE', label || ' expiry already denies an exact retry before cleanup')
from receipt_retention_fixture where expiry_offset is not null;

create function pg_temp.reject_receipt_cleanup_event() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.instance_id = pg_temp.receipt_retention_id('instance')
    and new.action = 'expired_booking_receipts_redacted'
  then
    raise exception 'synthetic receipt cleanup audit failure';
  end if;
  return new;
end;
$$;
create trigger reject_receipt_cleanup_event before insert on private.v2_authority_events
for each row execute function pg_temp.reject_receipt_cleanup_event();
select throws_ok($$select pg_temp.receipt_redact('issuer-a', 1)$$,
  'P0001', 'synthetic receipt cleanup audit failure', 'cleanup fails if the audit write fails');
select is((select count(*)::integer from private.v2_booking_receipts r join receipt_retention_before b using (receipt_id)
  where to_jsonb(r) = to_jsonb(b)), 4, 'a failed audit write rolls back the payload redaction');
select is((select event_sequence from private.v2_authority_principals
    where instance_id = pg_temp.receipt_retention_id('instance') and principal_id = pg_temp.receipt_retention_id('issuer-a')),
  (select max(sequence) from receipt_events_before where principal_id = pg_temp.receipt_retention_id('issuer-a')),
  'a failed audit write rolls back the sequence increment');
drop trigger reject_receipt_cleanup_event on private.v2_authority_events;

select is(pg_temp.receipt_redact('issuer-a', 1), 1, 'a batch of one redacts one expired receipt');
select is((select array_agg(f.label order by f.label)
  from private.v2_booking_receipts r join receipt_retention_fixture f on r.receipt_id = (f.result->>'receiptId')::uuid
  where r.booking is null), array['standing'], 'the oldest eligible expiry is redacted first');
select is(pg_temp.receipt_redact('issuer-a', 100), 1, 'the next batch redacts the expired exception receipt');
select is(pg_temp.receipt_redact('issuer-a', 100), 0, 'repeating the batch finds no more work');

select is((select count(*)::integer from private.v2_booking_receipts r join receipt_retention_before b using (receipt_id)
  where r.booking is null and r.principal_id = pg_temp.receipt_retention_id('issuer-a')
    and (to_jsonb(r) - 'booking') = (to_jsonb(b) - 'booking')), 2,
  'redaction clears both payloads and preserves the exact receipt fences and bindings');
select is((select count(*)::integer from private.v2_booking_receipts r join receipt_retention_before b using (receipt_id)
  where to_jsonb(r) = to_jsonb(b)), 2, 'live and other-issuer receipts are unchanged');
select is((select count(*)::integer from public.bookings b join receipt_bookings_before old using (id)
  where to_jsonb(b) = to_jsonb(old)), 4, 'redaction does not change or remove a booking');
select is((select count(*)::integer from receipt_events_before old join private.v2_authority_events e
  using (instance_id, epoch, principal_id, sequence) where to_jsonb(old) = to_jsonb(e)),
  (select count(*)::integer from receipt_events_before), 'prior audit records remain intact');
select is((select count(*)::integer from private.v2_authority_events
  where instance_id = pg_temp.receipt_retention_id('instance') and action = 'expired_booking_receipts_redacted'),
  2, 'only nonempty batches add cleanup audit events');
select ok((select bool_and(principal_id = pg_temp.receipt_retention_id('issuer-a') and occurred_at > transaction_timestamp())
  from private.v2_authority_events
  where instance_id = pg_temp.receipt_retention_id('instance') and action = 'expired_booking_receipts_redacted'),
  'cleanup audit events use a fresh clock and the selected issuer');

select is(pg_temp.receipt_retention_retry('live'), (select result from receipt_retention_fixture where label = 'live'),
  'a live receipt can still be replayed exactly after cleanup');
select throws_ok($$select pg_temp.receipt_retention_read('standing', 'issuer-b')$$,
  'PT403', 'FORBIDDEN', 'another issuer cannot look up the redacted receipt');
select throws_ok(format('select pg_temp.receipt_retention_read(%L)', label),
  'PT410', 'RECEIPT_UNAVAILABLE', label || ' read remains unavailable after redaction')
from receipt_retention_fixture where label in ('standing', 'exception');
select throws_ok(format('select pg_temp.receipt_retention_retry(%L)', label),
  'PT410', 'RECEIPT_UNAVAILABLE', label || ' exact retry remains unavailable after redaction')
from receipt_retention_fixture where label in ('standing', 'exception');
select throws_ok(format('select pg_temp.receipt_retention_retry(%L, %L)', label, 'fresh-key'),
  'PT403', 'FORBIDDEN', label || ' cannot spend the redacted receipt mandate again with a fresh key')
from receipt_retention_fixture where label in ('standing', 'exception');
select throws_ok($$select public.project_s_commit_delegated_booking_v2(pg_temp.receipt_retention_actor('issuer-a'),
  pg_temp.receipt_retention_id('live-prep'), pg_temp.receipt_retention_id('standing-key'))$$,
  'PT409', 'IDEMPOTENCY_KEY_REUSED', 'the original retry key remains bound to the redacted preparation');
select is(public.project_s_get_mandate_v2(pg_temp.receipt_retention_principal('issuer-a'),
  pg_temp.receipt_retention_id('standing-mandate'))->>'remainingUses', '0', 'the standing mandate stays spent');

update private.v2_authority_principals set disabled = true where principal_id = pg_temp.receipt_retention_id('issuer-b');
delete from auth.users where id = pg_temp.receipt_retention_id('issuer-b');
select is(pg_temp.receipt_redact('issuer-b', 1), 1, 'an expired payload can be redacted after the issuer account is deleted');

-- Simulate a clock earlier than the erased receipt's expiry to isolate the
-- missing-payload guard from the deadline check.
update private.v2_booking_receipts r
set committed_at = transaction_timestamp() - interval '1 hour',
  expires_at = transaction_timestamp() + interval '23 hours'
from receipt_retention_fixture f
where f.label = 'standing' and r.receipt_id = (f.result->>'receiptId')::uuid;
select throws_ok($$select pg_temp.receipt_retention_read('standing')$$,
  'PT410', 'RECEIPT_UNAVAILABLE', 'a redacted payload is unavailable even before its simulated deadline');
select throws_ok($$select pg_temp.receipt_retention_retry('standing')$$,
  'PT410', 'RECEIPT_UNAVAILABLE', 'an exact replay cannot resurrect a redacted payload after a simulated clock rewind');

select * from finish();
rollback;
