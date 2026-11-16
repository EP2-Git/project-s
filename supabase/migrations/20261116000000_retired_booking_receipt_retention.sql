-- Apply the existing synthetic receipt deadline after an authority rotation.
-- The old epoch remains unavailable for verification, receipt reads, and writes.
begin;
set local search_path = pg_catalog;

create function private.v2_redact_expired_booking_receipts_at_epoch(
  p_instance_id uuid, p_expected_active_epoch bigint, p_receipt_epoch bigint,
  p_principal_id uuid, p_limit integer
)
returns integer language plpgsql security invoker
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  v_now timestamptz;
  v_sequence bigint;
  v_count integer;
begin
  if p_instance_id is null or p_expected_active_epoch is null or p_receipt_epoch is null
    or p_principal_id is null or p_limit is null or p_limit not between 1 and 100
  then raise exception sqlstate '22023' using message = 'INVALID_RETENTION_ARGUMENT'; end if;

  -- The shared recovery fence protects the confirmed active epoch through
  -- transaction end. A retired receipt stays bound to its own epoch key.
  perform private.v2_assert_instance(p_instance_id, p_expected_active_epoch);
  if p_receipt_epoch <> p_expected_active_epoch and (
    p_receipt_epoch > p_expected_active_epoch or not exists (
      select 1 from private.v2_booking_epoch_keys k
      where (k.instance_id, k.epoch) = (p_instance_id, p_receipt_epoch)
    )
  ) then raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED'; end if;

  -- Use the same principal fence as first commits, receipt reads, and replay.
  -- This remains applicable to disabled or deleted accounts.
  perform 1 from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_receipt_epoch, p_principal_id)
    for update;
  if not found then return 0; end if;
  perform private.v2_assert_instance(p_instance_id, p_expected_active_epoch);
  v_now := clock_timestamp();

  with expired_receipts as (
    select r.receipt_id from private.v2_booking_receipts r
      where (r.instance_id, r.epoch, r.principal_id) = (p_instance_id, p_receipt_epoch, p_principal_id)
        and r.booking is not null and r.expires_at <= v_now
      order by r.expires_at, r.receipt_id
      limit p_limit
  )
  update private.v2_booking_receipts r
    set booking = null
    from expired_receipts
    where r.receipt_id = expired_receipts.receipt_id
      and r.booking is not null and r.expires_at <= v_now;
  get diagnostics v_count = row_count;
  if v_count = 0 then return 0; end if;

  update private.v2_authority_principals p set event_sequence = p.event_sequence + 1
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_receipt_epoch, p_principal_id)
    returning p.event_sequence into v_sequence;
  insert into private.v2_authority_events (instance_id, epoch, principal_id, sequence, action, occurred_at)
    values (p_instance_id, p_receipt_epoch, p_principal_id, v_sequence, 'expired_booking_receipts_redacted', v_now);
  return v_count;
exception
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_redact_expired_booking_receipts_at_epoch(uuid, bigint, bigint, uuid, integer)
  from public, anon, authenticated, service_role;

-- Preserve the existing entry point's active-only behavior.
create or replace function private.v2_redact_expired_booking_receipts(
  p_instance_id uuid, p_epoch bigint, p_principal_id uuid, p_limit integer
)
returns integer language plpgsql security invoker
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
begin
  return private.v2_redact_expired_booking_receipts_at_epoch(
    p_instance_id, p_epoch, p_epoch, p_principal_id, p_limit);
end;
$$;

commit;
