begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create function pg_temp.summary_retention_id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:summary-retention:' || p_label)
    placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
$$;

create function pg_temp.summary_retention_principal(p_issuer text) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object('contractVersion', 2, 'requestId', 'synthetic-summary-retention',
    'instanceId', pg_temp.summary_retention_id('instance'), 'epoch', 1,
    'principalId', pg_temp.summary_retention_id(p_issuer), 'subjectId', pg_temp.summary_retention_id(p_issuer),
    'verifiedAt', private.v2_mandate_instant(clock_timestamp()), 'transport', 'http');
$$;

create function pg_temp.summary_retention_actor(p_issuer text) returns jsonb
language sql set search_path = pg_catalog as $$
  select pg_temp.summary_retention_principal(p_issuer) || jsonb_build_object(
    'actorId', pg_temp.summary_retention_id(p_issuer || '-actor'),
    'credentialId', pg_temp.summary_retention_id(p_issuer || '-credential'),
    'credentialRevision', 1, 'credentialFingerprint', repeat(case when p_issuer = 'issuer-a' then 'a' else 'b' end, 64));
$$;

create function pg_temp.summary_redact(p_issuer text, p_limit integer, p_epoch bigint default 1) returns integer
language sql set search_path = pg_catalog as $$
  select private.v2_redact_expired_delegated_summaries(
    pg_temp.summary_retention_id('instance'), p_epoch, pg_temp.summary_retention_id(p_issuer), p_limit);
$$;

create temporary table summary_retention_fixture (
  label text primary key,
  issuer text not null,
  slot_start time not null,
  kind text not null,
  expires boolean not null,
  request jsonb,
  response jsonb,
  review_digest text,
  receipt jsonb
) on commit drop;

insert into summary_retention_fixture (label, issuer, slot_start, kind, expires) values
  ('standing-old', 'issuer-a', '09:30', 'standing', true),
  ('standing-a', 'issuer-a', '09:45', 'standing', true),
  ('standing-b', 'issuer-a', '10:00', 'standing', true),
  ('standing-live', 'issuer-a', '10:15', 'standing', false),
  ('committed', 'issuer-a', '11:00', 'standing', false),
  ('request-old', 'issuer-a', '13:00', 'request', true),
  ('request-live', 'issuer-a', '13:15', 'request', false),
  ('replacement-old', 'issuer-a', '14:00', 'replacement', true),
  ('replacement-live', 'issuer-a', '14:15', 'replacement', false),
  ('foreign', 'issuer-b', '10:30', 'standing', true);

