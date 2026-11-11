-- ADR 0004 C3 synthetic retention. Retain the private one-use and retry
-- bindings after removing the expired receipt payload.
begin;
set local search_path = pg_catalog;

alter table private.v2_booking_receipts alter column booking drop not null;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered','actor_revoked','profile_reviewed','profile_deleted',
    'mandate_reviewed','mandate_approved','mandate_revoked','preparation_created','step_up_requested',
    'step_up_approved','step_up_revoked','expired_mandate_reviews_redacted','booking_committed',
    'expired_booking_receipts_redacted'));

create index v2_booking_receipts_unredacted_expiry_idx
  on private.v2_booking_receipts (instance_id, epoch, principal_id, expires_at, receipt_id)
  where booking is not null;

create function private.v2_redact_expired_booking_receipts(
  p_instance_id uuid, p_epoch bigint, p_principal_id uuid, p_limit integer)
returns integer language plpgsql security invoker
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  v_now timestamptz;
  v_sequence bigint;
  v_count integer;
begin
  if p_instance_id is null or p_epoch is null or p_principal_id is null
    or p_limit is null or p_limit not between 1 and 100
  then raise exception sqlstate '22023' using message = 'INVALID_RETENTION_ARGUMENT'; end if;

  perform private.v2_assert_instance(p_instance_id, p_epoch);
  -- Use the same principal fence as first commits, receipt reads, and replay.
  -- Data removal also applies when the account has been disabled or deleted.
  perform 1 from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
    for update;
  if not found then return 0; end if;
  perform private.v2_assert_instance(p_instance_id, p_epoch);
  v_now := clock_timestamp();

  with expired_receipts as (
    select r.receipt_id from private.v2_booking_receipts r
      where (r.instance_id, r.epoch, r.principal_id) = (p_instance_id, p_epoch, p_principal_id)
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
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance_id, p_epoch, p_principal_id)
    returning p.event_sequence into v_sequence;
  insert into private.v2_authority_events (instance_id, epoch, principal_id, sequence, action, occurred_at)
    values (p_instance_id, p_epoch, p_principal_id, v_sequence, 'expired_booking_receipts_redacted', v_now);
  return v_count;
exception
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_redact_expired_booking_receipts(uuid, bigint, uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function private.v2_confirmed_booking_receipt(p_credential private.v2_actor_credentials,
  p_receipt private.v2_booking_receipts)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare
  v_status text;
  v_now timestamptz;
begin
  v_now := private.v2_live_booking_actor(p_credential);
  if p_receipt.booking is null or p_receipt.committed_at > v_now or p_receipt.expires_at <= v_now then
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

commit;
