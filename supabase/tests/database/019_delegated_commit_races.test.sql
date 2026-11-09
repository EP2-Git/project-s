create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions, pg_catalog;
select no_plan();

-- The two dblink sessions must see committed synthetic fixtures. Keep fixture
-- creation and cleanup scoped to this suite's own instance and Auth accounts.
drop schema if exists project_s_delegated_races cascade;
create schema project_s_delegated_races;

create function project_s_delegated_races.id(p_label text) returns uuid
language sql immutable strict set search_path = pg_catalog as $$
  select overlay(overlay(md5('project-s:delegated-race:' || p_label)
    placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid;
$$;

create function project_s_delegated_races.clean_fixture() returns void
language plpgsql set search_path = pg_catalog as $$
declare
  fixture_instance uuid := project_s_delegated_races.id('instance');
  fixture_host uuid := project_s_delegated_races.id('host');
begin
  -- Keep the v1 audit append-only. Its synthetic events are discarded with the
  -- disposable database, and assertions use each run's new preparation IDs.
  delete from private.booking_confirmation_grants where preparation_id in (
    select id from private.booking_preparations where owner_id = fixture_host
  );
  delete from public.bookings where user_id = fixture_host;
  delete from private.booking_preparations where owner_id = fixture_host;
  delete from private.v2_booking_receipts where instance_id = fixture_instance;
  delete from private.v2_booking_epoch_keys where instance_id = fixture_instance;
  delete from private.v2_step_up_preparations where instance_id = fixture_instance;
  delete from private.v2_step_up_grants where instance_id = fixture_instance;
  delete from private.v2_delegated_preparations where instance_id = fixture_instance;
  delete from private.v2_step_up_requests where instance_id = fixture_instance;
  delete from private.v2_mandates where instance_id = fixture_instance;
  delete from private.v2_mandate_reviews where instance_id = fixture_instance;
  delete from private.v2_actor_credentials where instance_id = fixture_instance;
  delete from private.v2_booker_profiles where instance_id = fixture_instance;
  delete from private.v2_authority_events where instance_id = fixture_instance;
  delete from private.v2_authority_principals where instance_id = fixture_instance;
  delete from private.v2_authority_instance where instance_id = fixture_instance;
  delete from auth.users where id in (fixture_host, project_s_delegated_races.id('issuer'));
end;
$$;
select project_s_delegated_races.clean_fixture();

create table project_s_delegated_races.cases (
  label text primary key,
  provider text not null,
  slot_start timestamptz not null,
  mandate_id uuid not null,
  preparation_id uuid not null,
  review_id uuid,
  legacy_token text
);

create function project_s_delegated_races.issuer() returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_build_object(
    'contractVersion',2,'requestId','synthetic-delegated-race',
    'instanceId',project_s_delegated_races.id('instance'),'epoch',1,
    'principalId',project_s_delegated_races.id('issuer'),'subjectId',project_s_delegated_races.id('issuer'),
    'verifiedAt',private.v2_mandate_instant(clock_timestamp()),'transport','ui');
$$;

create function project_s_delegated_races.actor() returns jsonb
language sql set search_path = pg_catalog as $$
  select project_s_delegated_races.issuer() || jsonb_build_object(
    'transport','http','actorId',project_s_delegated_races.id('actor'),
    'credentialId',project_s_delegated_races.id('credential'),
    'credentialRevision',1,'credentialFingerprint',repeat('a',64));
$$;

create function project_s_delegated_races.v1_context(p_kind text,p_grant jsonb default null) returns jsonb
language sql set search_path = pg_catalog as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'requestId','synthetic-mixed-commit-race','actorKind',p_kind,
    'transport',case when p_kind='human' then 'ui' else 'http' end,
    'clientId',case when p_kind='human' then 'project-s-confirmation-ui' else 'mixed-race-client' end,
    'scopes',case when p_kind='human' then '["bookings:create"]'::jsonb
      else '["bookings:prepare","bookings:create"]'::jsonb end,
    'provenance',jsonb_build_object('source',case when p_kind='human' then 'project_s_ui' else 'project_s_sdk' end,
      'clientVersion','0.1.0','networkKeyHash',repeat('e',64)),
    'confirmationGrant',p_grant));
