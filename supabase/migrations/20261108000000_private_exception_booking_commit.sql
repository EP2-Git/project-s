-- Exact exception commit under ADR 0004. Standing and exception preparations
-- share one booking, consumption, receipt and audit transaction.
begin;
set local search_path = pg_catalog;

-- Keep the existing preparation ID for replay and derive one typed FK target.
-- Existing receipts retain the standing provider and their original bindings.
alter table private.v2_booking_receipts
  add column provider text not null default 'local_mandate',
  add column standing_preparation_id uuid generated always as
    (case when provider = 'local_mandate' then preparation_id end) stored,
  add column step_up_preparation_id uuid generated always as
    (case when provider = 'principal_step_up' then preparation_id end) stored,
  add column step_up_review_id uuid,
  add column step_up_grant_id uuid,
  add constraint v2_booking_receipts_provider_binding_check check (
    (provider = 'local_mandate' and step_up_review_id is null and step_up_grant_id is null)
    or (provider = 'principal_step_up' and step_up_review_id is not null and step_up_grant_id is not null));

-- The original unnamed FK must become conditional on the standing provider.
do $$
declare
  v_constraint name;
begin
  select c.conname into strict v_constraint from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = 'private.v2_booking_receipts'::regclass
      and c.confrelid = 'private.v2_delegated_preparations'::regclass;
  execute format('alter table private.v2_booking_receipts drop constraint %I', v_constraint);
end;
$$;

alter table private.v2_step_up_preparations add constraint v2_step_up_preparations_receipt_binding_key
  unique (instance_id,epoch,principal_id,actor_id,credential_id,preparation_id,mandate_id,intent_digest,review_id,grant_id);

alter table private.v2_booking_receipts
  add constraint v2_booking_receipts_standing_preparation_fkey
    foreign key (instance_id,epoch,principal_id,actor_id,credential_id,
      standing_preparation_id,mandate_id,intent_digest)
    references private.v2_delegated_preparations(instance_id,epoch,principal_id,actor_id,
      credential_id,preparation_id,mandate_id,intent_digest),
  add constraint v2_booking_receipts_step_up_preparation_fkey
    foreign key (instance_id,epoch,principal_id,actor_id,credential_id,
      step_up_preparation_id,mandate_id,intent_digest,step_up_review_id,step_up_grant_id)
    references private.v2_step_up_preparations(instance_id,epoch,principal_id,actor_id,
      credential_id,preparation_id,mandate_id,intent_digest,review_id,grant_id);

create function private.v2_step_up_commit_clock(p_credential private.v2_actor_credentials,
  p_profile private.v2_booker_profiles,p_mandate private.v2_mandates,
  p_review private.v2_step_up_requests,p_grant private.v2_step_up_grants,
  p_preparation private.v2_step_up_preparations)
returns timestamptz language plpgsql set search_path = pg_catalog as $$
declare
  v_now timestamptz := private.v2_live_booking_actor(p_credential);
begin
  if p_profile.state <> 'active' or p_profile.reviewed_at > v_now or p_profile.expires_at <= v_now
    or p_profile.profile_id <> p_preparation.profile_id
    or p_profile.revision <> p_preparation.profile_revision
    or p_mandate.state <> 'revoked' or p_mandate.revision <> 2
    or p_mandate.mandate_id <> p_preparation.mandate_id or p_mandate.issued_at > v_now
    or p_mandate.superseded_by_step_up is distinct from p_review.review_id
    or p_mandate.credential_revision <> p_credential.revision
    or p_review.credential_revision <> p_credential.revision
    or p_grant.credential_revision <> p_credential.revision
    or p_preparation.credential_revision <> p_credential.revision
    or (v_now >= (p_mandate.policy->>'notBefore')::timestamptz) is not true
    or p_review.state <> 'approved' or p_review.revision <> 2
    or p_review.approved_preparation_id is distinct from p_preparation.preparation_id
    or p_review.approved_grant_id is distinct from p_grant.grant_id
    or p_preparation.review_id <> p_review.review_id
    or p_preparation.grant_id <> p_grant.grant_id
    or p_grant.review_id <> p_review.review_id
    or p_grant.state <> 'active' or p_grant.revision <> 1
  then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  if p_mandate.expires_at <= v_now then
    raise exception sqlstate 'PT410' using message = 'MANDATE_EXPIRED';
  end if;
  -- The review deadline bounded approval. The approved grant has its own
  -- deadline, bounded by the supporting credential, profile and mandate.
  if (p_review.created_at <= p_review.approved_at and p_review.approved_at < p_review.expires_at) is not true
    or p_mandate.revoked_at is distinct from p_review.approved_at
    or p_mandate.revoked_sequence is distinct from p_review.approved_sequence
    or p_grant.issued_at is distinct from p_review.approved_at
    or p_grant.created_sequence is distinct from p_review.approved_sequence
    or p_preparation.created_at is distinct from p_review.approved_at
    or p_preparation.created_sequence is distinct from p_review.approved_sequence
    or p_grant.expires_at is distinct from p_preparation.expires_at
    or p_grant.issued_at > v_now or p_grant.expires_at <= v_now
    or p_preparation.created_at > v_now or p_preparation.expires_at <= v_now
    or p_preparation.state <> 'pending'
    or p_preparation.provider <> 'principal_step_up' or p_preparation.provider_version <> 1
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;
  return v_now;
