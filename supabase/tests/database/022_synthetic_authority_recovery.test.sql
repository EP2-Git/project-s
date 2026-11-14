begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

-- Separate connections exercise the transaction-held fence and a snapshot
-- established before rotation. Only this suite's synthetic rows are committed.
select is(dblink_connect('recovery_operator', format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres', current_database())),
  'OK', 'the recovery operator uses an independent connection');
select is(dblink_connect('recovery_worker', format(
  'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres', current_database())),
  'OK', 'the authority worker uses an independent connection');

create function pg_temp.recovery_remove_lock_fixture() returns void
language plpgsql set search_path = pg_catalog as $$
begin
  perform extensions.dblink_exec('recovery_operator', $commands$
    begin;
    delete from private.v2_booking_epoch_keys where instance_id = 'd01e5220-18ce-4077-8c36-956a59cdcbda';
    delete from private.v2_authority_instance where instance_id = 'd01e5220-18ce-4077-8c36-956a59cdcbda';
    commit;
  $commands$);
end;
$$;

select pg_temp.recovery_remove_lock_fixture();
select dblink_exec('recovery_operator', $setup$
  begin;
  insert into private.v2_authority_instance (instance_id, epoch, audience)
    values ('d01e5220-18ce-4077-8c36-956a59cdcbda', 1, 'http://127.0.0.1:54321');
  insert into private.v2_booking_epoch_keys (instance_id, epoch)
    values ('d01e5220-18ce-4077-8c36-956a59cdcbda', 1);
  commit;
$setup$);

select dblink_exec('recovery_worker', $worker$
  create function pg_temp.check_generation(p_epoch bigint) returns text
  language plpgsql set search_path = pg_catalog as $fn$
  begin
    return private.v2_assert_instance('d01e5220-18ce-4077-8c36-956a59cdcbda', p_epoch);
  exception when sqlstate 'PT401' or sqlstate 'PT503' then
    return sqlstate || ' ' || sqlerrm;
  end;
  $fn$;
$worker$);
select is(dblink_exec('recovery_worker', 'begin'), 'BEGIN', 'the worker opens an authority transaction');
select is((select verdict from dblink('recovery_worker', 'select pg_temp.check_generation(1)') as result(verdict text)),
  'http://127.0.0.1:54321', 'the worker validates the current epoch and holds the shared fence');
select throws_ok($$select private.v2_rotate_synthetic_authority_epoch('d01e5220-18ce-4077-8c36-956a59cdcbda', 1, 2)$$,
  'PT503', 'AUTHORITY_BUSY', 'rotation refuses while a validated worker transaction is still open');
select is((select epoch from private.v2_authority_instance), 1::bigint, 'a busy rotation leaves the epoch in place');
select is((select count(*)::integer from private.v2_booking_epoch_keys
  where instance_id = 'd01e5220-18ce-4077-8c36-956a59cdcbda'), 1, 'a busy rotation creates no new epoch key');
select is(dblink_exec('recovery_worker', 'rollback'), 'ROLLBACK', 'the authority transaction drains');

select is(dblink_exec('recovery_worker', 'begin isolation level repeatable read'),
  'BEGIN', 'the worker opens a repeatable-read transaction');
select is((select epoch from dblink('recovery_worker', 'select epoch from private.v2_authority_instance') as result(epoch bigint)),
  1::bigint, 'the worker establishes a snapshot of the old generation before taking the authority fence');
select is(dblink_exec('recovery_operator', $rotate$
  do $run$ begin
    perform private.v2_rotate_synthetic_authority_epoch('d01e5220-18ce-4077-8c36-956a59cdcbda', 1, 2);
  end; $run$;
$rotate$), 'DO', 'rotation succeeds in a separate transaction after the shared fence is released');
select is((select verdict from dblink('recovery_worker', 'select pg_temp.check_generation(1)') as result(verdict text)),
  'PT503 AUTHORITY_BUSY', 'an older repeatable-read snapshot cannot validate the retired epoch');
select is(dblink_exec('recovery_worker', 'rollback'), 'ROLLBACK', 'the worker drops the stale transaction');
select is((select verdict from dblink('recovery_worker', 'select pg_temp.check_generation(1)') as result(verdict text)),
  'PT401 AUTHENTICATION_REQUIRED', 'a fresh snapshot rejects the retired epoch');
select is((select verdict from dblink('recovery_worker', 'select pg_temp.check_generation(2)') as result(verdict text)),
  'http://127.0.0.1:54321', 'a fresh snapshot can validate the replacement epoch');

-- Restore the fixture fence marker through a second normal rotation, then
-- remove only rows belonging to the committed lock fixture.
select dblink_exec('recovery_operator', $restore$
  do $run$ begin
    perform private.v2_rotate_synthetic_authority_epoch('d01e5220-18ce-4077-8c36-956a59cdcbda', 2, 3);
  end; $run$;
$restore$);
select pg_temp.recovery_remove_lock_fixture();
select is(dblink_disconnect('recovery_worker'), 'OK', 'the authority worker disconnects');
select is(dblink_disconnect('recovery_operator'), 'OK', 'the recovery operator disconnects');

-- Use the normal private service RPCs with synthetic issuer and actor contexts.
create function pg_temp.recovery_id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:recovery:' || p_label)
    placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
$$;

create function pg_temp.recovery_issuer(p_epoch bigint) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion', 2, 'requestId', 'synthetic-authority-recovery',
    'instanceId', pg_temp.recovery_id('instance'), 'epoch', p_epoch,
    'principalId', pg_temp.recovery_id('issuer'), 'subjectId', pg_temp.recovery_id('issuer'),
    'verifiedAt', private.v2_mandate_instant(clock_timestamp()), 'transport', 'ui');
