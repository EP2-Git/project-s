-- Private issuer-only read of a recorded pending step-up request (ADR 0004).
-- Approval will separately revalidate the live host, slot and authority.
begin;
set local search_path = pg_catalog;

create function public.project_s_get_step_up_review_v2(p_context jsonb, p_review_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  c record;
  v_review private.v2_step_up_requests%rowtype;
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_differences jsonb;
  v_now timestamptz;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id, c.epoch, c.principal_id);
  if p_review_id is null then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;

  -- Prove ownership before locking the review or any supporting reference.
  select * into v_review from private.v2_step_up_requests r
    where r.review_id = p_review_id and r.instance_id = c.instance_id
      and r.epoch = c.epoch and r.principal_id = c.principal_id;
  if not found then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;

  -- The principal fence serializes normal writers. Keep their lock order and
  -- restrict every child lookup to the same instance, epoch and principal.
  select * into v_credential from private.v2_actor_credentials a
    where a.credential_id = v_review.credential_id and a.actor_id = v_review.actor_id
      and a.instance_id = c.instance_id and a.epoch = c.epoch and a.principal_id = c.principal_id
    for update;
  select * into v_profile from private.v2_booker_profiles p
    where p.profile_id = v_review.profile_id and p.instance_id = c.instance_id
      and p.epoch = c.epoch and p.principal_id = c.principal_id
    for update;
  select * into v_mandate from private.v2_mandates m
    where m.mandate_id = v_review.mandate_id and m.instance_id = c.instance_id
      and m.epoch = c.epoch and m.principal_id = c.principal_id
      and m.actor_id = v_review.actor_id and m.credential_id = v_review.credential_id
      and m.profile_id = v_review.profile_id and m.profile_revision = v_review.profile_revision
    for update;
  select * into v_review from private.v2_step_up_requests r
    where r.review_id = p_review_id and r.instance_id = c.instance_id
      and r.epoch = c.epoch and r.principal_id = c.principal_id
    for update;

  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  if v_review.review_id is null then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;
  v_now := clock_timestamp();
  if v_review.state is distinct from 'pending'
    or v_review.created_at > v_now or v_review.expires_at <= v_now
    or v_credential.state is distinct from 'active'
    or v_credential.actor_id is distinct from v_review.actor_id
    or v_credential.credential_id is distinct from v_review.credential_id
    or v_credential.revision is distinct from v_review.credential_revision
    or v_credential.issued_at > v_now or v_credential.expires_at <= v_now
    or v_profile.state is distinct from 'active'
    or v_profile.profile_id is distinct from v_review.profile_id
    or v_profile.revision is distinct from v_review.profile_revision
    or v_profile.reviewed_at > v_now or v_profile.expires_at <= v_now
    or v_mandate.state is distinct from 'active'
    or v_mandate.mandate_id is distinct from v_review.mandate_id
    or v_mandate.actor_id is distinct from v_review.actor_id
    or v_mandate.credential_id is distinct from v_review.credential_id
    or v_mandate.credential_revision is distinct from v_review.credential_revision
    or v_mandate.profile_id is distinct from v_review.profile_id
    or v_mandate.profile_revision is distinct from v_review.profile_revision
    or v_mandate.revision is distinct from v_review.mandate_revision
    or v_mandate.issued_at > v_now or v_mandate.expires_at <= v_now
    or (v_now >= (v_mandate.policy ->> 'notBefore')::timestamptz) is not true
    or v_review.summary ->> 'guestTimeZone' is distinct from v_profile.guest_time_zone
  then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;

  -- Project the fixed display fields. Stored policy, host snapshot, internal
  -- bindings and any extra JSON keys never appear in the result.
  if exists (
    select 1 from unnest(array['username','hostDisplayName','meetingTypeId','meetingTypeTitle',
      'startAt','endAt','hostTimeZone','guestTimeZone']) as field(key)
    where jsonb_typeof(v_review.summary -> field.key) is distinct from 'string'
  ) then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;
  select jsonb_agg(jsonb_build_object('field', d.value ->> 'field',
    'proposed', d.value ->> 'proposed', 'reviewed', d.value ->> 'reviewed') order by d.ordinal)
    into v_differences
    from jsonb_array_elements(v_review.differences) with ordinality as d(value, ordinal)
    where d.value ->> 'field' in ('host', 'meeting_type', 'meeting_window', 'duration')
      and jsonb_typeof(d.value -> 'proposed') = 'string'
      and jsonb_typeof(d.value -> 'reviewed') = 'string';
  if jsonb_array_length(v_differences) is distinct from jsonb_array_length(v_review.differences) then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;

  return jsonb_build_object(
    'reviewId', v_review.review_id,
    'revision', 1,
    'state', 'pending',
    'summaryDigest', v_review.summary_digest,
    'expiresAt', private.v2_mandate_instant(v_review.expires_at),
    'exactSummary', jsonb_build_object(
      'username', v_review.summary ->> 'username',
      'hostDisplayName', v_review.summary ->> 'hostDisplayName',
      'meetingTypeId', v_review.summary ->> 'meetingTypeId',
      'meetingTypeTitle', v_review.summary ->> 'meetingTypeTitle',
      'startAt', v_review.summary ->> 'startAt',
      'endAt', v_review.summary ->> 'endAt',
      'hostTimeZone', v_review.summary ->> 'hostTimeZone',
      'guestTimeZone', v_review.summary ->> 'guestTimeZone',
      'name', v_profile.name,
      'email', v_profile.email
    ),
    'differences', v_differences
  );
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function public.project_s_get_step_up_review_v2(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.project_s_get_step_up_review_v2(jsonb, uuid) to service_role;
commit;
