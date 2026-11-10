-- This fixture runs on the disposable, unseeded predecessor database.
begin;
set local search_path = pg_catalog;

do $$
begin
  if (select max(version) from supabase_migrations.schema_migrations) is distinct from '20261107000100'
    or exists (select 1 from information_schema.columns where table_schema = 'private'
      and table_name = 'v2_booking_receipts' and column_name = 'provider')
    or exists (select 1 from auth.users)
    or exists (select 1 from public.bookings)
    or exists (select 1 from private.v2_authority_instance)
    or exists (select 1 from private.v2_booking_receipts)
  then
    raise exception 'Standing receipt fixture requires a fresh, unseeded predecessor database';
  end if;
end;
$$;

create schema receipt_upgrade_fixture;
create table receipt_upgrade_fixture.before_upgrade (receipt jsonb not null, state jsonb not null);

create function receipt_upgrade_fixture.id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:receipt-upgrade:' || p_label) placing '4' from 13 for 1)
    placing '8' from 17 for 1)::uuid;
$$;

create function receipt_upgrade_fixture.principal() returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion', 2, 'requestId', 'synthetic-standing-receipt-upgrade',
    'instanceId', receipt_upgrade_fixture.id('instance'), 'epoch', 1,
    'principalId', receipt_upgrade_fixture.id('owner'), 'subjectId', receipt_upgrade_fixture.id('owner'),
    'verifiedAt', private.v2_mandate_instant(clock_timestamp()), 'transport', 'http');
$$;

create function receipt_upgrade_fixture.actor(p_actor integer) returns jsonb
language sql set search_path = pg_catalog as $$
  select receipt_upgrade_fixture.principal() || jsonb_build_object(
    'actorId', receipt_upgrade_fixture.id('actor-' || p_actor),
    'credentialId', receipt_upgrade_fixture.id('credential-' || p_actor),
    'credentialRevision', 1, 'credentialFingerprint', repeat(case when p_actor = 1 then 'a' else 'b' end, 64));
$$;

-- Strip only the new provider columns to compare the complete predecessor row.
create function receipt_upgrade_fixture.state() returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object(
    'receipts', (select jsonb_agg(to_jsonb(r) -
        array['provider','standing_preparation_id','step_up_preparation_id','step_up_review_id','step_up_grant_id']
        order by r.receipt_id)
      from private.v2_booking_receipts r where r.instance_id = receipt_upgrade_fixture.id('instance')),
    'bookings', (select jsonb_agg(to_jsonb(b) order by b.id) from public.bookings b
      where b.user_id = receipt_upgrade_fixture.id('host')),
    'preparations', (select jsonb_agg(to_jsonb(p) order by p.preparation_id)
      from private.v2_delegated_preparations p where p.instance_id = receipt_upgrade_fixture.id('instance')),
    'mandates', (select jsonb_agg(to_jsonb(m) order by m.mandate_id) from private.v2_mandates m
      where m.instance_id = receipt_upgrade_fixture.id('instance')),
    'events', (select jsonb_agg(to_jsonb(e) order by e.sequence) from private.v2_authority_events e
      where e.instance_id = receipt_upgrade_fixture.id('instance')),
    'epochKeyDigest', (select encode(extensions.digest(k.key, 'sha256'), 'hex')
      from private.v2_booking_epoch_keys k where k.instance_id = receipt_upgrade_fixture.id('instance') and k.epoch = 1)
  );
$$;