$$;

create function pg_temp.recovery_actor(p_epoch bigint) returns jsonb
language sql set search_path = pg_catalog as $$
  select pg_temp.recovery_issuer(p_epoch) || jsonb_build_object(
    'transport', 'http', 'actorId', pg_temp.recovery_id('actor-' || p_epoch),
    'credentialId', pg_temp.recovery_id('credential-' || p_epoch),
    'credentialRevision', 1, 'credentialFingerprint', repeat(case when p_epoch = 1 then 'a' else 'b' end, 64));
$$;

create function pg_temp.recovery_rotate(p_expected bigint, p_new bigint) returns void
language sql set search_path = pg_catalog as $$
  select private.v2_rotate_synthetic_authority_epoch(pg_temp.recovery_id('instance'), p_expected, p_new);
$$;

create temporary table recovery_cases (
  label text primary key,
  epoch bigint not null,
  slot_time time not null,
  action text not null,
  request jsonb,
  prepared jsonb,
  summary_digest text,
  receipt jsonb
) on commit drop;

insert into recovery_cases (label, epoch, slot_time, action) values
  ('old-committed', 1, '09:30', 'commit'),
  ('old-standing', 1, '10:30', 'standing'),
  ('old-revoked', 1, '10:00', 'standing'),
  ('old-pending', 1, '13:00', 'pending'),
  ('old-granted', 1, '14:00', 'grant'),
  ('new-committed', 20, '11:30', 'commit');

