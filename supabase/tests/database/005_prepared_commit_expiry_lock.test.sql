create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

set search_path = public, extensions, pg_catalog;
select no_plan();

delete from private.booking_confirmation_grants
where preparation_id in (
  select id
  from private.booking_preparations
  where owner_id = '99000000-0000-4000-8000-000000000001'
);
delete from public.bookings
where user_id = '99000000-0000-4000-8000-000000000001';
delete from private.booking_preparations
where owner_id = '99000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '99000000-0000-4000-8000-000000000001';
drop schema if exists project_s_prepared_expiry_lock cascade;

create schema project_s_prepared_expiry_lock;

create table project_s_prepared_expiry_lock.context (
  key text primary key,
  value jsonb not null
);

create table project_s_prepared_expiry_lock.results (
  client_name text primary key,
  result jsonb not null
);

create or replace function project_s_prepared_expiry_lock.gateway_context(
  p_client_id text,
  p_transport text,
  p_actor_kind text,
  p_source text,
  p_scopes jsonb,
  p_grant jsonb default null
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'requestId', 'expiry-lock-request-0001',
      'actorKind', p_actor_kind,
      'transport', p_transport,
      'clientId', p_client_id,
      'scopes', p_scopes,
      'provenance', jsonb_build_object(
        'source', p_source,
        'clientVersion', '0.1.0',
        'networkKeyHash', repeat('f', 64)
      ),
      'confirmationGrant', p_grant
    )
  );
$$;

