-- ADR 0004 C3 synthetic retention. Redact expired uncommitted summaries
-- while retaining the rows that enforce rate, intent, and receipt bindings.
begin;
set local search_path = pg_catalog;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered','actor_revoked','profile_reviewed','profile_deleted',
    'mandate_reviewed','mandate_approved','mandate_revoked','preparation_created','step_up_requested',
    'step_up_approved','step_up_revoked','expired_mandate_reviews_redacted','booking_committed',
    'expired_booking_receipts_redacted','expired_delegated_summaries_redacted'));

create index v2_delegated_preparations_pending_expiry_idx
  on private.v2_delegated_preparations (instance_id, epoch, principal_id, expires_at, preparation_id)
  where state = 'pending';
create index v2_step_up_requests_pending_expiry_idx
  on private.v2_step_up_requests (instance_id, epoch, principal_id, expires_at, review_id)
  where state = 'pending';
create index v2_step_up_preparations_pending_expiry_idx
  on private.v2_step_up_preparations (instance_id, epoch, principal_id, expires_at, preparation_id)
  where state = 'pending';

create function private.v2_redact_expired_delegated_summaries(
  p_instance_id uuid, p_epoch bigint, p_principal_id uuid, p_limit integer)
returns integer language plpgsql security invoker
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  v_now timestamptz;
  v_standing_ids uuid[];
  v_review_ids uuid[];
  v_replacement_ids uuid[];
  v_selected_count integer;
  v_sequence bigint;
  v_review_count integer;
  v_standing_count integer;
  v_replacement_count integer;
begin
  if p_instance_id is null or p_epoch is null or p_principal_id is null
    or p_limit is null or p_limit not between 1 and 100
  then raise exception sqlstate '22023' using message = 'INVALID_RETENTION_ARGUMENT'; end if;

  perform private.v2_assert_instance(p_instance_id, p_epoch);
  -- Take the same principal fence as preparation, review and commit. Retention
  -- is also available to the database owner for disabled or deleted issuers.
  perform 1 from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
    for update;
  if not found then return 0; end if;
  perform private.v2_assert_instance(p_instance_id, p_epoch);
  v_now := clock_timestamp();

  -- Bound the candidates from each expiry index before applying the single
  -- oldest-first batch limit across all three kinds.
  with candidates as (
    (select p.preparation_id as id, p.expires_at, 1 as kind
      from private.v2_delegated_preparations p
      where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
        and p.state = 'pending' and p.expires_at <= v_now
      order by p.expires_at, p.preparation_id
      limit p_limit)
    union all
    (select r.review_id, r.expires_at, 2
      from private.v2_step_up_requests r
      where (r.instance_id, r.epoch, r.principal_id) = (p_instance_id, p_epoch, p_principal_id)
        and r.state = 'pending' and r.expires_at <= v_now
      order by r.expires_at, r.review_id
      limit p_limit)
    union all
    (select p.preparation_id, p.expires_at, 3
      from private.v2_step_up_preparations p
      where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
        and p.state = 'pending' and p.expires_at <= v_now
      order by p.expires_at, p.preparation_id
      limit p_limit)
  ), expired as (
    select id, kind from candidates order by expires_at, kind, id limit p_limit
  )
  select array_agg(id) filter (where kind = 1),
    array_agg(id) filter (where kind = 2),
    array_agg(id) filter (where kind = 3),
    count(*)::integer
  into v_standing_ids, v_review_ids, v_replacement_ids, v_selected_count
  from expired;
  if v_selected_count = 0 then return 0; end if;

  update private.v2_authority_principals p set event_sequence = p.event_sequence + 1
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
    returning p.event_sequence into v_sequence;
  insert into private.v2_authority_events (instance_id, epoch, principal_id, sequence, action, occurred_at)
    values (p_instance_id, p_epoch, p_principal_id, v_sequence, 'expired_delegated_summaries_redacted', v_now);

  -- Update reviews before preparations in the shared authority lock order.
  update private.v2_step_up_requests r
    set state = 'invalidated', summary = null, invalidated_at = v_now, invalidated_sequence = v_sequence
    where (r.instance_id, r.epoch, r.principal_id) = (p_instance_id, p_epoch, p_principal_id)
      and r.review_id = any(v_review_ids) and r.state = 'pending' and r.expires_at <= v_now;
  get diagnostics v_review_count = row_count;

  update private.v2_delegated_preparations p
    set state = 'invalidated', summary = null, invalidated_at = v_now, invalidated_sequence = v_sequence
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
      and p.preparation_id = any(v_standing_ids) and p.state = 'pending' and p.expires_at <= v_now;
  get diagnostics v_standing_count = row_count;

  update private.v2_step_up_preparations p
    set state = 'invalidated', summary = null, invalidated_at = v_now, invalidated_sequence = v_sequence
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
      and p.preparation_id = any(v_replacement_ids) and p.state = 'pending' and p.expires_at <= v_now;
  get diagnostics v_replacement_count = row_count;

  perform private.v2_assert_instance(p_instance_id, p_epoch);
  if v_review_count + v_standing_count + v_replacement_count <> v_selected_count
    or v_now > clock_timestamp()
  then raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY'; end if;
  return v_selected_count;
exception
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_redact_expired_delegated_summaries(uuid, bigint, uuid, integer)
  from public, anon, authenticated, service_role;

commit;