end;
$$;

revoke all on function private.v2_step_up_commit_clock(private.v2_actor_credentials,
  private.v2_booker_profiles,private.v2_mandates,private.v2_step_up_requests,
  private.v2_step_up_grants,private.v2_step_up_preparations)
  from public, anon, authenticated, service_role;

create or replace function public.project_s_commit_delegated_booking_v2(
  p_context jsonb, p_preparation_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s' as $$
declare
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_preparation private.v2_delegated_preparations%rowtype;
  v_review private.v2_step_up_requests%rowtype;
  v_grant private.v2_step_up_grants%rowtype;
  v_step_up private.v2_step_up_preparations%rowtype;
  v_receipt private.v2_booking_receipts%rowtype;
  v_booking public.bookings%rowtype;
  v_key bytea;
  v_key_digest bytea;
  v_provider text;
  v_request jsonb;
  v_prepared_summary jsonb;
  v_prepared_snapshot jsonb;
  v_intent_digest text;
  v_summary_digest text;
  v_mandate_revision bigint;
  v_intent_domain text := 'project-s:v2:delegated-intent:1:';
  v_summary_domain text := 'project-s:v2:delegated-summary:1:';
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
  if found and v_receipt.preparation_id <> p_preparation_id then
    perform private.v2_live_booking_actor(v_credential);
    raise exception sqlstate 'PT409' using message = 'IDEMPOTENCY_KEY_REUSED';
  end if;

  -- Resolve the type under the caller fence before any first-write locks.
  -- UUIDs alone cannot select a provider or resolve a collision.
  select * into v_preparation from private.v2_delegated_preparations p
    where (p.instance_id,p.epoch,p.principal_id,p.actor_id,p.credential_id,p.preparation_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,p_preparation_id);
  select * into v_step_up from private.v2_step_up_preparations p
    where (p.instance_id,p.epoch,p.principal_id,p.actor_id,p.credential_id,p.preparation_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,p_preparation_id);
  if (v_preparation.preparation_id is null) = (v_step_up.preparation_id is null) then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;
  v_provider := coalesce(v_preparation.provider,v_step_up.provider);
  if v_receipt.receipt_id is not null then
    if v_receipt.provider is distinct from v_provider
      or v_receipt.intent_digest is distinct from coalesce(v_preparation.intent_digest,v_step_up.intent_digest)
    then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
    return private.v2_confirmed_booking_receipt(v_credential,v_receipt);
  end if;

  select * into v_profile from private.v2_booker_profiles p
    where (p.instance_id,p.epoch,p.principal_id,p.profile_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         coalesce(v_preparation.profile_id,v_step_up.profile_id)) for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_mandate from private.v2_mandates m
    where (m.instance_id,m.epoch,m.principal_id,m.actor_id,m.credential_id,m.mandate_id)
      = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
         v_credential.actor_id,v_credential.credential_id,
         coalesce(v_preparation.mandate_id,v_step_up.mandate_id)) for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;

  if v_provider = 'local_mandate' then
    select * into v_preparation from private.v2_delegated_preparations p
      where (p.instance_id,p.epoch,p.principal_id,p.actor_id,p.credential_id,p.preparation_id)
        = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
           v_credential.actor_id,v_credential.credential_id,p_preparation_id) for update;
    if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  elsif v_provider = 'principal_step_up' then
    select * into v_review from private.v2_step_up_requests r
      where (r.instance_id,r.epoch,r.principal_id,r.actor_id,r.credential_id,r.mandate_id,r.review_id)
        = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
           v_credential.actor_id,v_credential.credential_id,v_mandate.mandate_id,v_step_up.review_id) for update;
    if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
    select * into v_grant from private.v2_step_up_grants g
      where (g.instance_id,g.epoch,g.principal_id,g.actor_id,g.credential_id,g.mandate_id,g.review_id,g.grant_id)
        = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
           v_credential.actor_id,v_credential.credential_id,v_mandate.mandate_id,v_review.review_id,
           v_step_up.grant_id) for update;
    if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
    select * into v_step_up from private.v2_step_up_preparations p
      where (p.instance_id,p.epoch,p.principal_id,p.actor_id,p.credential_id,p.mandate_id,
        p.review_id,p.grant_id,p.preparation_id)
        = (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
           v_credential.actor_id,v_credential.credential_id,v_mandate.mandate_id,v_review.review_id,
           v_grant.grant_id,p_preparation_id) for update;
    if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  else
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;

  v_request := coalesce(v_preparation.request,v_step_up.request);
  v_prepared_summary := coalesce(v_preparation.summary,v_step_up.summary);
  v_prepared_snapshot := coalesce(v_preparation.host_snapshot,v_step_up.host_snapshot);
  v_intent_digest := coalesce(v_preparation.intent_digest,v_step_up.intent_digest);
  v_summary_digest := coalesce(v_preparation.summary_digest,v_step_up.summary_digest);
  v_mandate_revision := coalesce(v_preparation.mandate_revision,v_step_up.mandate_revision);
  perform private.v2_live_booking_actor(v_credential);
  perform private.v2_assert_mandate_unused(v_mandate.instance_id,v_mandate.epoch,
    v_mandate.principal_id,v_mandate.mandate_id);
  perform case when v_provider = 'local_mandate'
    then private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation)
    else private.v2_step_up_commit_clock(v_credential,v_profile,v_mandate,v_review,v_grant,v_step_up)
  end;

  begin
    v_snapshot := private.v2_mandate_host_snapshot(v_request->>'username',
      (v_request->>'meetingTypeId')::uuid);
  exception when sqlstate 'PT403' then
    raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE';
  end;
  v_now := case when v_provider = 'local_mandate'
    then private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation)
    else private.v2_step_up_commit_clock(v_credential,v_profile,v_mandate,v_review,v_grant,v_step_up)
  end;
  if v_snapshot is distinct from v_prepared_snapshot then
    raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE';
  end if;
  v_start := (v_request->>'startAt')::timestamptz;
  v_duration := (v_snapshot->>'durationMinutes')::smallint;
  v_end := private.add_minutes_utc(v_start,v_duration);
  if v_request->>'mandateId' is distinct from v_mandate.mandate_id::text then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;
  if v_provider = 'local_mandate' and not coalesce(
    v_snapshot->>'hostId' = v_mandate.host_snapshot->>'hostId'
    and v_request->>'username' = v_mandate.policy->>'username'
    and v_request->>'meetingTypeId' = v_mandate.policy->>'meetingTypeId'
    and v_start >= (v_mandate.policy->>'meetingWindowStart')::timestamptz
    and v_end <= (v_mandate.policy->>'meetingWindowEnd')::timestamptz
    and v_duration <= (v_mandate.policy->>'maxDurationMinutes')::integer,
    false)
  then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;

  v_summary := jsonb_build_object('username',v_request->>'username',
    'hostDisplayName',v_snapshot->>'hostDisplayName','meetingTypeId',v_request->>'meetingTypeId',
    'meetingTypeTitle',v_snapshot->>'meetingTypeTitle','startAt',private.v2_mandate_instant(v_start),
    'endAt',private.v2_mandate_instant(v_end),'hostTimeZone',v_snapshot->>'hostTimeZone',
    'guestTimeZone',v_profile.guest_time_zone);
  v_binding := jsonb_build_object('instanceId',v_credential.instance_id,'epoch',v_credential.epoch,
    'principalId',v_credential.principal_id,'actorId',v_credential.actor_id,
    'credentialId',v_credential.credential_id,'credentialRevision',v_credential.revision,
    'profileId',v_profile.profile_id,'profileRevision',v_profile.revision,
    'mandateId',v_mandate.mandate_id,'mandateRevision',v_mandate_revision,
    'provider','local_mandate','providerVersion',1,'request',v_request,'hostSnapshot',v_snapshot);
  if v_provider = 'principal_step_up' then
    -- The review used the standing-provider domain. Revalidate the exact
    -- approved digest, then bind it to the replacement grant and preparation.
    if v_review.request is distinct from v_request or v_review.host_snapshot is distinct from v_snapshot
      or v_review.intent_digest is distinct from encode(extensions.digest(
        convert_to(v_intent_domain || v_binding::text,'UTF8'),'sha256'),'hex')
      or v_review.summary_digest is distinct from encode(extensions.digest(
        convert_to(v_summary_domain || (v_binding || jsonb_build_object('summary',v_summary))::text,'UTF8'),
        'sha256'),'hex')
    then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;
    v_binding := v_binding || jsonb_build_object('reviewId',v_review.review_id,
      'reviewDigest',v_review.summary_digest,'grantId',v_grant.grant_id,'provider','principal_step_up');
    v_intent_domain := 'project-s:v2:step-up-intent:1:';
    v_summary_domain := 'project-s:v2:step-up-summary:1:';
  end if;
  if v_summary is distinct from v_prepared_summary
    or v_intent_digest is distinct from encode(extensions.digest(
      convert_to(v_intent_domain || v_binding::text,'UTF8'),'sha256'),'hex')
    or v_summary_digest is distinct from encode(extensions.digest(
      convert_to(v_summary_domain ||
        (v_binding || jsonb_build_object('summary',v_summary))::text,'UTF8'),'sha256'),'hex')
    or v_start < v_now + (v_snapshot->>'minimumNoticeMinutes')::integer * interval '1 minute'
    or v_end > v_now + (v_snapshot->>'maximumAdvanceDays')::integer * interval '1 day'
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;

  -- The shared owner fence covers current availability and effective buffers.
  -- Search using UTC dates so the exact reviewed display zone stays opaque.
  select slot.slot_buffer_before, slot.slot_buffer_after into v_buffer_before, v_buffer_after
    from private.compute_free_slots_v1(v_request->>'username',
      (v_request->>'meetingTypeId')::uuid,(v_start at time zone 'UTC')::date,'UTC',v_now) slot
    where slot.slot_start = v_start;
  if not found then raise exception sqlstate 'PT409' using message = 'SLOT_UNAVAILABLE'; end if;
  v_now := case when v_provider = 'local_mandate'
    then private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation)
    else private.v2_step_up_commit_clock(v_credential,v_profile,v_mandate,v_review,v_grant,v_step_up)
  end;
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
      decode(v_intent_digest,'hex'),null)
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
    preparation_id,mandate_id,booking_id,key_digest,intent_digest,committed_at,expires_at,committed_sequence,booking,
    provider,step_up_review_id,step_up_grant_id)
  values (v_credential.instance_id,v_credential.epoch,v_credential.principal_id,
    v_credential.actor_id,v_credential.credential_id,p_preparation_id,v_mandate.mandate_id,
    v_booking.id,v_key_digest,v_intent_digest,v_now,v_now + interval '24 hours',v_sequence,
    (v_summary - 'hostDisplayName') || jsonb_build_object('confirmationCode',v_booking.confirmation_code,
      'status',v_booking.status),v_provider,v_review.review_id,v_grant.grant_id)
  returning * into v_receipt;
  if v_provider = 'local_mandate' then
    update private.v2_delegated_preparations set state = 'invalidated',summary = null,
      invalidated_at = v_now,invalidated_sequence = v_sequence
      where preparation_id = v_preparation.preparation_id;
  else
    update private.v2_step_up_preparations set state = 'invalidated',summary = null,
      invalidated_at = v_now,invalidated_sequence = v_sequence
      where preparation_id = v_step_up.preparation_id;
  end if;

  -- Late FK, index or audit waits can expire authority even when locked rows
  -- did not change. A late refusal rolls back the booking, receipt and event.
  v_final_now := case when v_provider = 'local_mandate'
    then private.v2_standing_commit_clock(v_credential,v_profile,v_mandate,v_preparation)
    else private.v2_step_up_commit_clock(v_credential,v_profile,v_mandate,v_review,v_grant,v_step_up)
  end;
  if v_start < v_final_now + (v_snapshot->>'minimumNoticeMinutes')::integer * interval '1 minute'
    or v_end > v_final_now + (v_snapshot->>'maximumAdvanceDays')::integer * interval '1 day'
  then raise exception sqlstate 'PT409' using message = 'PREPARATION_STALE'; end if;
  return private.v2_booking_receipt_data(v_receipt);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

commit;
