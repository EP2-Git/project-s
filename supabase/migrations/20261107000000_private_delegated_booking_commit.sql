-- Private standing-mandate commit and receipt under ADR 0004.
-- Provisioning and route enablement are separate from this migration.
begin;
set local search_path = pg_catalog;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered','actor_revoked','profile_reviewed','profile_deleted',
    'mandate_reviewed','mandate_approved','mandate_revoked','preparation_created','step_up_requested',
    'step_up_approved','step_up_revoked','expired_mandate_reviews_redacted','booking_committed'));

create table private.v2_booking_epoch_keys (
  instance_id uuid not null,
  epoch bigint not null check (epoch between 1 and 9007199254740991),
  key bytea not null default extensions.gen_random_bytes(32) check (octet_length(key) = 32),
  primary key (instance_id, epoch)
);

create function private.v2_reject_booking_epoch_key_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception sqlstate '22023' using message = 'IMMUTABLE_BOOKING_EPOCH_KEY';
end;
$$;
create trigger v2_booking_epoch_key_immutable
  before update on private.v2_booking_epoch_keys
  for each row execute function private.v2_reject_booking_epoch_key_update();

alter table private.v2_delegated_preparations add constraint v2_delegated_preparations_receipt_binding_key
  unique (instance_id, epoch, principal_id, actor_id, credential_id, preparation_id, mandate_id, intent_digest);

create table private.v2_booking_receipts (
  receipt_id uuid primary key default extensions.gen_random_uuid(),
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  actor_id uuid not null,
  credential_id uuid not null,
  preparation_id uuid not null,
  mandate_id uuid not null,
  booking_id uuid not null unique,
  key_digest bytea not null check (octet_length(key_digest) = 32),
  intent_digest text not null check (intent_digest ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz not null,
  expires_at timestamptz not null,
  committed_sequence bigint not null,
  booking jsonb not null check (jsonb_typeof(booking) = 'object'),
  -- Expired receipts still fence the original mandate and idempotency identity.
  unique (instance_id, epoch, principal_id, mandate_id),
  unique (instance_id, epoch, principal_id, actor_id, credential_id, key_digest),
  check (isfinite(committed_at) and isfinite(expires_at)
    and expires_at = committed_at + interval '24 hours'),
  foreign key (instance_id, epoch)
    references private.v2_booking_epoch_keys(instance_id, epoch),
  foreign key (instance_id, epoch, principal_id, actor_id, credential_id, preparation_id, mandate_id, intent_digest)
    references private.v2_delegated_preparations(instance_id, epoch, principal_id, actor_id,
      credential_id, preparation_id, mandate_id, intent_digest),
  foreign key (instance_id, epoch, principal_id, committed_sequence)
    references private.v2_authority_events(instance_id, epoch, principal_id, sequence)
);
alter table private.v2_booking_epoch_keys enable row level security;
alter table private.v2_booking_receipts enable row level security;
revoke all on private.v2_booking_epoch_keys, private.v2_booking_receipts
  from public, anon, authenticated, service_role;

create function private.v2_assert_mandate_unused(
  p_instance_id uuid, p_epoch bigint, p_principal_id uuid, p_mandate_id uuid)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  if exists (
    select 1 from private.v2_booking_receipts r
    where (r.instance_id,r.epoch,r.principal_id,r.mandate_id)
      = (p_instance_id,p_epoch,p_principal_id,p_mandate_id)
  ) then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
end;
$$;

create function private.v2_live_booking_actor(p_credential private.v2_actor_credentials)
returns timestamptz language plpgsql set search_path = pg_catalog as $$
declare
  v_now timestamptz;
begin
  perform private.v2_assert_account(p_credential.principal_id);
  perform private.v2_assert_instance(p_credential.instance_id,p_credential.epoch);
  v_now := clock_timestamp();
  if p_credential.state <> 'active'
    or v_now < p_credential.issued_at or v_now >= p_credential.expires_at
  then raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED'; end if;
  return v_now;
end;
$$;

create function private.v2_lock_booking_actor(p_context jsonb)
returns private.v2_actor_credentials language plpgsql set search_path = pg_catalog as $$
declare
  c record;
  v_disabled boolean;
  v_credential private.v2_actor_credentials%rowtype;
begin
  select * into c from private.v2_actor_context(p_context);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id,p.epoch,p.principal_id) = (c.instance_id,c.epoch,c.principal_id)
    for update;
  if not found or v_disabled then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  select * into v_credential from private.v2_actor_credentials a
    where (a.instance_id,a.epoch,a.principal_id,a.actor_id,a.credential_id)
      = (c.instance_id,c.epoch,c.principal_id,c.actor_id,c.credential_id)
    for update;
  if not found or v_credential.revision <> c.credential_revision
    or encode(v_credential.verifier,'hex') <> c.credential_fingerprint
  then raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED'; end if;
  perform private.v2_live_booking_actor(v_credential);
  return v_credential;
