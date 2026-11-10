-- The caller applies the checked-in migration with the local Supabase CLI.
begin;
set local search_path = pg_catalog;

do $$
declare
  v_before receipt_upgrade_fixture.before_upgrade%rowtype;
  v_receipt_id uuid;
  v_preparation_id uuid := receipt_upgrade_fixture.id('prep-' || time '10:00');
  v_key uuid := receipt_upgrade_fixture.id('key');
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261108000000') then
    raise exception 'Exception receipt migration is missing from the local migration history';
  end if;
  select * into strict v_before from receipt_upgrade_fixture.before_upgrade;
  v_receipt_id := (v_before.receipt->>'receiptId')::uuid;

  if not exists (select 1 from private.v2_booking_receipts r where r.receipt_id = v_receipt_id
    and r.provider = 'local_mandate' and r.preparation_id = v_preparation_id
    and r.standing_preparation_id = v_preparation_id and r.step_up_preparation_id is null
    and r.step_up_review_id is null and r.step_up_grant_id is null)
    or receipt_upgrade_fixture.state() is distinct from v_before.state
  then
    raise exception 'Upgrade did not preserve the old receipt, booking, key and audit bindings';
  end if;

  if public.project_s_read_delegated_booking_receipt_v2(receipt_upgrade_fixture.actor(1),
      v_receipt_id) is distinct from v_before.receipt
    or public.project_s_commit_delegated_booking_v2(receipt_upgrade_fixture.actor(1),
      v_preparation_id, v_key) is distinct from v_before.receipt
    or (public.project_s_get_mandate_v2(receipt_upgrade_fixture.principal(),
      receipt_upgrade_fixture.id('mandate'))->>'remainingUses') is distinct from '0'
  then
    raise exception 'Upgrade changed exact read or replay, or restored a spent use';
  end if;

  begin
    perform public.project_s_read_delegated_booking_receipt_v2(receipt_upgrade_fixture.actor(2), v_receipt_id);
    raise exception 'Another credential could read the upgraded receipt';
  exception when sqlstate 'PT403' then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;

  begin
    perform public.project_s_commit_delegated_booking_v2(receipt_upgrade_fixture.actor(1),
      receipt_upgrade_fixture.id('prep-' || time '11:00'), v_key);
    raise exception 'The original key was reusable on a different preparation';
  exception when sqlstate 'PT409' then
    if sqlerrm <> 'IDEMPOTENCY_KEY_REUSED' then raise; end if;
  end;

  begin
    perform public.project_s_commit_delegated_booking_v2(receipt_upgrade_fixture.actor(1),
      receipt_upgrade_fixture.id('prep-' || time '11:00'), receipt_upgrade_fixture.id('new-key'));
    raise exception 'A fresh key could spend the upgraded mandate again';
  exception when sqlstate 'PT403' then
    if sqlerrm <> 'FORBIDDEN' then raise; end if;
  end;

  if receipt_upgrade_fixture.state() is distinct from v_before.state then
    raise exception 'Receipt reads, replays or refusals changed stored booking or audit state';
  end if;

  perform public.project_s_revoke_actor_v2(receipt_upgrade_fixture.principal(),
    receipt_upgrade_fixture.id('actor-1'), 1);
  begin
    perform public.project_s_commit_delegated_booking_v2(receipt_upgrade_fixture.actor(1),
      v_preparation_id, v_key);
    raise exception 'A revoked credential could replay the upgraded receipt';
  exception when sqlstate 'PT401' then
    if sqlerrm <> 'AUTHENTICATION_REQUIRED' then raise; end if;
  end;
end;
$$;
rollback;

select 'Standing receipt upgrade preserved exact read and replay, one-use, credential isolation and stored state';