create function pg_temp.recovery_prepare(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_prepare_delegated_booking_v2(
    pg_temp.recovery_actor(epoch), pg_temp.recovery_id(label || '-prep'), pg_temp.recovery_id(label || '-review'), request)
  from pg_temp.recovery_cases where label = p_label;
$$;

create function pg_temp.recovery_review(p_label text, p_epoch bigint) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_get_step_up_review_v2(
    pg_temp.recovery_issuer(p_epoch), pg_temp.recovery_id(p_label || '-review'));
$$;

create function pg_temp.recovery_approve(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_approve_step_up_v2(pg_temp.recovery_issuer(epoch),
    pg_temp.recovery_id(label || '-review'), pg_temp.recovery_id(label || '-prep'),
    pg_temp.recovery_id(label || '-grant'), 1, summary_digest)
  from pg_temp.recovery_cases where label = p_label;
$$;

create function pg_temp.recovery_commit(p_label text, p_epoch bigint) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_commit_delegated_booking_v2(
    pg_temp.recovery_actor(p_epoch), pg_temp.recovery_id(p_label || '-prep'), pg_temp.recovery_id(p_label || '-key'));
$$;

create function pg_temp.recovery_receipt(p_label text, p_epoch bigint) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_read_delegated_booking_receipt_v2(pg_temp.recovery_actor(p_epoch), (receipt->>'receiptId')::uuid)
  from pg_temp.recovery_cases where label = p_label;
$$;

create function pg_temp.recovery_issue_and_prepare(p_epoch bigint) returns void
language plpgsql set search_path = pg_catalog as $$
declare
  fixture_day date := (clock_timestamp() at time zone 'UTC')::date + 3;
  permission_start timestamptz;
  fixture record;
  booking_request jsonb;
  review jsonb;
begin
  perform public.project_s_register_actor_v2(pg_temp.recovery_issuer(p_epoch),
    pg_temp.recovery_id('actor-' || p_epoch), pg_temp.recovery_id('credential-' || p_epoch),
    decode(repeat(case when p_epoch = 1 then 'a' else 'b' end, 64), 'hex'),
    'Synthetic recovery actor', clock_timestamp() + interval '2 days');
  perform public.project_s_create_booker_profile_v2(pg_temp.recovery_issuer(p_epoch),
    pg_temp.recovery_id('profile-' || p_epoch),
    '{"name":"Synthetic Recovery Booker","email":"recovery-booker@example.invalid","guestTimeZone":"UTC"}');
  booking_request := jsonb_build_object('username', 'recovery-synthetic-host',
    'meetingTypeId', pg_temp.recovery_id('meeting'));
  permission_start := clock_timestamp() + interval '3 seconds';

  for fixture in select * from pg_temp.recovery_cases f where f.epoch = p_epoch loop
    review := public.project_s_create_mandate_review_v2(pg_temp.recovery_issuer(p_epoch),
      pg_temp.recovery_id(fixture.label || '-issuance'), booking_request || jsonb_build_object(
        'actorId', pg_temp.recovery_id('actor-' || p_epoch), 'profileId', pg_temp.recovery_id('profile-' || p_epoch),
        'profileRevision', 1,
        'meetingWindowStart', private.v2_mandate_instant((fixture_day + time '09:00') at time zone 'UTC'),
        'meetingWindowEnd', private.v2_mandate_instant((fixture_day + time '12:00') at time zone 'UTC'),
        'maxDurationMinutes', 30, 'notBefore', private.v2_mandate_instant(permission_start),
        'expiresAt', private.v2_mandate_instant(permission_start + interval '1 hour')));
    perform public.project_s_approve_mandate_v2(pg_temp.recovery_issuer(p_epoch), (review->>'reviewId')::uuid,
      pg_temp.recovery_id(fixture.label || '-mandate'), 1, review->>'summaryDigest');
    update pg_temp.recovery_cases set request = booking_request || jsonb_build_object(
      'mandateId', pg_temp.recovery_id(fixture.label || '-mandate'),
      'startAt', private.v2_mandate_instant((fixture_day + fixture.slot_time) at time zone 'UTC'))
    where label = fixture.label;
  end loop;

  perform pg_sleep(greatest(0, extract(epoch from permission_start - clock_timestamp() + interval '20 milliseconds')));
  for fixture in select * from pg_temp.recovery_cases f where f.epoch = p_epoch loop
    update pg_temp.recovery_cases set prepared = pg_temp.recovery_prepare(fixture.label) where label = fixture.label;
    if fixture.action in ('pending', 'grant') then
      review := pg_temp.recovery_review(fixture.label, p_epoch);
      update pg_temp.recovery_cases set summary_digest = review->>'summaryDigest' where label = fixture.label;
    end if;
    if fixture.action = 'grant' then
      perform pg_temp.recovery_approve(fixture.label);
    elsif fixture.action = 'commit' then
      update pg_temp.recovery_cases set receipt = pg_temp.recovery_commit(fixture.label, p_epoch) where label = fixture.label;
    end if;
  end loop;
end;
$$;

select ok(not prosecdef, 'rotation runs with the database caller privileges')
from pg_proc where oid = 'private.v2_rotate_synthetic_authority_epoch(uuid,bigint,bigint)'::regprocedure;
select ok(not exists (
  select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = 'private.v2_rotate_synthetic_authority_epoch(uuid,bigint,bigint)'::regprocedure
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), 'PUBLIC cannot execute rotation');
select ok(not has_function_privilege(role_name,
  'private.v2_rotate_synthetic_authority_epoch(uuid,bigint,bigint)', 'EXECUTE'),
  role_name || ' cannot execute rotation')
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select throws_ok($$select pg_temp.recovery_rotate(1, 20)$$,
  'PT409', 'VERSION_CONFLICT', 'rotation requires an initialized instance');

insert into private.v2_authority_instance(instance_id, epoch, audience)
values (pg_temp.recovery_id('instance'), 1, 'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id, epoch)
values (pg_temp.recovery_id('instance'), 1), (pg_temp.recovery_id('instance'), 8);
insert into private.v2_authority_principals(instance_id, epoch, principal_id)
values (pg_temp.recovery_id('instance'), 9, pg_temp.recovery_id('issuer'));

select throws_ok(format('select pg_temp.recovery_rotate(%L::bigint, %L::bigint)', previous, next),
  '22023', 'INVALID_AUTHORITY_EPOCH', description)
from (values
  (null::bigint, 20::bigint, 'missing previous epoch is refused'),
  (1, null, 'missing replacement epoch is refused'),
  (0, 20, 'epoch zero is refused'),
  (1, 1, 'reusing the current epoch is refused'),
  (2, 1, 'a decreasing replacement epoch is refused'),
  (1, 9007199254740992, 'epochs beyond the exact wire range are refused'),
  (1, 7, 'an unused epoch below recorded history is refused'),
  (1, 8, 'an epoch with an existing idempotency key is refused'),
  (1, 9, 'an epoch already referenced by a principal is refused')
) cases(previous, next, description);
select throws_ok($$select private.v2_rotate_synthetic_authority_epoch(null, 1, 20)$$,
  '22023', 'INVALID_AUTHORITY_EPOCH', 'missing instance ID is refused');
select throws_ok($$select private.v2_rotate_synthetic_authority_epoch(pg_temp.recovery_id('other'), 1, 20)$$,
  'PT409', 'VERSION_CONFLICT', 'rotation refuses a different instance');
select throws_ok($$select pg_temp.recovery_rotate(2, 20)$$,
  'PT409', 'VERSION_CONFLICT', 'rotation refuses stale expected state');
select is((select epoch from private.v2_authority_instance), 1::bigint, 'rejected rotations leave current epoch unchanged');
select is((select array_agg(epoch order by epoch) from private.v2_booking_epoch_keys
  where instance_id = pg_temp.recovery_id('instance')), array[1::bigint, 8::bigint],
  'rejected rotations leave the key inventory unchanged');

insert into auth.users(instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, is_anonymous)
select '00000000-0000-0000-0000-000000000000', pg_temp.recovery_id(label), 'authenticated', 'authenticated',
  username || '@example.invalid', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', username, 'full_name', 'Synthetic Recovery Account', 'timezone', 'UTC'),
  clock_timestamp(), clock_timestamp(), '', '', '', '', false
from (values ('issuer', 'recovery-synthetic-issuer'), ('host', 'recovery-synthetic-host')) fixtures(label, username);
insert into public.meeting_types(id, user_id, title, duration_minutes, slot_interval_minutes,
  buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, active)
values (pg_temp.recovery_id('meeting'), pg_temp.recovery_id('host'), 'Synthetic Recovery Meeting', 30, 15, 0, 0, 0, true);
insert into public.specific_date_availabilities(user_id, date, status, start_time, end_time)
values (pg_temp.recovery_id('host'), (clock_timestamp() at time zone 'UTC')::date + 3, 'available', '09:00', '18:00');

select lives_ok($$select pg_temp.recovery_issue_and_prepare(1)$$,
  'the restored fixture includes a booking, an unused standing preparation, a pending review and an approved exception');
select ok((select receipt->>'receiptId' is not null from recovery_cases where label = 'old-committed'),
  'the old epoch committed a real booking and receipt');
select is(pg_temp.recovery_receipt('old-committed', 1), (select receipt from recovery_cases where label = 'old-committed'),
  'the old actor can read the receipt before rotation');
select is(pg_temp.recovery_commit('old-committed', 1), (select receipt from recovery_cases where label = 'old-committed'),
  'the old actor can recover the exact booking by retry before rotation');
select is(public.project_s_get_mandate_v2(pg_temp.recovery_issuer(1), pg_temp.recovery_id('old-standing-mandate'))
  ->>'remainingUses', '1', 'a restored standing mandate has a live unused booking before rotation');
select ok(pg_temp.recovery_review('old-pending', 1)->>'summaryDigest' is not null,
  'a restored step-up request is ready to be reviewed before rotation');
select is((select state from private.v2_step_up_grants where grant_id = pg_temp.recovery_id('old-granted-grant')),
  'active', 'a restored one-use step-up grant is live before rotation');
select lives_ok($$select public.project_s_revoke_mandate_v2(pg_temp.recovery_issuer(1),
  pg_temp.recovery_id('old-revoked-mandate'), 1)$$, 'record a revocation before advancing the epoch');

create temporary table recovery_snapshot on commit drop as
select
  (select to_jsonb(b) from public.bookings b
    join private.v2_booking_receipts r on r.booking_id = b.id where r.instance_id = pg_temp.recovery_id('instance')) as booking,
  (select to_jsonb(r) from private.v2_booking_receipts r where r.instance_id = pg_temp.recovery_id('instance')) as receipt,
  (select key from private.v2_booking_epoch_keys where instance_id = pg_temp.recovery_id('instance') and epoch = 1) as prior_key,
  (select jsonb_agg(to_jsonb(e) order by e.sequence) from private.v2_authority_events e
    where e.instance_id = pg_temp.recovery_id('instance') and e.epoch = 1) as events,
  (select jsonb_agg(to_jsonb(m) order by m.mandate_id) from private.v2_mandates m
    where m.instance_id = pg_temp.recovery_id('instance') and m.epoch = 1) as mandates,
  (select jsonb_agg(to_jsonb(g) order by g.grant_id) from private.v2_step_up_grants g
    where g.instance_id = pg_temp.recovery_id('instance') and g.epoch = 1) as grants,
  public.get_public_booking_page_v1('recovery-synthetic-host') as public_page;

select lives_ok($$select pg_temp.recovery_rotate(1, 20)$$, 'an owner can supply a fresh epoch above known history');
select is((select epoch from private.v2_authority_instance), 20::bigint, 'the new epoch is visible to fresh contexts');
select is(private.v2_assert_instance(pg_temp.recovery_id('instance'), 20), 'http://127.0.0.1:54321',
  'rotation preserves the configured audience');
select ok((select octet_length(k.key) = 32 and k.key <> s.prior_key
  from private.v2_booking_epoch_keys k cross join recovery_snapshot s
  where k.instance_id = pg_temp.recovery_id('instance') and k.epoch = 20), 'rotation generates a distinct idempotency key');
select throws_ok($$select pg_temp.recovery_rotate(1, 21)$$,
  'PT409', 'VERSION_CONFLICT', 'a stale rotation cannot replace the newly active epoch');
select throws_ok($$select pg_temp.recovery_rotate(20, 1)$$,
  '22023', 'INVALID_AUTHORITY_EPOCH', 'an owner cannot roll the active epoch back to restore old authority');

select ok(public.project_s_get_actor_credential_v2(pg_temp.recovery_id('credential-1'), pg_temp.recovery_id('instance'), 1)
  is null, 'old credential discovery fails at the retired epoch');
select ok(public.project_s_get_actor_credential_v2(pg_temp.recovery_id('credential-1'), pg_temp.recovery_id('instance'), 20)
  is null, 'the new epoch does not recognise the old credential');
select throws_ok($$select public.project_s_get_mandate_v2(pg_temp.recovery_issuer(1),
  pg_temp.recovery_id('old-standing-mandate'))$$, 'PT401', 'AUTHENTICATION_REQUIRED', 'a stale issuer cannot manage an old mandate');
select throws_ok($$select pg_temp.recovery_prepare('old-standing')$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'a stale actor cannot prepare using the old epoch');
select throws_ok($$select pg_temp.recovery_review('old-pending', 1)$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'a stale issuer cannot open a pending step-up review');
select throws_ok($$select pg_temp.recovery_approve('old-pending')$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'a stale issuer cannot approve a pending step-up review');
select throws_ok(format('select pg_temp.recovery_commit(%L, 1)', label),
  'PT401', 'AUTHENTICATION_REQUIRED', label || ' cannot create or replay in the old epoch')
from recovery_cases where label in ('old-granted', 'old-standing', 'old-revoked', 'old-committed') order by label;
select throws_ok($$select pg_temp.recovery_receipt('old-committed', 1)$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'the old actor loses access to its committed receipt');
select is((select count(*)::integer from public.bookings where user_id = pg_temp.recovery_id('host')), 1,
  'retired authority cannot add bookings');

select lives_ok($$select pg_temp.recovery_issue_and_prepare(20)$$,
  'a fresh issuer explicitly registers, reviews and commits with new authority');
select ok((select receipt->>'receiptId' is not null from recovery_cases where label = 'new-committed'),
  'the fresh authorized booking creates a receipt');
select is(pg_temp.recovery_commit('new-committed', 20), (select receipt from recovery_cases where label = 'new-committed'),
  'the fresh epoch can replay the exact new receipt');
select throws_ok($$select pg_temp.recovery_receipt('old-committed', 20)$$,
  'PT403', 'FORBIDDEN', 'fresh authority for the same issuer cannot access a historical receipt');
select throws_ok($$select pg_temp.recovery_commit('old-granted', 20)$$,
  'PT403', 'FORBIDDEN', 'fresh authority cannot spend a historical grant');
select is((select count(*)::integer from public.bookings where user_id = pg_temp.recovery_id('host')), 2,
  'existing booking and one fresh booking coexist');

select is((select to_jsonb(b) from public.bookings b
  where b.id = (s.booking->>'id')::uuid), s.booking, 'the previously committed booking is retained exactly')
from recovery_snapshot s;
select is((select to_jsonb(r) from private.v2_booking_receipts r
  where r.receipt_id = (s.receipt->>'receipt_id')::uuid), s.receipt, 'the historical receipt binding is retained exactly')
from recovery_snapshot s;
select ok((select key from private.v2_booking_epoch_keys where instance_id = pg_temp.recovery_id('instance') and epoch = 1)
  = s.prior_key, 'the old idempotency key is preserved without exposing key bytes') from recovery_snapshot s;
select ok((select jsonb_agg(to_jsonb(e) order by e.sequence) from private.v2_authority_events e
  where e.instance_id = pg_temp.recovery_id('instance') and e.epoch = 1) = s.events,
  'the old audit history is preserved without exposing its contents') from recovery_snapshot s;
select ok((select jsonb_agg(to_jsonb(m) order by m.mandate_id) from private.v2_mandates m
  where m.instance_id = pg_temp.recovery_id('instance') and m.epoch = 1) = s.mandates,
  'old mandates retain their recorded state, including revocation') from recovery_snapshot s;
select ok((select jsonb_agg(to_jsonb(g) order by g.grant_id) from private.v2_step_up_grants g
  where g.instance_id = pg_temp.recovery_id('instance') and g.epoch = 1) = s.grants,
  'historical grant rows retain their evidence without regaining authority') from recovery_snapshot s;
select is(public.get_public_booking_page_v1('recovery-synthetic-host'), s.public_page,
  'the host public booking page remains available') from recovery_snapshot s;

select * from finish();
rollback;