$$;

-- Use the actual service RPCs and preserve the refusal SQLSTATE/message across
-- dblink, where exceptions otherwise become connection-level errors.
create function project_s_delegated_races.capture(p_operation text,p_label text,p_key uuid default null)
returns jsonb language plpgsql set search_path = pg_catalog as $$
declare
  fixture project_s_delegated_races.cases%rowtype;
  response jsonb;
begin
  select * into strict fixture from project_s_delegated_races.cases where label = p_label;
  case p_operation
    when 'v1' then
      response := public.commit_prepared_booking_v1(jsonb_build_object(
        'preparationToken',fixture.legacy_token,'idempotencyKey',project_s_delegated_races.id('v1-key-' || p_label)),
        project_s_delegated_races.v1_context('anonymous'));
    when 'v2' then
      response := public.project_s_commit_delegated_booking_v2(
        project_s_delegated_races.actor(),fixture.preparation_id,
        coalesce(p_key,project_s_delegated_races.id('v2-key-' || p_label)));
    when 'revoke' then
      response := case when fixture.review_id is null then public.project_s_revoke_mandate_v2(
        project_s_delegated_races.issuer(),fixture.mandate_id,1)
        else public.project_s_revoke_step_up_v2(project_s_delegated_races.issuer(),fixture.review_id,2) end;
    when 'read' then
      response := public.project_s_read_delegated_booking_receipt_v2(project_s_delegated_races.actor(),(
        select receipt_id from private.v2_booking_receipts
        where instance_id = project_s_delegated_races.id('instance') and mandate_id = fixture.mandate_id));
    else raise exception 'Unknown delegated race operation: %', p_operation;
  end case;
  return jsonb_build_object('ok',true,'response',response);
exception when others then
  return jsonb_build_object('ok',false,'code',sqlstate,'message',sqlerrm);
end;
$$;

insert into private.v2_authority_instance(instance_id,epoch,audience)
values (project_s_delegated_races.id('instance'),1,'http://127.0.0.1:54321');
insert into private.v2_booking_epoch_keys(instance_id,epoch)
values (project_s_delegated_races.id('instance'),1);
insert into auth.users(instance_id,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token,is_anonymous)
select '00000000-0000-0000-0000-000000000000',project_s_delegated_races.id(label),'authenticated','authenticated',
  username || '@example.invalid',clock_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('username',username,'full_name','Synthetic Delegated Race Account','timezone','UTC'),
  clock_timestamp(),clock_timestamp(),'','','','',false
from (values ('issuer','synthetic-race-issuer'),('host','synthetic-race-host')) users(label,username);
insert into public.meeting_types(id,user_id,title,duration_minutes,slot_interval_minutes,
  buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,active)
values (project_s_delegated_races.id('meeting'),project_s_delegated_races.id('host'),
  'Synthetic Delegated Race Meeting',30,15,0,0,0,true);

select public.project_s_register_actor_v2(project_s_delegated_races.issuer(),
  project_s_delegated_races.id('actor'),project_s_delegated_races.id('credential'),
  decode(repeat('a',64),'hex'),'Synthetic delegated race actor',clock_timestamp()+interval '2 days');
select public.project_s_create_booker_profile_v2(project_s_delegated_races.issuer(),
  project_s_delegated_races.id('profile'),
  '{"name":"Synthetic Race Booker","email":"synthetic-race-booker@example.invalid","guestTimeZone":"UTC"}');

do $$
declare
  fixture_day date := (clock_timestamp() at time zone 'UTC')::date + 3;
  day_start timestamptz := fixture_day::timestamp at time zone 'UTC';
  permission_start timestamptz;
  fixture record;
  policy jsonb;
  issuer_review jsonb;
  preparation jsonb;
  step_up_review jsonb;
  step_up_id uuid;
  token text;
