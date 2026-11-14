-- Offline authority recovery, with an externally chosen fresh epoch (ADR 0004).
-- This migration neither configures an instance nor enables delegated routes.
begin;
set local search_path = pg_catalog;

create table private.v2_authority_recovery_fence (
  singleton boolean primary key default true check (singleton),
  rotation_marker boolean not null default false
);
insert into private.v2_authority_recovery_fence default values;
alter table private.v2_authority_recovery_fence enable row level security;
revoke all on private.v2_authority_recovery_fence from public, anon, authenticated, service_role;

create or replace function private.v2_assert_instance(p_instance_id uuid, p_epoch bigint)
returns text
language plpgsql
set search_path = pg_catalog
as $$
declare v_audience text;
begin
  -- Hold the shared fence to transaction end, including after the last
  -- authority check. Recovery takes it exclusively before touching the epoch.
  perform 1 from private.v2_authority_recovery_fence where singleton for share nowait;
  if not found then raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY'; end if;

  select i.audience into v_audience from private.v2_authority_instance i
    where i.singleton and i.synthetic_only and i.instance_id = p_instance_id and i.epoch = p_epoch;
  if not found then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  return v_audience;
exception
  when lock_not_available or serialization_failure then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function private.v2_rotate_synthetic_authority_epoch(
  p_instance_id uuid, p_expected_epoch bigint, p_new_epoch bigint
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
begin
  if p_instance_id is null or p_expected_epoch is null or p_new_epoch is null
    or p_expected_epoch < 1 or p_new_epoch > 9007199254740991
    or p_new_epoch <= p_expected_epoch
  then raise exception sqlstate '22023' using message = 'INVALID_AUTHORITY_EPOCH'; end if;

  perform 1 from private.v2_authority_recovery_fence where singleton for update nowait;
  if not found then raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY'; end if;

  perform 1 from private.v2_authority_instance i
    where i.singleton and i.synthetic_only and i.instance_id = p_instance_id and i.epoch = p_expected_epoch
    for update nowait;
  if not found then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;

  -- Historical authority records reference principal fences directly or
  -- transitively. Their keys and receipts stay associated with the old epoch.
  if exists (select 1 from private.v2_authority_principals p
    where p.instance_id = p_instance_id and p.epoch >= p_new_epoch)
    or exists (select 1 from private.v2_booking_epoch_keys k
      where k.instance_id = p_instance_id and k.epoch >= p_new_epoch)
  then raise exception sqlstate '22023' using message = 'INVALID_AUTHORITY_EPOCH'; end if;

  insert into private.v2_booking_epoch_keys (instance_id, epoch)
    values (p_instance_id, p_new_epoch) on conflict do nothing;
  if not found then raise exception sqlstate '22023' using message = 'INVALID_AUTHORITY_EPOCH'; end if;

  update private.v2_authority_instance set epoch = p_new_epoch where singleton;
  -- Update the fence row version even if several rotations eventually return
  -- the marker to the same value. A transaction with an older snapshot then
  -- fails to lock the visible old tuple instead of validating its old epoch.
  update private.v2_authority_recovery_fence set rotation_marker = not rotation_marker where singleton;
exception
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;
revoke all on function private.v2_rotate_synthetic_authority_epoch(uuid, bigint, bigint)
  from public, anon, authenticated, service_role;

commit;
