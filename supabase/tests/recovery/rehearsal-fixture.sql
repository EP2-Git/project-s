-- Seed a disposable source database for the synthetic restore rehearsal.
begin;
set local search_path = pg_catalog;

do $$
begin
  if current_database() <> 'postgres'
    or exists (select 1 from auth.users)
    or exists (select 1 from public.bookings)
    or exists (select 1 from private.v2_authority_instance)
    or exists (select 1 from private.v2_authority_principals)
    or exists (select 1 from private.v2_booking_epoch_keys)
    or exists (select 1 from private.v2_booking_receipts)
  then
    raise exception 'Recovery fixture requires a fresh, unseeded disposable source database';
  end if;
end;
$$;

create schema recovery_rehearsal;

create function recovery_rehearsal.id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:restore-rehearsal:' || p_label) placing '4' from 13 for 1)
    placing '8' from 17 for 1)::uuid;
$$;

create function recovery_rehearsal.issuer(p_epoch bigint) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion', 2, 'requestId', 'synthetic-restore-rehearsal',
    'instanceId', recovery_rehearsal.id('instance'), 'epoch', p_epoch,
    'principalId', recovery_rehearsal.id('issuer'), 'subjectId', recovery_rehearsal.id('issuer'),
    'verifiedAt', private.v2_mandate_instant(clock_timestamp()), 'transport', 'ui');
$$;

insert into private.v2_authority_instance(instance_id, epoch, audience)
values (recovery_rehearsal.id('instance'), 1, 'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id, epoch)
values (recovery_rehearsal.id('instance'), 1);

insert into auth.users(instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, is_anonymous)
select '00000000-0000-0000-0000-000000000000', recovery_rehearsal.id(label), 'authenticated', 'authenticated',
  username || '@example.invalid', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', username, 'full_name', 'Synthetic Recovery Account', 'timezone', 'UTC'),
  clock_timestamp(), clock_timestamp(), '', '', '', '', false
from (values ('issuer', 'restore-rehearsal-issuer'), ('host', 'restore-rehearsal-host')) fixture(label, username);

insert into public.meeting_types(id, user_id, title, duration_minutes, slot_interval_minutes,
  buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, active)
values (recovery_rehearsal.id('meeting'), recovery_rehearsal.id('host'), 'Synthetic Recovery Meeting',
  30, 15, 0, 0, 0, true);
insert into public.specific_date_availabilities(user_id, date, status, start_time, end_time)
values (recovery_rehearsal.id('host'), (clock_timestamp() at time zone 'UTC')::date + 3, 'available', '09:00', '13:00');

-- The caller registers and verifies the synthetic credential separately.
-- Reuse the seeded host date across backup and restore.
create function recovery_rehearsal.book(
  p_epoch bigint, p_actor uuid, p_credential uuid, p_fingerprint text, p_hour integer
) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare
  v_suffix text := p_epoch || '-' || p_hour;
  v_profile_id uuid := recovery_rehearsal.id('profile-' || v_suffix);
  v_mandate_id uuid := recovery_rehearsal.id('mandate-' || v_suffix);
  v_preparation_id uuid := recovery_rehearsal.id('prep-' || v_suffix);
  v_key_id uuid := recovery_rehearsal.id('key-' || v_suffix);
  v_day date;
  v_request jsonb;
  v_actor_context jsonb;
  v_review jsonb;
  v_permission_start timestamptz;
  v_prepared jsonb;
  v_receipt jsonb;
begin
  if p_epoch is null or p_actor is null or p_credential is null
    or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$'
    or p_hour is null or p_hour not between 9 and 12
  then
    raise exception 'Invalid recovery booking fixture input';
  end if;

  select a.date into strict v_day from public.specific_date_availabilities a
    where a.user_id = recovery_rehearsal.id('host') and a.status = 'available'
      and a.start_time = time '09:00' and a.end_time = time '13:00';

  perform public.project_s_create_booker_profile_v2(recovery_rehearsal.issuer(p_epoch), v_profile_id,
    '{"name":"Synthetic Recovery Booker","email":"restore-rehearsal-booker@example.invalid","guestTimeZone":"UTC"}');
  v_request := jsonb_build_object('username', 'restore-rehearsal-host', 'meetingTypeId', recovery_rehearsal.id('meeting'));
  v_permission_start := clock_timestamp() + interval '3 seconds';
  v_review := public.project_s_create_mandate_review_v2(recovery_rehearsal.issuer(p_epoch),
    recovery_rehearsal.id('review-' || v_suffix), v_request || jsonb_build_object(
      'actorId', p_actor, 'profileId', v_profile_id, 'profileRevision', 1,
      'meetingWindowStart', private.v2_mandate_instant((v_day + time '09:00') at time zone 'UTC'),
      'meetingWindowEnd', private.v2_mandate_instant((v_day + time '13:00') at time zone 'UTC'),
      'maxDurationMinutes', 30, 'notBefore', private.v2_mandate_instant(v_permission_start),
      'expiresAt', private.v2_mandate_instant(v_permission_start + interval '1 hour')));
  perform public.project_s_approve_mandate_v2(recovery_rehearsal.issuer(p_epoch),
    (v_review->>'reviewId')::uuid, v_mandate_id, 1, v_review->>'summaryDigest');
  perform pg_sleep(greatest(0, extract(epoch from v_permission_start - clock_timestamp()
    + interval '20 milliseconds'))::double precision);

  v_actor_context := recovery_rehearsal.issuer(p_epoch) || jsonb_build_object(
    'transport', 'http', 'actorId', p_actor, 'credentialId', p_credential,
    'credentialRevision', 1, 'credentialFingerprint', p_fingerprint);
  v_prepared := public.project_s_prepare_delegated_booking_v2(v_actor_context, v_preparation_id,
    recovery_rehearsal.id('step-up-' || v_suffix), v_request || jsonb_build_object(
      'mandateId', v_mandate_id, 'startAt', private.v2_mandate_instant((v_day + make_time(p_hour, 0, 0)) at time zone 'UTC')));
  if (v_prepared->>'kind') is distinct from 'prepared'
    or (v_prepared#>>'{data,preparationId}')::uuid is distinct from v_preparation_id
  then
    raise exception 'Recovery fixture did not prepare the selected slot';
  end if;

  v_receipt := public.project_s_commit_delegated_booking_v2(v_actor_context, v_preparation_id, v_key_id);
  if (v_receipt->>'receiptId') is null then
    raise exception 'Recovery fixture did not commit a booking receipt';
  end if;
  return v_receipt;
end;
$$;

revoke all on schema recovery_rehearsal from public, anon, authenticated, service_role;
revoke all on all functions in schema recovery_rehearsal from public, anon, authenticated, service_role;
commit;