begin
  insert into public.specific_date_availabilities(user_id,date,status,start_time,end_time)
  values (project_s_delegated_races.id('host'),fixture_day,'available','08:00','18:00');
  insert into project_s_delegated_races.cases(label,provider,slot_start,mandate_id,preparation_id)
  select label,case when label like 'standing-%' then 'local_mandate' else 'principal_step_up' end,
    day_start + slot_offset,project_s_delegated_races.id('mandate-' || label),
    project_s_delegated_races.id('preparation-' || label)
  from (values
    ('standing-v1-first',interval '9 hours'),('step-up-v1-first',interval '10 hours'),
    ('standing-v2-first',interval '11 hours'),('step-up-v2-first',interval '12 hours'),
    ('standing-revoke-first',interval '13 hours'),('standing-commit-first',interval '14 hours'),
    ('step-up-revoke-first',interval '15 hours'),('step-up-commit-first',interval '16 hours')
  ) fixtures(label,slot_offset);

  permission_start := clock_timestamp()+interval '5 seconds';
  for fixture in select * from project_s_delegated_races.cases loop
    policy := jsonb_build_object(
      'actorId',project_s_delegated_races.id('actor'),'profileId',project_s_delegated_races.id('profile'),
      'profileRevision',1,'username','synthetic-race-host','meetingTypeId',project_s_delegated_races.id('meeting'),
      'meetingWindowStart',private.v2_mandate_instant(day_start+interval '8 hours'),
      'meetingWindowEnd',private.v2_mandate_instant(day_start+
        case when fixture.provider='local_mandate' then interval '18 hours' else interval '8 hours 45 minutes' end),
      'maxDurationMinutes',30,'notBefore',private.v2_mandate_instant(permission_start),
      'expiresAt',private.v2_mandate_instant(permission_start+interval '1 hour'));
    issuer_review := public.project_s_create_mandate_review_v2(project_s_delegated_races.issuer(),
      project_s_delegated_races.id('mandate-review-' || fixture.label),policy);
    perform public.project_s_approve_mandate_v2(project_s_delegated_races.issuer(),
      (issuer_review->>'reviewId')::uuid,fixture.mandate_id,1,issuer_review->>'summaryDigest');
  end loop;
  perform pg_sleep(greatest(0,extract(epoch from (permission_start-clock_timestamp()+interval '20 milliseconds')))::double precision);

  for fixture in select * from project_s_delegated_races.cases loop
    preparation := public.project_s_prepare_delegated_booking_v2(project_s_delegated_races.actor(),
      fixture.preparation_id,project_s_delegated_races.id('step-up-review-' || fixture.label),jsonb_build_object(
        'mandateId',fixture.mandate_id,'username','synthetic-race-host',
        'meetingTypeId',project_s_delegated_races.id('meeting'),'startAt',private.v2_mandate_instant(fixture.slot_start)));
    if fixture.provider='principal_step_up' then
      step_up_id := (preparation#>>'{stepUp,reviewId}')::uuid;
      step_up_review := public.project_s_get_step_up_review_v2(project_s_delegated_races.issuer(),step_up_id);
      perform public.project_s_approve_step_up_v2(project_s_delegated_races.issuer(),step_up_id,fixture.preparation_id,
        project_s_delegated_races.id('step-up-grant-' || fixture.label),1,step_up_review->>'summaryDigest');
      update project_s_delegated_races.cases set review_id=step_up_id where label=fixture.label;
    elsif (preparation#>>'{data,preparationId}')::uuid is distinct from fixture.preparation_id then
      raise exception 'Standing fixture preparation missing: %', fixture.label;
    end if;

    if fixture.label like '%-v1-first' or fixture.label like '%-v2-first' then
      preparation := public.prepare_public_booking_v1(jsonb_build_object(
        'username','synthetic-race-host','meetingTypeId',project_s_delegated_races.id('meeting'),
        'startAt',private.v2_mandate_instant(fixture.slot_start),'guestTimeZone','UTC',
        'booker',jsonb_build_object('name','Synthetic Legacy Race Booker','email','synthetic-legacy-race@example.invalid')),
        project_s_delegated_races.v1_context('anonymous'));
      token := preparation->>'preparationToken';
      perform public.confirm_public_booking_preparation_v1(jsonb_build_object('preparationToken',token),
        project_s_delegated_races.v1_context('human',jsonb_build_object(
          'grantId',project_s_delegated_races.id('legacy-grant-' || fixture.label),
          'confirmedAt',private.v2_mandate_instant(clock_timestamp()),'method','human_browser')));
      update project_s_delegated_races.cases set legacy_token=token where label=fixture.label;
    end if;
  end loop;
end;
$$;

select is(dblink_connect('race_holder',format('host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
  current_database())),'OK','independent race holder connects');
select is(dblink_connect('race_waiter',format('host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
  current_database())),'OK','independent race waiter connects');
select dblink_exec('race_holder','set statement_timeout = 8000');
select dblink_exec('race_waiter','set statement_timeout = 8000');

create temporary table delegated_race_sessions (name text primary key,pid integer not null);
insert into delegated_race_sessions
select name,pid from (values ('race_holder'),('race_waiter')) as connections(name)
cross join lateral dblink(name,'select pg_backend_pid()') as backend(pid integer);
select is((select count(distinct pid)::integer from delegated_race_sessions where pid<>pg_backend_pid()),
  2,'the holder and waiter are two separate PostgreSQL backends');

create function pg_temp.wait_for_blocker(p_locktype text default null) returns boolean
language plpgsql set search_path = pg_catalog as $$
declare
  holder_pid integer := (select pid from pg_temp.delegated_race_sessions where name='race_holder');
  waiter_pid integer := (select pid from pg_temp.delegated_race_sessions where name='race_waiter');
  deadline timestamptz := clock_timestamp()+interval '500 milliseconds';
begin
  loop
    if holder_pid = any(pg_blocking_pids(waiter_pid)) and (p_locktype is null or exists (
      select 1 from pg_locks where pid=waiter_pid and locktype=p_locktype and not granted
    )) then return true; end if;
    if clock_timestamp()>=deadline then return false; end if;
    perform pg_sleep(0.005);
  end loop;
end;
$$;

create function pg_temp.finishes_without_owner_wait() returns boolean
language plpgsql set search_path = pg_catalog as $$
declare
  holder_pid integer := (select pid from pg_temp.delegated_race_sessions where name='race_holder');
  waiter_pid integer := (select pid from pg_temp.delegated_race_sessions where name='race_waiter');
  deadline timestamptz := clock_timestamp()+interval '750 milliseconds';
begin
  loop
    if holder_pid = any(pg_blocking_pids(waiter_pid)) then return false; end if;
    if extensions.dblink_is_busy('race_waiter')=0 then return true; end if;
    if clock_timestamp()>=deadline then return false; end if;
    perform pg_sleep(0.005);
  end loop;
end;
$$;

create function pg_temp.run_mixed_race(p_label text,p_first text,p_second text) returns setof text
language plpgsql set search_path = pg_catalog,extensions,public as $$
declare
  winner jsonb;
  loser jsonb;
  sequence_before bigint;
  owner_key bigint := hashtextextended(project_s_delegated_races.id('host')::text,0);
begin
  select event_sequence into strict sequence_before from private.v2_authority_principals
  where instance_id = project_s_delegated_races.id('instance') and principal_id = project_s_delegated_races.id('issuer');
  return next is(dblink_exec('race_holder','begin'),'BEGIN',p_label || ' winning transaction begins');
  select value into strict winner from dblink('race_holder',
    format('select project_s_delegated_races.capture(%L,%L)',p_first,p_label)) as remote(value jsonb);
  return next is(coalesce(winner#>>'{response,booking,status}',winner#>>'{response,status}'),
    'confirmed',p_label || ' real winner confirms the booking inside its open transaction');
  return next ok(exists(select 1 from pg_locks
    where pid=(select pid from pg_temp.delegated_race_sessions where name='race_holder')
      and locktype='advisory' and granted and mode='ExclusiveLock' and objsubid=1
      and classid::bigint=((owner_key >> 32) & 4294967295) and objid::bigint=(owner_key & 4294967295)),
    p_label || ' the winner owns the exact shared scheduling lock');
  return next is((select count(*)::integer from public.bookings
    where user_id=project_s_delegated_races.id('host')
      and start_time=(select slot_start from project_s_delegated_races.cases where label=p_label)),
    0,p_label || ' the winning booking is still invisible to the coordinator');

  return next is(dblink_send_query('race_waiter',
    format('select project_s_delegated_races.capture(%L,%L)',p_second,p_label)),1,
    p_label || ' independent contender starts before the winner commits');
  if p_first='v1' then
    return next ok(pg_temp.finishes_without_owner_wait(),p_label || ' delegated contender does not wait for the legacy owner');
    select value into strict loser from dblink_get_result('race_waiter') as remote(value jsonb);
    perform * from dblink_get_result('race_waiter') as remote(value jsonb);
    return next is(loser,'{"ok":false,"code":"PT503","message":"AUTHORITY_BUSY"}'::jsonb,
      p_label || ' contended delegated first write returns the bounded busy refusal');
    return next is((select event_sequence from private.v2_authority_principals
      where instance_id = project_s_delegated_races.id('instance') and principal_id = project_s_delegated_races.id('issuer')),
      sequence_before,p_label || ' busy refusal adds no authority event while the winner is uncommitted');
    return next is(dblink_exec('race_holder','commit'),'COMMIT',p_label || ' legacy winner commits');
    select value into strict loser from dblink('race_waiter',
      format('select project_s_delegated_races.capture(%L,%L)',p_second,p_label)) as remote(value jsonb);
  else
    return next ok(pg_temp.wait_for_blocker('advisory'),p_label || ' legacy contender waits on the actual delegated owner lock');
    return next is(dblink_exec('race_holder','commit'),'COMMIT',p_label || ' delegated winner commits');
    select value into strict loser from dblink_get_result('race_waiter') as remote(value jsonb);
    perform * from dblink_get_result('race_waiter') as remote(value jsonb);
  end if;
  return next is(loser,'{"ok":false,"code":"PT409","message":"SLOT_UNAVAILABLE"}'::jsonb,
    p_label || ' contender sees the durable slot conflict');
  return next is(project_s_delegated_races.capture(p_first,p_label),winner,
    p_label || ' exact winner replay creates no additional booking');
  return next is((select event_sequence from private.v2_authority_principals
    where instance_id = project_s_delegated_races.id('instance') and principal_id = project_s_delegated_races.id('issuer')),
    sequence_before + case when p_first='v2' then 1 else 0 end,
    p_label || ' only a delegated winner advances the issuer event sequence');
end;
$$;

select * from pg_temp.run_mixed_race('standing-v1-first','v1','v2');
select * from pg_temp.run_mixed_race('step-up-v1-first','v1','v2');
select * from pg_temp.run_mixed_race('standing-v2-first','v2','v1');
select * from pg_temp.run_mixed_race('step-up-v2-first','v2','v1');

select is((select count(*)::integer from public.bookings b
  where b.user_id=project_s_delegated_races.id('host') and b.start_time=c.slot_start and b.status='confirmed'),
  1,c.label || ' leaves exactly one durable confirmed booking')
from project_s_delegated_races.cases c where c.legacy_token is not null order by c.label;

select ok((select (g.consumed_at is not null) = (c.label like '%-v1-first')
    and p.state = case when c.label like '%-v1-first' then 'committed' else 'confirmed' end
  from private.booking_confirmation_grants g join private.booking_preparations p on p.id=g.preparation_id
  where g.id=project_s_delegated_races.id('legacy-grant-' || c.label)),
  c.label || ' only a legacy winner consumes its confirmation grant')
from project_s_delegated_races.cases c where c.legacy_token is not null order by c.label;

select is((select count(*)::integer from private.booking_audit_events a
  join private.booking_confirmation_grants g
    on (g.id,g.preparation_id)=(a.confirmation_grant_id,a.preparation_id)
  where a.request_id='synthetic-mixed-commit-race' and a.outcome='committed'
    and g.id=project_s_delegated_races.id('legacy-grant-' || c.label)),
  case when c.label like '%-v1-first' then 1 else 0 end,
  c.label || ' only a legacy winner writes one legacy commit audit event')
from project_s_delegated_races.cases c where c.legacy_token is not null order by c.label;

select is((select count(*)::integer from private.v2_booking_receipts r
  join public.bookings b on b.id=r.booking_id
  join private.v2_authority_events e on (e.instance_id,e.epoch,e.principal_id,e.sequence)=
    (r.instance_id,r.epoch,r.principal_id,r.committed_sequence)
  where r.instance_id=project_s_delegated_races.id('instance') and r.mandate_id=c.mandate_id
    and r.provider=c.provider and b.start_time=c.slot_start and e.action='booking_committed'),
  case when c.label like '%-v2-first' then 1 else 0 end,
  c.label || ' only a delegated winner consumes the mandate and creates a receipt linked to its success event')
from project_s_delegated_races.cases c where c.legacy_token is not null order by c.label;

select is((select p.state from private.v2_delegated_preparations p
    where p.instance_id=project_s_delegated_races.id('instance') and p.preparation_id=c.preparation_id
  union all select p.state from private.v2_step_up_preparations p
    where p.instance_id=project_s_delegated_races.id('instance') and p.preparation_id=c.preparation_id),
  case when c.label like '%-v2-first' then 'invalidated' else 'pending' end,
  c.label || ' only a delegated winner spends its preparation')
from project_s_delegated_races.cases c where c.legacy_token is not null order by c.label;

-- Hold the real first operation open, then observe the competing operation
-- waiting on its transaction before either result can become durable.
create temporary table revocation_race_results (
  label text primary key,
  held jsonb not null,
  contender jsonb not null,
  observed_blocker boolean not null
);

create temporary table revocation_event_baseline as
select
  count(*) filter (where action = 'booking_committed') as committed,
  count(*) filter (where action = 'mandate_revoked') as mandate_revoked,
  count(*) filter (where action = 'step_up_revoked') as step_up_revoked
from private.v2_authority_events
where instance_id = project_s_delegated_races.id('instance')
  and principal_id = project_s_delegated_races.id('issuer')
  and epoch = 1;

create function pg_temp.run_revocation_race(p_label text, p_first text, p_second text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_held jsonb;
  v_contender jsonb;
  v_blocked boolean;
begin
  perform extensions.dblink_exec('race_holder', 'begin');
  select r.value into strict v_held
  from extensions.dblink('race_holder', format(
    'select project_s_delegated_races.capture(%L, %L)', p_first, p_label
  )) as r(value jsonb);

  if extensions.dblink_send_query('race_waiter', format(
    'select project_s_delegated_races.capture(%L, %L)', p_second, p_label
  )) <> 1 then
    perform extensions.dblink_exec('race_holder', 'rollback');
    raise exception 'Unable to start revocation race contender';
  end if;
  v_blocked := pg_temp.wait_for_blocker('transactionid');
  perform extensions.dblink_exec('race_holder', 'commit');

  select r.value into strict v_contender
  from extensions.dblink_get_result('race_waiter') as r(value jsonb);
  -- The extra result read clears the asynchronous query before connection reuse.
  perform 1 from extensions.dblink_get_result('race_waiter') as r(value jsonb);
  insert into pg_temp.revocation_race_results values (p_label, v_held, v_contender, v_blocked);
end;
$$;

select pg_temp.run_revocation_race('standing-revoke-first', 'revoke', 'v2');
select pg_temp.run_revocation_race('standing-commit-first', 'v2', 'revoke');
select pg_temp.run_revocation_race('step-up-revoke-first', 'revoke', 'v2');
select pg_temp.run_revocation_race('step-up-commit-first', 'v2', 'revoke');

select ok(observed_blocker, label || ' contender waits on the exact holder transaction at the principal fence')
from revocation_race_results order by label;

select is(held #>> '{response,state}', 'revoked', label || ' issuer revocation wins')
from revocation_race_results where label like '%-revoke-first' order by label;
select is(contender, '{"ok":false,"code":"PT403","message":"FORBIDDEN"}'::jsonb,
  label || ' waiting commit sees the revocation and is refused')
from revocation_race_results where label like '%-revoke-first' order by label;
select is(
  project_s_delegated_races.capture('v2', label),
  contender,
  label || ' retry still cannot spend the revoked permission'
)
from revocation_race_results where label like '%-revoke-first' order by label;

select is(held #>> '{response,booking,status}', 'confirmed', label || ' delegated commit wins')
from revocation_race_results where label like '%-commit-first' order by label;
select is(contender #>> '{response,state}', 'revoked', label || ' the waiting issuer then revokes')
from revocation_race_results where label like '%-commit-first' order by label;
select is(
  project_s_delegated_races.capture('v2', label),
  held,
  label || ' the original active credential recovers the identical receipt after revocation'
)
from revocation_race_results where label like '%-commit-first' order by label;
select is(
  project_s_delegated_races.capture('read', label),
  held,
  label || ' the original caller can read the identical confirmed receipt after revocation'
)
from revocation_race_results where label like '%-commit-first' order by label;
select is(
  project_s_delegated_races.capture('v2', label, project_s_delegated_races.id('revocation-new-key-' || label)),
  '{"ok":false,"code":"PT403","message":"FORBIDDEN"}'::jsonb,
  label || ' a new key cannot spend the permission again'
)
from revocation_race_results where label like '%-commit-first' order by label;

select is(
  (select count(*) from public.bookings b
    where b.user_id = project_s_delegated_races.id('host') and b.start_time = c.slot_start),
  case when c.label like '%-commit-first' then 1::bigint else 0::bigint end,
  c.label || ' durable booking count follows the serialized order'
)
from project_s_delegated_races.cases c
join revocation_race_results result using (label)
order by c.label;

select is(
  (select count(*) from private.v2_booking_receipts r
    where r.instance_id = project_s_delegated_races.id('instance')
      and r.principal_id = project_s_delegated_races.id('issuer')
      and r.epoch = 1 and r.mandate_id = c.mandate_id),
  case when c.label like '%-commit-first' then 1::bigint else 0::bigint end,
  c.label || ' the one-use receipt fence exists only when booking wins'
)
from project_s_delegated_races.cases c
join revocation_race_results result using (label)
order by c.label;

select ok(
  (select r.committed_sequence <
      case when c.provider = 'local_mandate' then m.revoked_sequence else u.revoked_sequence end
    from private.v2_booking_receipts r
    join private.v2_mandates m using (instance_id, epoch, principal_id, mandate_id)
    left join private.v2_step_up_requests u on
      (u.instance_id,u.epoch,u.principal_id,u.review_id) = (r.instance_id,r.epoch,r.principal_id,c.review_id)
    where r.instance_id = project_s_delegated_races.id('instance')
      and r.principal_id = project_s_delegated_races.id('issuer')
      and r.epoch = 1 and r.mandate_id = c.mandate_id),
  c.label || ' the durable booking audit precedes the issuer revocation'
)
from project_s_delegated_races.cases c
join revocation_race_results result using (label)
where c.label like '%-commit-first'
order by c.label;

select is(
  array[
    count(*) filter (where e.action = 'booking_committed') - baseline.committed,
    count(*) filter (where e.action = 'mandate_revoked') - baseline.mandate_revoked,
    count(*) filter (where e.action = 'step_up_revoked') - baseline.step_up_revoked
  ],
  array[2::bigint, 2::bigint, 2::bigint],
  'revocation races record two successful bookings and four revocations, with no extra success events on replay or refusal'
)
from private.v2_authority_events e
cross join revocation_event_baseline baseline
where e.instance_id = project_s_delegated_races.id('instance')
  and e.principal_id = project_s_delegated_races.id('issuer')
  and e.epoch = 1
group by baseline.committed, baseline.mandate_revoked, baseline.step_up_revoked;

select is(dblink_disconnect('race_waiter'),'OK','independent race waiter disconnects');
select is(dblink_disconnect('race_holder'),'OK','independent race holder disconnects');
select project_s_delegated_races.clean_fixture();
drop schema project_s_delegated_races cascade;
select * from finish();
