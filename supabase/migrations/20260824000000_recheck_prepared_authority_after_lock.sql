-- Keep time-bound preparation and confirmation authority honest across waits
-- on the per-owner scheduling lock. This forward migration preserves the
-- sealed agent-native baseline while making the post-lock clock authoritative.

begin;

set local search_path = pg_catalog, public, private, extensions;

create or replace function public.commit_prepared_booking_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_token text;
  v_idempotency_key uuid;
  v_preparation private.booking_preparations%rowtype;
  v_grant private.booking_confirmation_grants%rowtype;
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_current_revision bigint;
  v_host_display_name text;
  v_meeting_type_title text;
  v_host_time_zone text;
  v_duration smallint;
  v_minimum_notice integer;
  v_maximum_advance smallint;
  v_current_end_at timestamptz;
  v_current_summary_fingerprint bytea;
  v_effective_buffer_before smallint;
  v_effective_buffer_after smallint;
  v_slot_date date;
  v_now timestamptz;
begin
  perform private.validate_gateway_execution_context_v1(
    p_context,
    'bookings:create',
    false
  );

  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name not in (
         'preparationToken', 'idempotencyKey'
       )
     )
     or not (
       p_request ? 'preparationToken'
       and p_request ? 'idempotencyKey'
     )
     or jsonb_typeof(p_request -> 'preparationToken') <> 'string'
     or (p_request ->> 'preparationToken') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_request -> 'idempotencyKey') <> 'string' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_token := p_request ->> 'preparationToken';
  begin
    v_idempotency_key := (p_request ->> 'idempotencyKey')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end;

  -- The preparation record is retained after commit with PII redacted. This
  -- makes a lost-response replay resolvable even after expiry or publication
  -- changes without persisting the raw capability token.
  select *
  into v_preparation
  from private.booking_preparations as preparation_row
  where preparation_row.token_digest = extensions.digest(
    pg_catalog.convert_to(v_token, 'UTF8'),
    'sha256'
  )
  for update;

  if not found then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  if v_preparation.actor_fingerprint
     <> private.gateway_actor_fingerprint_v1(p_context) then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  -- Exact idempotent replay is resolved before expiry, grant state, active
  -- publication, schedule revision, or current wall-clock checks.
  select *
  into v_existing
  from public.bookings as booking_row
  where booking_row.idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.preparation_id <> v_preparation.id
       or v_existing.request_fingerprint <> v_preparation.request_fingerprint then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing.status <> 'confirmed' then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    end if;

    return jsonb_build_object(
      'confirmationCode', v_existing.confirmation_code,
      'status', 'confirmed',
      'username', v_preparation.username,
      'meetingTypeId', v_existing.meeting_type_id,
      'meetingTypeTitle', v_existing.meeting_type_title,
      'startAt', v_existing.start_time,
      'endAt', v_existing.end_time,
      'hostTimeZone', v_existing.host_timezone,
      'guestTimeZone', v_existing.guest_timezone,
      'idempotencyKey', v_existing.idempotency_key
    );
  end if;

  if v_preparation.state = 'committed' then
    raise exception using
      errcode = 'PT409',
      message = 'PREPARATION_ALREADY_COMMITTED';
  end if;

  v_now := clock_timestamp();
  if v_now >= v_preparation.expires_at then
    raise exception using errcode = 'PT410', message = 'PREPARATION_EXPIRED';
  end if;

  select *
  into v_grant
  from private.booking_confirmation_grants as grant_row
  where grant_row.preparation_id = v_preparation.id
  for update;

  if not found
     or v_grant.consumed_at is not null
     or v_grant.expires_at <= v_now
     or v_grant.audience <> v_preparation.audience
     or v_grant.summary_fingerprint <> v_preparation.summary_fingerprint then
    raise exception using errcode = 'PT409', message = 'CONFIRMATION_REQUIRED';
  end if;

  if p_context ? 'confirmationGrant'
     and (p_context #>> '{confirmationGrant,grantId}')::uuid <> v_grant.id then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_preparation.owner_id::text, 0)
  );

  -- Re-read every scheduling authority value only after the shared owner lock.
  select
    profile_row.full_name,
    meeting_type_row.title,
    profile_row.timezone,
    meeting_type_row.duration_minutes,
    meeting_type_row.minimum_notice_minutes,
    meeting_type_row.maximum_advance_days
  into
    v_host_display_name,
    v_meeting_type_title,
    v_host_time_zone,
    v_duration,
    v_minimum_notice,
    v_maximum_advance
  from public.meeting_types as meeting_type_row
  join public.profiles as profile_row
    on profile_row.id = meeting_type_row.user_id
  where meeting_type_row.id = v_preparation.meeting_type_id
    and meeting_type_row.user_id = v_preparation.owner_id
    and meeting_type_row.active
    and profile_row.username = v_preparation.username;

  if not found then
    raise exception using errcode = 'PT409', message = 'PREPARATION_STALE';
  end if;

  select version_row.revision
  into v_current_revision
  from private.scheduling_authority_versions as version_row
  where version_row.owner_id = v_preparation.owner_id;

  if not found or v_current_revision <> v_preparation.authority_revision then
    raise exception using errcode = 'PT409', message = 'PREPARATION_STALE';
  end if;

  v_now := clock_timestamp();

  -- The preparation and confirmation were valid before this transaction began
  -- waiting for the owner lock. Re-evaluate their time-bound authority against
  -- the fresh post-lock wall clock so a long schedule write cannot extend it.
  if v_now >= v_preparation.expires_at then
    raise exception using errcode = 'PT410', message = 'PREPARATION_EXPIRED';
  end if;

  if v_grant.consumed_at is not null
     or v_grant.expires_at <= v_now
     or v_grant.audience <> v_preparation.audience
     or v_grant.summary_fingerprint <> v_preparation.summary_fingerprint then
    raise exception using errcode = 'PT409', message = 'CONFIRMATION_REQUIRED';
  end if;

  v_current_end_at := private.add_minutes_utc(
    v_preparation.start_time,
    v_duration
  );
  v_current_summary_fingerprint :=
    private.public_booking_summary_fingerprint_v1(
      v_preparation.username,
      v_host_display_name,
      v_preparation.meeting_type_id,
      v_meeting_type_title,
      v_preparation.start_time,
      v_current_end_at,
      v_host_time_zone,
      v_preparation.guest_timezone,
      v_preparation.booker_name,
      v_preparation.booker_email,
      v_preparation.notes
    );

  if v_current_summary_fingerprint <> v_preparation.summary_fingerprint
     or v_preparation.start_time
       < v_now + (v_minimum_notice * interval '1 minute')
     or v_current_end_at
       > v_now + (v_maximum_advance * interval '1 day') then
    raise exception using errcode = 'PT409', message = 'PREPARATION_STALE';
  end if;

  v_slot_date := (
    v_preparation.start_time at time zone v_preparation.guest_timezone
  )::date;

  select free_slot.slot_buffer_before, free_slot.slot_buffer_after
  into v_effective_buffer_before, v_effective_buffer_after
  from private.compute_free_slots_v1(
    v_preparation.username,
    v_preparation.meeting_type_id,
    v_slot_date,
    v_preparation.guest_timezone,
    v_now
  ) as free_slot
  where free_slot.slot_start = v_preparation.start_time;

  if not found then
    raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
  end if;

  begin
    insert into public.bookings (
      user_id,
      meeting_type_id,
      start_time,
      duration_minutes,
      buffer_before_minutes,
      buffer_after_minutes,
      booker_name,
      booker_email,
      guest_timezone,
      meeting_type_title,
      host_timezone,
      notes,
      responses,
      idempotency_key,
      request_fingerprint,
      preparation_id
    )
    values (
      v_preparation.owner_id,
      v_preparation.meeting_type_id,
      v_preparation.start_time,
      v_duration,
      v_effective_buffer_before,
      v_effective_buffer_after,
      v_preparation.booker_name,
      v_preparation.booker_email,
      v_preparation.guest_timezone,
      v_meeting_type_title,
      v_host_time_zone,
      v_preparation.notes,
      jsonb_build_object('notes', v_preparation.notes),
      v_idempotency_key,
      v_preparation.request_fingerprint,
      v_preparation.id
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    when unique_violation then
      select *
      into v_existing
      from public.bookings as booking_row
      where booking_row.idempotency_key = v_idempotency_key;

      if found
         and v_existing.preparation_id = v_preparation.id
         and v_existing.request_fingerprint = v_preparation.request_fingerprint
         and v_existing.status = 'confirmed' then
        return jsonb_build_object(
          'confirmationCode', v_existing.confirmation_code,
          'status', 'confirmed',
          'username', v_preparation.username,
          'meetingTypeId', v_existing.meeting_type_id,
          'meetingTypeTitle', v_existing.meeting_type_title,
          'startAt', v_existing.start_time,
          'endAt', v_existing.end_time,
          'hostTimeZone', v_existing.host_timezone,
          'guestTimeZone', v_existing.guest_timezone,
          'idempotencyKey', v_existing.idempotency_key
        );
      end if;

      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
  end;

  update private.booking_confirmation_grants
  set
    consumed_at = v_now,
    consumed_by_booking_id = v_booking.id
  where id = v_grant.id;

  update private.booking_preparations
  set
    state = 'committed',
    committed_at = v_now,
    booker_name = null,
    booker_email = null,
    notes = null
  where id = v_preparation.id;

  perform private.append_booking_audit_event_v1(
    p_context,
    'project-s.public.create_booking.v1',
    'committed',
    v_preparation.id,
    v_grant.id,
    v_preparation.owner_id::text,
    v_idempotency_key
  );

  return jsonb_build_object(
    'confirmationCode', v_booking.confirmation_code,
    'status', 'confirmed',
    'username', v_preparation.username,
    'meetingTypeId', v_booking.meeting_type_id,
    'meetingTypeTitle', v_booking.meeting_type_title,
    'startAt', v_booking.start_time,
    'endAt', v_booking.end_time,
    'hostTimeZone', v_booking.host_timezone,
    'guestTimeZone', v_booking.guest_timezone,
    'idempotencyKey', v_booking.idempotency_key
  );
end;
$$;

revoke all on function public.commit_prepared_booking_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_prepared_booking_v1(jsonb, jsonb)
  to service_role;

comment on function public.commit_prepared_booking_v1(jsonb, jsonb) is
  'Gateway-only locked commit. Revalidates time-bound confirmation and current scheduling authority after the host lock, then inserts under the exclusion constraint.';

commit;