create function pg_temp.summary_retention_prepare(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_prepare_delegated_booking_v2(pg_temp.summary_retention_actor(issuer),
    pg_temp.summary_retention_id(label || '-prep'), pg_temp.summary_retention_id(label || '-review'), request)
  from pg_temp.summary_retention_fixture where label = p_label;
$$;

create function pg_temp.summary_retention_get_review(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_get_step_up_review_v2(pg_temp.summary_retention_principal(issuer),
    pg_temp.summary_retention_id(label || '-review'))
  from pg_temp.summary_retention_fixture where label = p_label;
$$;

create function pg_temp.summary_retention_approve(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_approve_step_up_v2(pg_temp.summary_retention_principal(issuer),
    pg_temp.summary_retention_id(label || '-review'), pg_temp.summary_retention_id(label || '-prep'),
    pg_temp.summary_retention_id(label || '-grant'), 1, review_digest)
  from pg_temp.summary_retention_fixture where label = p_label;
$$;

create function pg_temp.summary_retention_commit(p_label text) returns jsonb
language sql set search_path = pg_catalog as $$
  select public.project_s_commit_delegated_booking_v2(pg_temp.summary_retention_actor(issuer),
    pg_temp.summary_retention_id(label || '-prep'), pg_temp.summary_retention_id(label || '-key'))
  from pg_temp.summary_retention_fixture where label = p_label;
$$;

select ok(not p.prosecdef, 'summary cleanup uses the database caller privileges')
from pg_proc p where p.oid = 'private.v2_redact_expired_delegated_summaries(uuid,bigint,uuid,integer)'::regprocedure;
select ok(not exists (
  select 1 from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = 'private.v2_redact_expired_delegated_summaries(uuid,bigint,uuid,integer)'::regprocedure
    and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'), 'PUBLIC cannot execute summary cleanup');
select ok(not has_function_privilege(role_name,
  'private.v2_redact_expired_delegated_summaries(uuid,bigint,uuid,integer)', 'EXECUTE'),
  role_name || ' cannot execute summary cleanup')
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select throws_ok($$select pg_temp.summary_redact('issuer-a', 1)$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'cleanup requires an active authority instance');
select throws_ok(format('select pg_temp.summary_redact(%L, %L::integer)', 'issuer-a', batch_limit),
  '22023', 'INVALID_RETENTION_ARGUMENT', 'rejects batch size ' || coalesce(batch_limit::text, 'null'))
from (values (0), (101), (null::integer)) limits(batch_limit);
select throws_ok($$select pg_temp.summary_redact(null, 1)$$,
  '22023', 'INVALID_RETENTION_ARGUMENT', 'rejects a missing issuer argument');

insert into private.v2_authority_instance(instance_id, epoch, audience)
values (pg_temp.summary_retention_id('instance'), 1, 'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id, epoch)
values (pg_temp.summary_retention_id('instance'), 1);
select throws_ok($$select pg_temp.summary_redact('issuer-a', 1, 2)$$,
  'PT401', 'AUTHENTICATION_REQUIRED', 'cleanup rejects a wrong epoch');
select is(pg_temp.summary_redact('unknown', 1), 0, 'a missing issuer returns no work');

insert into auth.users(instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, is_anonymous)
select '00000000-0000-0000-0000-000000000000', pg_temp.summary_retention_id(label), 'authenticated', 'authenticated',
  username || '@example.invalid', clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username', username, 'full_name', 'Synthetic Summary Account', 'timezone', 'UTC'),
  clock_timestamp(), clock_timestamp(), '', '', '', '', false
from (values ('issuer-a', 'summary-issuer-a'), ('issuer-b', 'summary-issuer-b'), ('host', 'summary-test-host'))
  fixtures(label, username);
insert into public.meeting_types(id, user_id, title, duration_minutes, slot_interval_minutes,
  buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, active)
values (pg_temp.summary_retention_id('meeting'), pg_temp.summary_retention_id('host'),
  'Synthetic Summary Meeting', 30, 15, 0, 0, 0, true);

do $$
declare
  fixture_day date := (clock_timestamp() at time zone 'UTC')::date + 3;
  permission_start timestamptz;
  issuer_name text;
  fixture record;
  base_request jsonb;
  review jsonb;
  tied_expiry timestamptz;
begin
  insert into public.specific_date_availabilities(user_id, date, status, start_time, end_time)
  values (pg_temp.summary_retention_id('host'), fixture_day, 'available', '09:00', '18:00');
  foreach issuer_name in array array['issuer-a', 'issuer-b'] loop
    perform public.project_s_register_actor_v2(pg_temp.summary_retention_principal(issuer_name),
      pg_temp.summary_retention_id(issuer_name || '-actor'), pg_temp.summary_retention_id(issuer_name || '-credential'),
      decode(repeat(case when issuer_name = 'issuer-a' then 'a' else 'b' end, 64), 'hex'),
      'Synthetic summary actor', clock_timestamp() + interval '2 days');
    perform public.project_s_create_booker_profile_v2(pg_temp.summary_retention_principal(issuer_name),
      pg_temp.summary_retention_id(issuer_name || '-profile'),
      '{"name":"Synthetic Summary Booker","email":"summary-booker@example.invalid","guestTimeZone":"+05:30"}');
  end loop;

  base_request := jsonb_build_object('username', 'summary-test-host', 'meetingTypeId', pg_temp.summary_retention_id('meeting'));
  permission_start := clock_timestamp() + interval '5 seconds';
  for fixture in select * from summary_retention_fixture loop
    review := public.project_s_create_mandate_review_v2(pg_temp.summary_retention_principal(fixture.issuer),
      pg_temp.summary_retention_id(fixture.label || '-issuance'), base_request || jsonb_build_object(
        'actorId', pg_temp.summary_retention_id(fixture.issuer || '-actor'),
        'profileId', pg_temp.summary_retention_id(fixture.issuer || '-profile'), 'profileRevision', 1,
        'meetingWindowStart', private.v2_mandate_instant((fixture_day + time '09:00') at time zone 'UTC'),
        'meetingWindowEnd', private.v2_mandate_instant((fixture_day + time '12:00') at time zone 'UTC'),
        'maxDurationMinutes', 30, 'notBefore', private.v2_mandate_instant(permission_start),
        'expiresAt', private.v2_mandate_instant(permission_start + interval '1 hour')));
    perform public.project_s_approve_mandate_v2(pg_temp.summary_retention_principal(fixture.issuer),
      (review->>'reviewId')::uuid, pg_temp.summary_retention_id(fixture.label || '-mandate'), 1, review->>'summaryDigest');
    update summary_retention_fixture set request = base_request || jsonb_build_object(
      'mandateId', pg_temp.summary_retention_id(fixture.label || '-mandate'),
      'startAt', private.v2_mandate_instant((fixture_day + fixture.slot_start) at time zone 'UTC'))
    where label = fixture.label;
  end loop;
  perform pg_sleep(greatest(0, extract(epoch from permission_start - clock_timestamp() + interval '20 milliseconds')));

  for fixture in select * from summary_retention_fixture loop
    update summary_retention_fixture set response = pg_temp.summary_retention_prepare(fixture.label)
    where label = fixture.label;
    if fixture.kind <> 'standing' then
      update summary_retention_fixture set review_digest = pg_temp.summary_retention_get_review(fixture.label)->>'summaryDigest'
      where label = fixture.label;
    end if;
    if fixture.kind = 'replacement' then
      update summary_retention_fixture set response = pg_temp.summary_retention_approve(fixture.label)
      where label = fixture.label;
    end if;
  end loop;
  update summary_retention_fixture set receipt = pg_temp.summary_retention_commit('committed') where label = 'committed';

  -- Move fixture deadlines only, preserving their ordering relative to issue
  -- times. They expire during this transaction, so a transaction clock fails.
  tied_expiry := clock_timestamp() + interval '30 milliseconds';
  update private.v2_delegated_preparations p
    set expires_at = tied_expiry - case when f.label = 'standing-old' then interval '10 milliseconds' else interval '0' end
    from summary_retention_fixture f
    where p.preparation_id = pg_temp.summary_retention_id(f.label || '-prep') and f.expires;
  update private.v2_step_up_requests r set expires_at = tied_expiry
    from summary_retention_fixture f
    where r.review_id = pg_temp.summary_retention_id(f.label || '-review')
      and f.label in ('request-old', 'replacement-live');
  update private.v2_step_up_preparations p set expires_at = tied_expiry
    where p.preparation_id = pg_temp.summary_retention_id('replacement-old-prep');
  update private.v2_step_up_grants g set expires_at = tied_expiry
    where g.grant_id = pg_temp.summary_retention_id('replacement-old-grant');
  perform pg_sleep(greatest(0, extract(epoch from tied_expiry - clock_timestamp() + interval '20 milliseconds')));
end;
$$;

create temporary view summary_retention_rows as
select f.label, p.state, p.summary, p.expires_at, p.invalidated_at, p.invalidated_sequence, to_jsonb(p) as row_data
  from summary_retention_fixture f join private.v2_delegated_preparations p
    on p.preparation_id = pg_temp.summary_retention_id(f.label || '-prep')
union all
select case when f.kind = 'replacement' then f.label || '-source' else f.label end,
    r.state, r.summary, r.expires_at, r.invalidated_at, r.invalidated_sequence, to_jsonb(r)
  from summary_retention_fixture f join private.v2_step_up_requests r
    on r.review_id = pg_temp.summary_retention_id(f.label || '-review')
union all
select f.label, p.state, p.summary, p.expires_at, p.invalidated_at, p.invalidated_sequence, to_jsonb(p)
  from summary_retention_fixture f join private.v2_step_up_preparations p
    on p.preparation_id = pg_temp.summary_retention_id(f.label || '-prep');

create temporary table summary_before on commit drop as select * from summary_retention_rows;
create temporary table summary_grants_before on commit drop as
select * from private.v2_step_up_grants where instance_id = pg_temp.summary_retention_id('instance');
create temporary table summary_mandates_before on commit drop as
select * from private.v2_mandates where instance_id = pg_temp.summary_retention_id('instance');
create temporary table summary_receipts_before on commit drop as
select * from private.v2_booking_receipts where instance_id = pg_temp.summary_retention_id('instance');
create temporary table summary_bookings_before on commit drop as
select b.* from public.bookings b join summary_receipts_before r on r.booking_id = b.id;
create temporary table summary_events_before on commit drop as
select * from private.v2_authority_events where instance_id = pg_temp.summary_retention_id('instance');

select is((select count(*)::integer from summary_before where state = 'pending' and summary is not null),
  9, 'fixture includes pending summaries from all three private paths');
select ok((select state = 'approved' and expires_at < clock_timestamp()
  from summary_before where label = 'replacement-live-source'),
  'fixture includes an approved source whose original deadline passed while its replacement is live');
select throws_ok($$select pg_temp.summary_retention_prepare('standing-old')$$,
  'PT409', 'VERSION_CONFLICT', 'standing expiry denies an exact prepare retry before cleanup');
select throws_ok($$select pg_temp.summary_retention_commit('standing-old')$$,
  'PT409', 'PREPARATION_STALE', 'standing expiry denies first commit before cleanup');
select throws_ok($$select pg_temp.summary_retention_get_review('request-old')$$,
  'PT409', 'VERSION_CONFLICT', 'pending review expiry denies issuer read before cleanup');
select throws_ok($$select pg_temp.summary_retention_approve('request-old')$$,
  'PT409', 'VERSION_CONFLICT', 'pending review expiry denies approval before cleanup');
select throws_ok($$select pg_temp.summary_retention_approve('replacement-old')$$,
  'PT409', 'VERSION_CONFLICT', 'replacement expiry denies an exact approval retry before cleanup');
select throws_ok($$select pg_temp.summary_retention_commit('replacement-old')$$,
  'PT409', 'PREPARATION_STALE', 'replacement expiry denies first commit before cleanup');

create function pg_temp.reject_summary_cleanup_event() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.instance_id = pg_temp.summary_retention_id('instance')
    and new.action = 'expired_delegated_summaries_redacted'
  then
    raise exception 'synthetic summary cleanup audit failure';
  end if;
  return new;
end;
$$;
create trigger reject_summary_cleanup_event before insert on private.v2_authority_events
for each row execute function pg_temp.reject_summary_cleanup_event();
select throws_ok($$select pg_temp.summary_redact('issuer-a', 100)$$,
  'P0001', 'synthetic summary cleanup audit failure', 'cleanup fails when its audit write fails');
select is((select count(*)::integer from summary_retention_rows r join summary_before b using (label)
  where r.row_data = b.row_data), 12, 'failed cleanup rolls back all three summary kinds');
select is((select event_sequence from private.v2_authority_principals
  where (instance_id, epoch, principal_id) = (pg_temp.summary_retention_id('instance'), 1,
    pg_temp.summary_retention_id('issuer-a'))),
  (select max(sequence) from summary_events_before where principal_id = pg_temp.summary_retention_id('issuer-a')),
  'failed cleanup rolls back the audit sequence');
drop trigger reject_summary_cleanup_event on private.v2_authority_events;

select is(pg_temp.summary_redact('issuer-a', 2), 2, 'the shared batch limit counts only two rows');
select is((select array_agg(r.label order by r.label)
  from summary_retention_rows r join summary_before b using (label)
  where r.state = 'invalidated' and b.state = 'pending'),
  (select array_agg(label order by label) from (
    values ('standing-old'), ((select label from summary_retention_fixture
      where label in ('standing-a', 'standing-b') order by pg_temp.summary_retention_id(label || '-prep') limit 1))
  ) ordered(label)), 'oldest expiry then smallest standing preparation ID are selected first');
select is(pg_temp.summary_redact('issuer-a', 2), 2, 'a batch of two spans the standing and request tables');
select is((select array_agg(r.label order by r.label)
  from summary_retention_rows r join summary_before b using (label)
  where r.state = 'invalidated' and b.state = 'pending'),
  array['request-old', 'standing-a', 'standing-b', 'standing-old'],
  'standing preparations and pending reviews precede the replacement at the same expiry');
select is(pg_temp.summary_redact('issuer-a', 100), 1, 'the next batch redacts the last expired replacement');
select is(pg_temp.summary_redact('issuer-a', 100), 0, 'repeating cleanup is an idempotent no-op');

select is((select count(*)::integer from summary_retention_rows r join summary_before b using (label)
  join summary_retention_fixture f using (label)
  where f.expires and f.issuer = 'issuer-a' and r.state = 'invalidated' and r.summary is null
    and (r.row_data - array['state', 'summary', 'invalidated_at', 'invalidated_sequence'])
      = (b.row_data - array['state', 'summary', 'invalidated_at', 'invalidated_sequence'])), 5,
  'all selected summaries are cleared and their exact bindings and rate history survive');
select is((select count(*)::integer from summary_retention_rows r join summary_before b using (label)
  where r.row_data = b.row_data), 7, 'live, foreign, committed and approved-source rows are untouched');
select is((select count(*)::integer from summary_retention_rows r join summary_before b using (label)
  join private.v2_authority_events e on e.instance_id = pg_temp.summary_retention_id('instance')
    and e.epoch = 1 and e.principal_id = pg_temp.summary_retention_id('issuer-a')
    and e.sequence = r.invalidated_sequence
  where r.state = 'invalidated' and b.state = 'pending' and e.action = 'expired_delegated_summaries_redacted'
    and e.occurred_at = r.invalidated_at and e.occurred_at >= r.expires_at
    and e.occurred_at > transaction_timestamp()), 5,
  'redacted rows link to minimal issuer audit stamped after their deadlines using a fresh clock');
select is((select count(*)::integer from private.v2_authority_events
  where instance_id = pg_temp.summary_retention_id('instance') and action = 'expired_delegated_summaries_redacted'), 3,
  'only nonempty batches produce one audit entry each');
select is((select count(*)::integer from summary_events_before old join private.v2_authority_events e
  using (instance_id, epoch, principal_id, sequence) where to_jsonb(old) = to_jsonb(e)),
  (select count(*)::integer from summary_events_before), 'prior audit remains intact');
select is((select count(*)::integer from summary_grants_before old join private.v2_step_up_grants g using (grant_id)
  where to_jsonb(old) = to_jsonb(g)), 2, 'cleanup preserves the original replacement grants');
select is((select count(*)::integer from summary_mandates_before old join private.v2_mandates m using (mandate_id)
  where to_jsonb(old) = to_jsonb(m)), 10, 'cleanup preserves every mandate and usage fence');
select is((select count(*)::integer from summary_receipts_before old join private.v2_booking_receipts r using (receipt_id)
  where to_jsonb(old) = to_jsonb(r)), 1, 'cleanup preserves the full committed receipt');
select is((select count(*)::integer from summary_bookings_before old join public.bookings b using (id)
  where to_jsonb(old) = to_jsonb(b)), 1, 'cleanup preserves the existing booking');
select is(pg_temp.summary_retention_commit('committed'),
  (select receipt from summary_retention_fixture where label = 'committed'),
  'the original actor can retry the existing booking and receive the exact receipt');

select is(pg_temp.summary_retention_prepare('standing-live'),
  (select response from summary_retention_fixture where label = 'standing-live'),
  'a live standing preparation still reconciles');
select is(pg_temp.summary_retention_get_review('request-live')->>'summaryDigest',
  (select review_digest from summary_retention_fixture where label = 'request-live'),
  'a live pending review is still readable by its issuer');
select is(pg_temp.summary_retention_approve('replacement-live'),
  (select response from summary_retention_fixture where label = 'replacement-live'),
  'a live replacement still reconciles after its source review deadline');
update summary_retention_fixture set receipt = pg_temp.summary_retention_commit('replacement-live')
where label = 'replacement-live';
select is((select r.provider from private.v2_booking_receipts r join summary_retention_fixture f
  on r.receipt_id = (f.receipt->>'receiptId')::uuid where f.label = 'replacement-live'), 'principal_step_up',
  'the live replacement still commits with its original reviewed facts');

-- Move only fixture deadlines back to the future. Redaction state must still
-- prevent reusing the old exact intents even if a clock rollback makes them look live.
update private.v2_delegated_preparations set expires_at = expires_at + interval '1 minute'
where preparation_id = pg_temp.summary_retention_id('standing-old-prep');
update private.v2_step_up_requests set expires_at = expires_at + interval '1 minute'
where review_id = pg_temp.summary_retention_id('request-old-review');
update private.v2_step_up_preparations set expires_at = expires_at + interval '1 minute'
where preparation_id = pg_temp.summary_retention_id('replacement-old-prep');
update private.v2_step_up_grants set expires_at = expires_at + interval '1 minute'
where grant_id = pg_temp.summary_retention_id('replacement-old-grant');

select throws_ok($$select pg_temp.summary_retention_prepare('standing-old')$$,
  'PT409', 'VERSION_CONFLICT', 'redacted standing ID cannot recreate its old preparation');
select throws_ok($$select pg_temp.summary_retention_commit('standing-old')$$,
  'PT409', 'PREPARATION_STALE', 'redacted standing preparation remains uncommittable after simulated clock rewind');
select throws_ok($$select pg_temp.summary_retention_prepare('request-old')$$,
  'PT409', 'VERSION_CONFLICT', 'redacted step-up request ID cannot recreate its old review');
select throws_ok($$select pg_temp.summary_retention_get_review('request-old')$$,
  'PT409', 'VERSION_CONFLICT', 'redacted pending review is unreadable after simulated clock rewind');
select throws_ok($$select pg_temp.summary_retention_approve('request-old')$$,
  'PT409', 'VERSION_CONFLICT', 'redacted pending review cannot be approved with its original digest');
select throws_ok($$select pg_temp.summary_retention_approve('replacement-old')$$,
  'PT409', 'VERSION_CONFLICT', 'redacted replacement cannot be recreated by an exact approval retry');
select throws_ok($$select pg_temp.summary_retention_commit('replacement-old')$$,
  'PT409', 'PREPARATION_STALE', 'redacted replacement remains uncommittable after simulated clock rewind');

update private.v2_authority_principals set disabled = true
where (instance_id, epoch, principal_id) = (pg_temp.summary_retention_id('instance'), 1, pg_temp.summary_retention_id('issuer-b'));
delete from auth.users where id = pg_temp.summary_retention_id('issuer-b');
select is(pg_temp.summary_redact('issuer-b', 1), 1, 'retention still works after issuer deletion');
select is((select state from summary_retention_rows where label = 'foreign'), 'invalidated',
  'the deleted issuer retains a redacted tombstone');

select * from finish();
rollback;