create or replace function project_s_prepared_expiry_lock.capture_commit(
  p_token text,
  p_idempotency_key uuid,
  p_client_id text,
  p_transport text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_sqlstate text;
  v_message text;
begin
  return jsonb_build_object(
    'ok', true,
    'response', public.commit_prepared_booking_v1(
      jsonb_build_object(
        'preparationToken', p_token,
        'idempotencyKey', p_idempotency_key
      ),
      project_s_prepared_expiry_lock.gateway_context(
        p_client_id,
        p_transport,
        'anonymous',
        case
          when p_transport = 'stdio_mcp' then 'project_s_mcp'
          else 'project_s_sdk'
        end,
        '["bookings:create"]'::jsonb
      )
    )
  );
exception
  when others then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate,
      v_message = message_text;
    return jsonb_build_object(
      'ok', false,
      'sqlState', v_sqlstate,
      'message', v_message
    );
end;
$$;

create or replace function pg_temp.wait_for_advisory_state(
  p_pid integer,
  p_granted boolean,
  p_timeout_seconds double precision default 8
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_deadline timestamptz := pg_catalog.clock_timestamp()
    + (p_timeout_seconds * interval '1 second');
begin
  loop
    if exists (
      select 1
      from pg_catalog.pg_locks
      where pid = p_pid
        and locktype = 'advisory'
        and granted = p_granted
    ) then
      return true;
    end if;

    exit when pg_catalog.clock_timestamp() >= v_deadline;
    perform pg_catalog.pg_sleep(0.025);
  end loop;

  return false;
end;
$$;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values (
  '00000000-0000-0000-0000-000000000000',
  '99000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'prepared-expiry-owner@example.invalid',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"prepared-expiry","full_name":"Prepared Expiry Owner","timezone":"UTC"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
);

delete from public.availabilities
where user_id = '99000000-0000-4000-8000-000000000001';

insert into public.availabilities (
  user_id,
  weekday,
  start_time,
  end_time,
  buffer_minutes
)
select
  '99000000-0000-4000-8000-000000000001',
  weekday,
  time '08:00',
  time '18:00',
  0
from generate_series(0, 6) as weekday;

insert into public.meeting_types (
  id,
  user_id,
  title,
  duration_minutes,
  slot_interval_minutes,
  buffer_before_minutes,
  buffer_after_minutes,
  minimum_notice_minutes,
  maximum_advance_days,
  active
)
values (
  '99100000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'Prepared expiry call',
  30,
  15,
  0,
  0,
  0,
  365,
  true
);

insert into project_s_prepared_expiry_lock.context (key, value)
select
  client_name || '-slot-start',
  to_jsonb(
    to_char(
      current_date::timestamp
        + interval '9 days'
        + case when client_name = 'a'
          then interval '10 hours'
          else interval '11 hours'
        end,
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  )
from (values ('a'), ('b')) as client_row(client_name);

insert into project_s_prepared_expiry_lock.context (key, value)
select
  client_name || '-preparation',
  public.prepare_public_booking_v1(
    jsonb_build_object(
      'username', 'prepared-expiry',
      'meetingTypeId', '99100000-0000-4000-8000-000000000001',
      'startAt', (
        select value #>> '{}'
        from project_s_prepared_expiry_lock.context
        where key = client_name || '-slot-start'
      ),
      'guestTimeZone', 'UTC',
      'booker', jsonb_build_object(
        'name', 'Expiry ' || upper(client_name) || ' Guest',
        'email', 'prepared-expiry-' || client_name || '@example.invalid'
      )
    ),
    project_s_prepared_expiry_lock.gateway_context(
      'expiry-client-' || client_name,
      case when client_name = 'a' then 'http' else 'stdio_mcp' end,
      'anonymous',
      case when client_name = 'a' then 'project_s_sdk' else 'project_s_mcp' end,
      '["bookings:prepare","bookings:create"]'::jsonb
    )
  )
from (values ('a'), ('b')) as client_row(client_name);

insert into project_s_prepared_expiry_lock.context (key, value)
select
  client_name || '-grant',
  jsonb_build_object(
    'grantId', case
      when client_name = 'a'
        then '99200000-0000-4000-8000-000000000001'
      else '99200000-0000-4000-8000-000000000002'
    end,
    'confirmedAt', to_char(
      clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'method', 'human_browser'
  )
from (values ('a'), ('b')) as client_row(client_name);

select public.confirm_public_booking_preparation_v1(
  jsonb_build_object(
    'preparationToken', (
      select value ->> 'preparationToken'
      from project_s_prepared_expiry_lock.context
      where key = client_name || '-preparation'
    )
  ),
  project_s_prepared_expiry_lock.gateway_context(
    'project-s-confirmation-ui',
    'ui',
    'human',
    'project_s_ui',
    '["bookings:create"]'::jsonb,
    (
      select value
      from project_s_prepared_expiry_lock.context
      where key = client_name || '-grant'
    )
  )
)
from (values ('a'), ('b')) as client_row(client_name);

select is(
  extensions.dblink_connect(
    'prepared_expiry_a',
    pg_catalog.format(
      'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
      pg_catalog.current_database()
    )
  ),
  'OK',
  'preparation-expiry commit connection opens'
);
select is(
  extensions.dblink_connect(
    'prepared_expiry_b',
    pg_catalog.format(
      'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
      pg_catalog.current_database()
    )
  ),
  'OK',
  'grant-expiry commit connection opens'
);
select is(
  extensions.dblink_connect(
    'prepared_expiry_lock_holder',
    pg_catalog.format(
      'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
      pg_catalog.current_database()
    )
  ),
  'OK',
  'expiry lock-holder connection opens'
);

create temporary table expiry_connection_pids (
  a_pid integer not null,
  b_pid integer not null
);

insert into expiry_connection_pids (a_pid, b_pid)
select a.pid, b.pid
from extensions.dblink(
  'prepared_expiry_a',
  'select pg_backend_pid()'
) as a(pid integer)
cross join extensions.dblink(
  'prepared_expiry_b',
  'select pg_backend_pid()'
) as b(pid integer);

select is(
  extensions.dblink_exec('prepared_expiry_lock_holder', 'begin'),
  'BEGIN',
  'expiry lock-holder transaction starts'
);
select is(
  extensions.dblink_exec(
    'prepared_expiry_lock_holder',
    $lock$
      do $$
      begin
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            '99000000-0000-4000-8000-000000000001',
            0
          )
        );
      end;
      $$
    $lock$
  ),
  'DO',
  'lock holder owns the scheduling authority lock'
);

insert into project_s_prepared_expiry_lock.context (key, value)
values (
  'expiry-deadline',
  to_jsonb(clock_timestamp() + interval '6 seconds')
);

update private.booking_preparations
set expires_at = (
  select (value #>> '{}')::timestamptz
  from project_s_prepared_expiry_lock.context
  where key = 'expiry-deadline'
)
where id = (
  select (value ->> 'preparationId')::uuid
  from project_s_prepared_expiry_lock.context
  where key = 'a-preparation'
);

update private.booking_confirmation_grants
set expires_at = (
  select (value #>> '{}')::timestamptz
  from project_s_prepared_expiry_lock.context
  where key = 'expiry-deadline'
)
where preparation_id = (
  select (value ->> 'preparationId')::uuid
  from project_s_prepared_expiry_lock.context
  where key = 'b-preparation'
);

select is(
  extensions.dblink_send_query(
    'prepared_expiry_a',
    format(
      'select project_s_prepared_expiry_lock.capture_commit(%L, %L::uuid, %L, %L)',
      (
        select value ->> 'preparationToken'
        from project_s_prepared_expiry_lock.context
        where key = 'a-preparation'
      ),
      '99300000-0000-4000-8000-000000000001',
      'expiry-client-a',
      'http'
    )
  ),
  1,
  'preparation-expiry commit starts before expiry'
);
select is(
  extensions.dblink_send_query(
    'prepared_expiry_b',
    format(
      'select project_s_prepared_expiry_lock.capture_commit(%L, %L::uuid, %L, %L)',
      (
        select value ->> 'preparationToken'
        from project_s_prepared_expiry_lock.context
        where key = 'b-preparation'
      ),
      '99300000-0000-4000-8000-000000000002',
      'expiry-client-b',
      'stdio_mcp'
    )
  ),
  1,
  'grant-expiry commit starts before expiry'
);

select ok(
  pg_temp.wait_for_advisory_state(
    (select a_pid from expiry_connection_pids),
    false
  ),
  'preparation-expiry commit waits on the owner lock'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select b_pid from expiry_connection_pids),
    false
  ),
  'grant-expiry commit waits on the owner lock'
);
select ok(
  clock_timestamp() < (
    select (value #>> '{}')::timestamptz
    from project_s_prepared_expiry_lock.context
    where key = 'expiry-deadline'
  ),
  'both commits reached the owner lock before authority expired'
);
select ok(
  (
    select bool_and(
      activity.query_start < (
        select (value #>> '{}')::timestamptz
        from project_s_prepared_expiry_lock.context
        where key = 'expiry-deadline'
      )
    )
    from pg_catalog.pg_stat_activity as activity
    where activity.pid in (
      select a_pid from expiry_connection_pids
      union all
      select b_pid from expiry_connection_pids
    )
  ),
  'both commit statements began before the shared expiry deadline'
);

select pg_catalog.pg_sleep(
  greatest(
    0::double precision,
    extract(
      epoch from (
        (
          select (value #>> '{}')::timestamptz
          from project_s_prepared_expiry_lock.context
          where key = 'expiry-deadline'
        )
        + interval '250 milliseconds'
        - clock_timestamp()
      )
    )::double precision
  )
);

select ok(
  clock_timestamp() >= (
    select (value #>> '{}')::timestamptz
    from project_s_prepared_expiry_lock.context
    where key = 'expiry-deadline'
  ),
  'the authority deadline passes while both commits remain lock-blocked'
);

select is(
  extensions.dblink_exec('prepared_expiry_lock_holder', 'commit'),
  'COMMIT',
  'releasing the owner lock lets both expired commits resume'
);

insert into project_s_prepared_expiry_lock.results (client_name, result)
select 'a', result
from extensions.dblink_get_result('prepared_expiry_a') as remote_row(result jsonb);
insert into project_s_prepared_expiry_lock.results (client_name, result)
select 'b', result
from extensions.dblink_get_result('prepared_expiry_b') as remote_row(result jsonb);

select is(
  (
    select result ->> 'sqlState'
    from project_s_prepared_expiry_lock.results
    where client_name = 'a'
  ),
  'PT410',
  'post-lock preparation expiry preserves the typed SQLSTATE'
);
select is(
  (
    select result ->> 'message'
    from project_s_prepared_expiry_lock.results
    where client_name = 'a'
  ),
  'PREPARATION_EXPIRED',
  'post-lock preparation expiry rejects the commit'
);
select is(
  (
    select result ->> 'sqlState'
    from project_s_prepared_expiry_lock.results
    where client_name = 'b'
  ),
  'PT409',
  'post-lock grant expiry preserves the typed SQLSTATE'
);
select is(
  (
    select result ->> 'message'
    from project_s_prepared_expiry_lock.results
    where client_name = 'b'
  ),
  'CONFIRMATION_REQUIRED',
  'post-lock grant expiry rejects the commit'
);
select is(
  (
    select count(*)::integer
    from public.bookings
    where user_id = '99000000-0000-4000-8000-000000000001'
  ),
  0,
  'expired authority inserts no booking'
);
select is(
  (
    select count(*)::integer
    from private.booking_confirmation_grants as grant_row
    join private.booking_preparations as preparation_row
      on preparation_row.id = grant_row.preparation_id
    where preparation_row.owner_id = '99000000-0000-4000-8000-000000000001'
      and grant_row.consumed_at is null
      and grant_row.consumed_by_booking_id is null
  ),
  2,
  'both rejected confirmation grants remain unconsumed'
);
select is(
  (
    select count(*)::integer
    from private.booking_preparations
    where owner_id = '99000000-0000-4000-8000-000000000001'
      and state = 'confirmed'
      and committed_at is null
      and booker_name is not null
      and booker_email is not null
  ),
  2,
  'both rejected preparations remain confirmed and uncommitted'
);

select is(
  extensions.dblink_disconnect('prepared_expiry_a'),
  'OK',
  'preparation-expiry commit connection closes'
);
select is(
  extensions.dblink_disconnect('prepared_expiry_b'),
  'OK',
  'grant-expiry commit connection closes'
);
select is(
  extensions.dblink_disconnect('prepared_expiry_lock_holder'),
  'OK',
  'expiry lock-holder connection closes'
);

delete from private.booking_confirmation_grants
where preparation_id in (
  select id
  from private.booking_preparations
  where owner_id = '99000000-0000-4000-8000-000000000001'
);
delete from public.bookings
where user_id = '99000000-0000-4000-8000-000000000001';
delete from private.booking_preparations
where owner_id = '99000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '99000000-0000-4000-8000-000000000001';
drop schema project_s_prepared_expiry_lock cascade;

select * from finish();
