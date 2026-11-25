-- Private continuation lookup for the actor that requested an exact booking.
-- ADR 0004 C2: approval provides bounded authority; commit still checks the slot.
begin;
set local search_path = pg_catalog;

create function public.project_s_get_delegated_step_up_v2(p_context jsonb, p_review_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  v_actor private.v2_actor_credentials%rowtype;
  v_review private.v2_step_up_requests%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_grant private.v2_step_up_grants%rowtype;
  v_preparation private.v2_step_up_preparations%rowtype;
  v_now timestamptz;
begin
  v_actor := private.v2_lock_booking_actor(p_context);
  if p_review_id is null then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;

  -- Resolve references under the principal fence before acquiring child row
  -- locks. Every lookup is scoped to this caller or a row already bound to it.
  select * into v_review from private.v2_step_up_requests r
    where (r.instance_id, r.epoch, r.principal_id, r.actor_id, r.credential_id, r.credential_revision, r.review_id)
        = (v_actor.instance_id, v_actor.epoch, v_actor.principal_id, v_actor.actor_id,
           v_actor.credential_id, v_actor.revision, p_review_id);
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;

  select * into v_profile from private.v2_booker_profiles p
    where (p.instance_id, p.epoch, p.principal_id, p.profile_id, p.revision)
        = (v_actor.instance_id, v_actor.epoch, v_actor.principal_id, v_review.profile_id, v_review.profile_revision)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_mandate from private.v2_mandates m
    where (m.instance_id, m.epoch, m.principal_id, m.actor_id, m.credential_id, m.credential_revision,
           m.mandate_id, m.profile_id, m.profile_revision)
        = (v_actor.instance_id, v_actor.epoch, v_actor.principal_id, v_actor.actor_id, v_actor.credential_id,
           v_actor.revision, v_review.mandate_id, v_profile.profile_id, v_profile.revision)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_review from private.v2_step_up_requests r
    where (r.instance_id, r.epoch, r.principal_id, r.actor_id, r.credential_id, r.credential_revision,
           r.review_id, r.mandate_id, r.profile_id, r.profile_revision)
        = (v_actor.instance_id, v_actor.epoch, v_actor.principal_id, v_actor.actor_id, v_actor.credential_id,
           v_actor.revision, p_review_id, v_mandate.mandate_id, v_profile.profile_id, v_profile.revision)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;

  perform private.v2_assert_mandate_unused(v_actor.instance_id, v_actor.epoch,
    v_actor.principal_id, v_mandate.mandate_id);

  if v_review.state = 'pending' then
    v_now := private.v2_live_booking_actor(v_actor);
    if v_review.revision <> 1 or v_review.created_at > v_now or v_review.expires_at <= v_now
      or v_profile.state <> 'active' or v_profile.reviewed_at > v_now or v_profile.expires_at <= v_now
      or v_mandate.state <> 'active' or v_mandate.revision <> v_review.mandate_revision
      or v_mandate.superseded_by_step_up is not null
      or v_mandate.issued_at > v_now or v_mandate.expires_at <= v_now
      or (v_now >= (v_mandate.policy ->> 'notBefore')::timestamptz) is not true
    then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
    return jsonb_build_object('reviewId', v_review.review_id, 'state', 'pending',
      'expiresAt', private.v2_mandate_instant(v_review.expires_at));
  end if;
  if v_review.state <> 'approved' then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;

  select * into v_grant from private.v2_step_up_grants g
    where (g.instance_id, g.epoch, g.principal_id, g.actor_id, g.credential_id, g.credential_revision,
           g.review_id, g.grant_id, g.mandate_id, g.mandate_revision, g.profile_id, g.profile_revision)
        = (v_actor.instance_id, v_actor.epoch, v_actor.principal_id, v_actor.actor_id, v_actor.credential_id,
           v_actor.revision, p_review_id, v_review.approved_grant_id, v_mandate.mandate_id,
           v_review.mandate_revision, v_profile.profile_id, v_profile.revision)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_preparation from private.v2_step_up_preparations p
    where (p.instance_id, p.epoch, p.principal_id, p.actor_id, p.credential_id, p.credential_revision,
           p.review_id, p.grant_id, p.preparation_id, p.mandate_id, p.mandate_revision, p.profile_id, p.profile_revision)
        = (v_actor.instance_id, v_actor.epoch, v_actor.principal_id, v_actor.actor_id, v_actor.credential_id,
           v_actor.revision, p_review_id, v_grant.grant_id, v_review.approved_preparation_id,
           v_mandate.mandate_id, v_review.mandate_revision, v_profile.profile_id, v_profile.revision)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;

  -- The source deadline bounds the original approval. Its replacement has a
  -- separate deadline. Recheck its authority at the same clock boundary used
  -- by commit, after the final row wait, without creating or holding a slot.
  perform private.v2_step_up_commit_clock(v_actor, v_profile, v_mandate, v_review, v_grant, v_preparation);
  return jsonb_build_object('reviewId', v_review.review_id, 'state', 'approved',
    'preparationId', v_preparation.preparation_id, 'expiresAt', private.v2_mandate_instant(v_preparation.expires_at));
exception
  when sqlstate 'PT409' or sqlstate 'PT410' then
    -- An unavailable object has the same actor-facing refusal as an unknown ID.
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function public.project_s_get_delegated_step_up_v2(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.project_s_get_delegated_step_up_v2(jsonb, uuid) to service_role;
commit;