end;
$$;

create function private.v2_standing_commit_clock(p_credential private.v2_actor_credentials,
  p_profile private.v2_booker_profiles, p_mandate private.v2_mandates,
  p_preparation private.v2_delegated_preparations)
returns timestamptz language plpgsql set search_path = pg_catalog as $$
declare
  v_now timestamptz := private.v2_live_booking_actor(p_credential);
begin
  if p_profile.state <> 'active' or p_profile.reviewed_at > v_now or p_profile.expires_at <= v_now
    or p_profile.revision <> p_preparation.profile_revision
    or p_profile.profile_id <> p_preparation.profile_id
    or p_mandate.state <> 'active' or p_mandate.superseded_by_step_up is not null
    or p_mandate.mandate_id <> p_preparation.mandate_id or p_mandate.issued_at > v_now
    or p_mandate.revision <> p_preparation.mandate_revision
    or p_mandate.credential_revision <> p_credential.revision
    or p_preparation.credential_revision <> p_credential.revision
    or (v_now >= (p_mandate.policy->>'notBefore')::timestamptz) is not true
  then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  if p_mandate.expires_at <= v_now then
    raise exception sqlstate 'PT410' using message = 'MANDATE_EXPIRED';
  end if;
  if p_preparation.state <> 'pending' or p_preparation.created_at > v_now or p_preparation.expires_at <= v_now
    or p_preparation.provider <> 'local_mandate' or p_preparation.provider_version <> 1
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;
  return v_now;
end;
$$;

create function private.v2_booking_receipt_data(p_receipt private.v2_booking_receipts)
returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('receiptId',(p_receipt).receipt_id,
    'receiptExpiresAt',private.v2_mandate_instant((p_receipt).expires_at),
    'booking',(p_receipt).booking);
$$;

create function private.v2_confirmed_booking_receipt(p_credential private.v2_actor_credentials,
  p_receipt private.v2_booking_receipts)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare
  v_status text;
  v_now timestamptz;
begin
  v_now := private.v2_live_booking_actor(p_credential);
  if p_receipt.committed_at > v_now or p_receipt.expires_at <= v_now then
    raise exception sqlstate 'PT410' using message = 'RECEIPT_UNAVAILABLE';
  end if;
  -- Cancellation owns the shared owner fence before locking the booking.
  -- Receipt reads acquire no owner fence and never wait on that booking row.
  select b.status into v_status from public.bookings b
    where b.id = p_receipt.booking_id for share nowait;
  v_now := private.v2_live_booking_actor(p_credential);
  if p_receipt.committed_at > v_now or p_receipt.expires_at <= v_now or v_status is null
  then raise exception sqlstate 'PT410' using message = 'RECEIPT_UNAVAILABLE'; end if;
  if v_status <> 'confirmed' then
    raise exception sqlstate 'PT409' using message = 'SLOT_UNAVAILABLE';
  end if;
  return private.v2_booking_receipt_data(p_receipt);
end;
$$;