insert into private.v2_authority_instance(instance_id, epoch, audience)
values (receipt_upgrade_fixture.id('instance'), 1, 'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id, epoch)
values (receipt_upgrade_fixture.id('instance'), 1);

insert into auth.users(instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, is_anonymous)
select '00000000-0000-0000-0000-000000000000', receipt_upgrade_fixture.id(label), 'authenticated', 'authenticated',
  username || '@example.invalid', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', username, 'full_name', 'Synthetic Upgrade Account', 'timezone', 'UTC'),
  clock_timestamp(), clock_timestamp(), '', '', '', '', false
from (values ('owner', 'synthetic-upgrade-owner'), ('host', 'synthetic-upgrade-host')) fixture(label, username);

insert into public.meeting_types(id, user_id, title, duration_minutes, slot_interval_minutes,
  buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, active)
values (receipt_upgrade_fixture.id('meeting'), receipt_upgrade_fixture.id('host'), 'Synthetic Upgrade Meeting',
  30, 15, 5, 5, 0, true);

do $$
declare
  v_day date := (clock_timestamp() at time zone 'UTC')::date + 3;
  v_permission_start timestamptz;
  v_review jsonb;
  v_request jsonb;
  v_prepared jsonb;
  v_receipt jsonb;
  v_state jsonb;
  v_slot time;
  v_actor integer;
begin
  insert into public.specific_date_availabilities(user_id, date, status, start_time, end_time)
  values (receipt_upgrade_fixture.id('host'), v_day, 'available', '09:00', '13:00');
  for v_actor in 1..2 loop
    perform public.project_s_register_actor_v2(receipt_upgrade_fixture.principal(),
      receipt_upgrade_fixture.id('actor-' || v_actor), receipt_upgrade_fixture.id('credential-' || v_actor),
      decode(repeat(case when v_actor = 1 then 'a' else 'b' end, 64), 'hex'),
      'Synthetic upgrade actor', clock_timestamp() + interval '2 days');
  end loop;
  perform public.project_s_create_booker_profile_v2(receipt_upgrade_fixture.principal(),
    receipt_upgrade_fixture.id('profile'),
    '{"name":"Synthetic Upgrade Booker","email":"synthetic-upgrade-booker@example.invalid","guestTimeZone":"+05:30"}');

  v_permission_start := clock_timestamp() + interval '5 seconds';
  v_request := jsonb_build_object('username', 'synthetic-upgrade-host',
    'meetingTypeId', receipt_upgrade_fixture.id('meeting'));
  v_review := public.project_s_create_mandate_review_v2(receipt_upgrade_fixture.principal(),
    receipt_upgrade_fixture.id('review'), v_request || jsonb_build_object(
      'actorId', receipt_upgrade_fixture.id('actor-1'), 'profileId', receipt_upgrade_fixture.id('profile'),
      'profileRevision', 1,
      'meetingWindowStart', private.v2_mandate_instant((v_day + time '09:00') at time zone 'UTC'),
      'meetingWindowEnd', private.v2_mandate_instant((v_day + time '13:00') at time zone 'UTC'),
      'maxDurationMinutes', 30, 'notBefore', private.v2_mandate_instant(v_permission_start),
      'expiresAt', private.v2_mandate_instant(v_permission_start + interval '1 hour')));
  perform public.project_s_approve_mandate_v2(receipt_upgrade_fixture.principal(),
    (v_review->>'reviewId')::uuid, receipt_upgrade_fixture.id('mandate'), 1, v_review->>'summaryDigest');
  perform pg_sleep(greatest(0, extract(epoch from v_permission_start - clock_timestamp()
    + interval '20 milliseconds'))::double precision);

  foreach v_slot in array array[time '10:00', time '11:00'] loop
    v_prepared := public.project_s_prepare_delegated_booking_v2(receipt_upgrade_fixture.actor(1),
      receipt_upgrade_fixture.id('prep-' || v_slot), receipt_upgrade_fixture.id('step-up-' || v_slot),
      v_request || jsonb_build_object('mandateId', receipt_upgrade_fixture.id('mandate'),
        'startAt', private.v2_mandate_instant((v_day + v_slot) at time zone 'UTC')));
    if (v_prepared->>'kind') is distinct from 'prepared'
      or (v_prepared#>>'{data,preparationId}')::uuid is distinct from receipt_upgrade_fixture.id('prep-' || v_slot)
    then
      raise exception 'Predecessor did not prepare both standing slots';
    end if;
  end loop;

  v_receipt := public.project_s_commit_delegated_booking_v2(receipt_upgrade_fixture.actor(1),
    receipt_upgrade_fixture.id('prep-' || time '10:00'), receipt_upgrade_fixture.id('key'));
  v_state := receipt_upgrade_fixture.state();
  if (v_receipt#>>'{booking,guestTimeZone}') is distinct from '+05:30'
    or jsonb_array_length(v_state->'receipts') is distinct from 1
    or jsonb_array_length(v_state->'bookings') is distinct from 1
    or (v_state#>'{bookings,0,guest_timezone}') is distinct from 'null'::jsonb
    or (select count(*) from private.v2_authority_events where instance_id = receipt_upgrade_fixture.id('instance')
      and action = 'booking_committed') <> 1
    or (public.project_s_get_mandate_v2(receipt_upgrade_fixture.principal(),
      receipt_upgrade_fixture.id('mandate'))->>'remainingUses') is distinct from '0'
    or public.project_s_read_delegated_booking_receipt_v2(receipt_upgrade_fixture.actor(1),
      (v_receipt->>'receiptId')::uuid) is distinct from v_receipt
  then
    raise exception 'Predecessor did not persist one consumed standing booking and its exact receipt';
  end if;
  insert into receipt_upgrade_fixture.before_upgrade(receipt, state) values (v_receipt, v_state);
end;
$$;
commit;

select 'Predecessor standing booking and receipt committed';
