-- ADR 0004 C3 synthetic retention. The database owner may redact expired
-- pending review summaries in bounded batches while retaining review fences.
begin;
set local search_path = pg_catalog;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered','actor_revoked','profile_reviewed','profile_deleted',
    'mandate_reviewed','mandate_approved','mandate_revoked','preparation_created','step_up_requested',
    'step_up_approved','step_up_revoked','expired_mandate_reviews_redacted'));

create index v2_mandate_reviews_pending_expiry_idx
  on private.v2_mandate_reviews (instance_id, epoch, principal_id, expires_at, review_id)
  where state = 'pending';

create function private.v2_redact_expired_mandate_reviews(
  p_instance_id uuid, p_epoch bigint, p_principal_id uuid, p_limit integer)
returns integer language plpgsql security invoker
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  v_now timestamptz;
  v_review_ids uuid[];
  v_sequence bigint;
  v_count integer;
begin
  if p_instance_id is null or p_epoch is null or p_principal_id is null
    or p_limit is null or p_limit not between 1 and 100
  then raise exception sqlstate '22023' using message = 'INVALID_RETENTION_ARGUMENT'; end if;

  perform private.v2_assert_instance(p_instance_id, p_epoch);
  -- Take the same existing principal row fence as authority writes. Cleanup
  -- redacts private data, so it also works for disabled or deleted accounts
  -- without asserting their identity or taking any legacy Auth lock.
  perform 1 from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
    for update;
  if not found then return 0; end if;
  perform private.v2_assert_instance(p_instance_id, p_epoch);
  v_now := clock_timestamp();

  select array(
    select r.review_id from private.v2_mandate_reviews r
      where (r.instance_id, r.epoch, r.principal_id) = (p_instance_id, p_epoch, p_principal_id)
        and r.state = 'pending' and r.expires_at <= v_now
      order by r.expires_at, r.review_id
      limit p_limit
  ) into v_review_ids;
  if cardinality(v_review_ids) = 0 then return 0; end if;

  update private.v2_authority_principals p set event_sequence = p.event_sequence + 1
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
    returning p.event_sequence into v_sequence;
  insert into private.v2_authority_events (instance_id, epoch, principal_id, sequence, action, occurred_at)
    values (p_instance_id, p_epoch, p_principal_id, v_sequence, 'expired_mandate_reviews_redacted', v_now);

  update private.v2_mandate_reviews r
    set state = 'invalidated', policy_summary = null, invalidated_at = v_now, invalidated_sequence = v_sequence
    where (r.instance_id, r.epoch, r.principal_id) = (p_instance_id, p_epoch, p_principal_id)
      and r.review_id = any(v_review_ids) and r.state = 'pending' and r.expires_at <= v_now;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_review_ids) then
    raise exception sqlstate '40001' using message = 'AUTHORITY_BUSY';
  end if;
  return v_count;
exception
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_redact_expired_mandate_reviews(uuid, bigint, uuid, integer)
  from public, anon, authenticated, service_role;

commit;