create function public.project_s_commit_delegated_booking_v2(
  p_context jsonb, p_preparation_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s' as $$
declare
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_preparation private.v2_delegated_preparations%rowtype;
  v_receipt private.v2_booking_receipts%rowtype;
  v_booking public.bookings%rowtype;
  v_key bytea;
  v_key_digest bytea;
  v_snapshot jsonb;
  v_summary jsonb;
  v_binding jsonb;
  v_duration smallint;
  v_buffer_before smallint;
  v_buffer_after smallint;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz;
  v_final_now timestamptz;
  v_sequence bigint;
begin
  v_credential := private.v2_lock_booking_actor(p_context);
  if p_preparation_id is null or p_idempotency_key is null then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;
  select k.key into v_key from private.v2_booking_epoch_keys k
    where (k.instance_id,k.epoch) = (v_credential.instance_id,v_credential.epoch)
    for key share nowait;
  if not found then raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY'; end if;
  v_key_digest := extensions.hmac(convert_to(
    'project-s:v2:booking-idempotency:1:' || v_credential.instance_id::text || ':'
    || v_credential.epoch::text || ':' || v_credential.principal_id::text || ':'
    || v_credential.actor_id::text || ':' || v_credential.credential_id::text || ':'
    || p_idempotency_key::text, 'UTF8'),v_key,'sha256');

  -- Resolve an exact replay before applying first-write authority or slot rules.
  select * into v_receipt from private.v2_booking_receipts r
    where (r.instance_id,r.epoch,r.principal_id,r.actor_id,r.credential_id,r.key_digest)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,v_key_digest) for share;
  if found then
    perform private.v2_live_booking_actor(v_credential);
    if v_receipt.preparation_id <> p_preparation_id then
      raise exception sqlstate 'PT409' using message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return private.v2_confirmed_booking_receipt(v_credential,v_receipt);
  end if;

  -- Check ownership before locking the related profile and mandate. Only
  -- standing preparations are admitted through this increment.
  select * into v_preparation from private.v2_delegated_preparations p
    where (p.instance_id,p.epoch,p.principal_id,p.actor_id,p.credential_id,p.preparation_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,p_preparation_id);
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_profile from private.v2_booker_profiles p
    where (p.instance_id,p.epoch,p.principal_id,p.profile_id)
      = (v_preparation.instance_id,v_preparation.epoch,v_preparation.principal_id,v_preparation.profile_id)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_mandate from private.v2_mandates m
    where (m.instance_id,m.epoch,m.principal_id,m.actor_id,m.credential_id,m.mandate_id)
      = (v_preparation.instance_id,v_preparation.epoch,v_preparation.principal_id,
         v_preparation.actor_id,v_preparation.credential_id,v_preparation.mandate_id) for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_preparation from private.v2_delegated_preparations p
    where (p.instance_id,p.epoch,p.principal_id,p.actor_id,p.credential_id,p.preparation_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,p_preparation_id) for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  perform private.v2_live_booking_actor(v_credential);
  perform private.v2_assert_mandate_unused(v_mandate.instance_id,v_mandate.epoch,
    v_mandate.principal_id,v_mandate.mandate_id);
  perform private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation);

  begin
    v_snapshot := private.v2_mandate_host_snapshot(v_preparation.request->>'username',
      (v_preparation.request->>'meetingTypeId')::uuid);
  exception when sqlstate 'PT403' then
    raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE';
  end;
  v_now := private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation);
  if v_snapshot is distinct from v_preparation.host_snapshot then
    raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE';
  end if;
  v_start := (v_preparation.request->>'startAt')::timestamptz;
  v_duration := (v_snapshot->>'durationMinutes')::smallint;
  v_end := private.add_minutes_utc(v_start,v_duration);
  if not coalesce(
    v_preparation.request->>'mandateId' = v_mandate.mandate_id::text
    and v_snapshot->>'hostId' = v_mandate.host_snapshot->>'hostId'
    and v_preparation.request->>'username' = v_mandate.policy->>'username'
    and v_preparation.request->>'meetingTypeId' = v_mandate.policy->>'meetingTypeId'
    and v_start >= (v_mandate.policy->>'meetingWindowStart')::timestamptz
    and v_end <= (v_mandate.policy->>'meetingWindowEnd')::timestamptz
    and v_duration <= (v_mandate.policy->>'maxDurationMinutes')::integer,
    false)
  then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;

  v_summary := jsonb_build_object('username',v_preparation.request->>'username',
    'hostDisplayName',v_snapshot->>'hostDisplayName','meetingTypeId',v_preparation.request->>'meetingTypeId',
    'meetingTypeTitle',v_snapshot->>'meetingTypeTitle','startAt',private.v2_mandate_instant(v_start),
    'endAt',private.v2_mandate_instant(v_end),'hostTimeZone',v_snapshot->>'hostTimeZone',
    'guestTimeZone',v_profile.guest_time_zone);
  v_binding := jsonb_build_object('instanceId',v_credential.instance_id,'epoch',v_credential.epoch,
    'principalId',v_credential.principal_id,'actorId',v_credential.actor_id,
    'credentialId',v_credential.credential_id,'credentialRevision',v_credential.revision,
    'profileId',v_profile.profile_id,'profileRevision',v_profile.revision,
    'mandateId',v_mandate.mandate_id,'mandateRevision',v_mandate.revision,
    'provider','local_mandate','providerVersion',1,'request',v_preparation.request,'hostSnapshot',v_snapshot);
  if v_summary is distinct from v_preparation.summary
    or v_preparation.intent_digest is distinct from encode(extensions.digest(
      convert_to('project-s:v2:delegated-intent:1:' || v_binding::text,'UTF8'),'sha256'),'hex')
    or v_preparation.summary_digest is distinct from encode(extensions.digest(
      convert_to('project-s:v2:delegated-summary:1:' ||
        (v_binding || jsonb_build_object('summary',v_summary))::text,'UTF8'),'sha256'),'hex')
    or v_start < v_now + (v_snapshot->>'minimumNoticeMinutes')::integer * interval '1 minute'
    or v_end > v_now + (v_snapshot->>'maximumAdvanceDays')::integer * interval '1 day'
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;

  -- The shared owner fence covers current availability and effective buffers.
  -- Search using UTC dates so the exact reviewed display zone stays opaque.
  select slot.slot_buffer_before, slot.slot_buffer_after into v_buffer_before, v_buffer_after
    from private.compute_free_slots_v1(v_preparation.request->>'username',
      (v_preparation.request->>'meetingTypeId')::uuid,(v_start at time zone 'UTC')::date,'UTC',v_now) slot
    where slot.slot_start = v_start;
  if not found then raise exception sqlstate 'PT409' using message = 'SLOT_UNAVAILABLE'; end if;
  v_now := private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation);
  if v_start < v_now + (v_snapshot->>'minimumNoticeMinutes')::integer * interval '1 minute'
    or v_end > v_now + (v_snapshot->>'maximumAdvanceDays')::integer * interval '1 day'
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;

  begin
    insert into public.bookings (user_id,meeting_type_id,start_time,duration_minutes,
      buffer_before_minutes,buffer_after_minutes,booker_name,booker_email,guest_timezone,
      meeting_type_title,host_timezone,idempotency_key,request_fingerprint,preparation_id)
    values ((v_snapshot->>'hostId')::uuid,(v_snapshot->>'meetingTypeId')::uuid,v_start,v_duration,
      v_buffer_before,v_buffer_after,v_profile.name,v_profile.email,
      case when private.is_valid_time_zone(v_profile.guest_time_zone) then v_profile.guest_time_zone end,
      v_snapshot->>'meetingTypeTitle',v_snapshot->>'hostTimeZone',extensions.gen_random_uuid(),
      decode(v_preparation.intent_digest,'hex'),null)
    returning * into v_booking;
  exception when exclusion_violation then
    raise exception sqlstate 'PT409' using message = 'SLOT_UNAVAILABLE';
  when unique_violation then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
  end;
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id,epoch,principal_id) = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,v_sequence,'booking_committed',v_now);
  insert into private.v2_booking_receipts (instance_id,epoch,principal_id,actor_id,credential_id,
    preparation_id,mandate_id,booking_id,key_digest,intent_digest,committed_at,expires_at,committed_sequence,booking)
  values (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
    v_credential.actor_id,v_credential.credential_id,v_preparation.preparation_id,v_mandate.mandate_id,
    v_booking.id,v_key_digest,v_preparation.intent_digest,v_now,v_now + interval '24 hours',v_sequence,
    (v_summary - 'hostDisplayName') || jsonb_build_object('confirmationCode',v_booking.confirmation_code,
      'status',v_booking.status))
  returning * into v_receipt;
  update private.v2_delegated_preparations set state = 'invalidated',summary = null,
    invalidated_at = v_now,invalidated_sequence = v_sequence
    where preparation_id = v_preparation.preparation_id;

  -- Late FK, index or audit waits can expire authority even when locked rows
  -- did not change. A late refusal rolls back the booking, receipt and event.
  v_final_now := private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation);
  if v_start < v_final_now + (v_snapshot->>'minimumNoticeMinutes')::integer * interval '1 minute'
    or v_end > v_final_now + (v_snapshot->>'maximumAdvanceDays')::integer * interval '1 day'
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;
  return private.v2_booking_receipt_data(v_receipt);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_read_delegated_booking_receipt_v2(p_context jsonb,p_receipt_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s' as $$
declare
  v_credential private.v2_actor_credentials%rowtype;
  v_receipt private.v2_booking_receipts%rowtype;
begin
  v_credential := private.v2_lock_booking_actor(p_context);
  if p_receipt_id is null then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
  select * into v_receipt from private.v2_booking_receipts r
    where (r.instance_id,r.epoch,r.principal_id,r.actor_id,r.credential_id,r.receipt_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,p_receipt_id) for share;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  return private.v2_confirmed_booking_receipt(v_credential,v_receipt);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_reject_booking_epoch_key_update(),
  private.v2_assert_mandate_unused(uuid,bigint,uuid,uuid),
  private.v2_live_booking_actor(private.v2_actor_credentials),
  private.v2_lock_booking_actor(jsonb),
  private.v2_standing_commit_clock(private.v2_actor_credentials,private.v2_booker_profiles,
    private.v2_mandates,private.v2_delegated_preparations),
  private.v2_booking_receipt_data(private.v2_booking_receipts),
  private.v2_confirmed_booking_receipt(private.v2_actor_credentials,private.v2_booking_receipts)
  from public, anon, authenticated, service_role;
revoke all on function public.project_s_commit_delegated_booking_v2(jsonb,uuid,uuid),
  public.project_s_read_delegated_booking_receipt_v2(jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.project_s_commit_delegated_booking_v2(jsonb,uuid,uuid),
  public.project_s_read_delegated_booking_receipt_v2(jsonb,uuid) to service_role;
commit;
