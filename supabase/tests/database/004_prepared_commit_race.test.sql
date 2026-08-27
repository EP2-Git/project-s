create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

set search_path = public, extensions, pg_catalog;
select no_plan();

delete from private.booking_confirmation_grants
where preparation_id in (
  select id
  from private.booking_preparations
  where owner_id = '98000000-0000-4000-8000-000000000001'
);
delete from public.bookings
where user_id = '98000000-0000-4000-8000-000000000001';
delete from private.booking_preparations
where owner_id = '98000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '98000000-0000-4000-8000-000000000001';
drop schema if exists project_s_prepared_race cascade;

create schema project_s_prepared_race;

create table project_s_prepared_race.context (
  key text primary key,
  value jsonb not null
);

create table project_s_prepared_race.results (
  client_name text primary key,
  result jsonb not null
);

create or replace function project_s_prepared_race.gateway_context(
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
      'requestId', 'prepared-race-request-0001',
      'actorKind', p_actor_kind,
      'transport', p_transport,
      'clientId', p_client_id,
      'scopes', p_scopes,
      'provenance', jsonb_build_object(
        'source', p_source,
        'clientVersion', '0.1.0',
        'networkKeyHash', repeat('e', 64)
      ),
      'confirmationGrant', p_grant
    )
  );
$$;

create or replace function project_s_prepared_race.capture_commit(
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
      project_s_prepared_race.gateway_context(
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
  '98000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'prepared-race-owner@example.invalid',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"prepared-race","full_name":"Prepared Race Owner","timezone":"UTC"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
);

delete from public.availabilities
where user_id = '98000000-0000-4000-8000-000000000001';

insert into public.availabilities (
  user_id,
  weekday,
  start_time,
  end_time,
  buffer_minutes
)
select
  '98000000-0000-4000-8000-000000000001',
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
  '98100000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  'Prepared race call',
  30,
  15,
  0,
  0,
  0,
  365,
  true
);

insert into project_s_prepared_race.context (key, value)
values (
  'slot-start',
  to_jsonb(
    to_char(
      current_date::timestamp + interval '9 days 10 hours',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
  )
);

insert into project_s_prepared_race.context (key, value)
select
  client_name || '-preparation',
  public.prepare_public_booking_v1(
    jsonb_build_object(
      'username', 'prepared-race',
      'meetingTypeId', '98100000-0000-4000-8000-000000000001',
      'startAt', (
        select value #>> '{}'
        from project_s_prepared_race.context
        where key = 'slot-start'
      ),
      'guestTimeZone', 'UTC',
      'booker', jsonb_build_object(
        'name', 'Prepared ' || upper(client_name) || ' Guest',
        'email', 'prepared-' || client_name || '@example.invalid'
      )
    ),
    project_s_prepared_race.gateway_context(
      'race-client-' || client_name,
      case when client_name = 'a' then 'http' else 'stdio_mcp' end,
      'anonymous',
      case when client_name = 'a' then 'project_s_sdk' else 'project_s_mcp' end,
      '["bookings:prepare","bookings:create"]'::jsonb
    )
  )
from (values ('a'), ('b')) as client_row(client_name);

insert into project_s_prepared_race.context (key, value)
select
  client_name || '-grant',
  jsonb_build_object(
    'grantId', case
      when client_name = 'a'
        then '98200000-0000-4000-8000-000000000001'
      else '98200000-0000-4000-8000-000000000002'
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
      from project_s_prepared_race.context
      where key = client_name || '-preparation'
    )
  ),
  project_s_prepared_race.gateway_context(
    'project-s-confirmation-ui',
    'ui',
    'human',
    'project_s_ui',
    '["bookings:create"]'::jsonb,
    (
      select value
      from project_s_prepared_race.context
      where key = client_name || '-grant'
    )
  )
)
from (values ('a'), ('b')) as client_row(client_name);

select extensions.dblink_connect(
  'prepared_commit_a',
  pg_catalog.format(
    'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
    pg_catalog.current_database()
  )
);
select extensions.dblink_connect(
  'prepared_commit_b',
  pg_catalog.format(
    'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
    pg_catalog.current_database()
  )
);
select extensions.dblink_connect(
  'prepared_commit_lock_holder',
  pg_catalog.format(
    'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
    pg_catalog.current_database()
  )
);

select is(
  extensions.dblink_exec('prepared_commit_lock_holder', 'begin'),
  'BEGIN',
  'lock-holder transaction starts'
);
select is(
  extensions.dblink_exec(
    'prepared_commit_lock_holder',
    $lock$
      do $$
      begin
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(
            '98000000-0000-4000-8000-000000000001',
            0
          )
        );
      end;
      $$
    $lock$
  ),
  'DO',
  'lock holder owns the scheduling authority lock before both commits'
);

select ok(
  extensions.dblink_send_query(
    'prepared_commit_a',
    format(
      'select project_s_prepared_race.capture_commit(%L, %L::uuid, %L, %L)',
      (
        select value ->> 'preparationToken'
        from project_s_prepared_race.context
        where key = 'a-preparation'
      ),
      '98300000-0000-4000-8000-000000000001',
      'race-client-a',
      'http'
    )
  ) = 1,
  'HTTP client starts a prepared commit'
);
select ok(
  extensions.dblink_send_query(
    'prepared_commit_b',
    format(
      'select project_s_prepared_race.capture_commit(%L, %L::uuid, %L, %L)',
      (
        select value ->> 'preparationToken'
        from project_s_prepared_race.context
        where key = 'b-preparation'
      ),
      '98300000-0000-4000-8000-000000000002',
      'race-client-b',
      'stdio_mcp'
    )
  ) = 1,
  'stdio MCP client starts a competing prepared commit'
);

select is(
  extensions.dblink_exec('prepared_commit_lock_holder', 'commit'),
  'COMMIT',
  'releasing the owner lock lets both waiting commits race'
);

insert into project_s_prepared_race.results (client_name, result)
select 'a', result
from extensions.dblink_get_result('prepared_commit_a') as remote_row(result jsonb);
insert into project_s_prepared_race.results (client_name, result)
select 'b', result
from extensions.dblink_get_result('prepared_commit_b') as remote_row(result jsonb);

select is(
  (
    select count(*)::integer
    from project_s_prepared_race.results
    where result ->> 'ok' = 'true'
  ),
  1,
  'exactly one independently confirmed preparation wins the slot race'
);
select is(
  (
    select count(*)::integer
    from project_s_prepared_race.results
    where result ->> 'ok' = 'false'
      and result ->> 'sqlState' = 'PT409'
      and result ->> 'message' = 'SLOT_UNAVAILABLE'
  ),
  1,
  'the competing prepared commit receives the stable slot conflict'
);
select is(
  (
    select count(*)::integer
    from public.bookings
    where user_id = '98000000-0000-4000-8000-000000000001'
      and start_time = (
        select (value #>> '{}')::timestamptz
        from project_s_prepared_race.context
        where key = 'slot-start'
      )
      and status = 'confirmed'
  ),
  1,
  'the exclusion constraint contains exactly one confirmed booking'
);
select is(
  (
    select count(*)::integer
    from private.booking_confirmation_grants as grant_row
    join private.booking_preparations as preparation_row
      on preparation_row.id = grant_row.preparation_id
    where preparation_row.owner_id = '98000000-0000-4000-8000-000000000001'
      and grant_row.consumed_at is not null
  ),
  1,
  'only the winning one-use confirmation grant is consumed'
);
select is(
  (
    select count(*)::integer
    from private.booking_preparations
    where owner_id = '98000000-0000-4000-8000-000000000001'
      and state = 'committed'
      and booker_name is null
      and booker_email is null
  ),
  1,
  'only the winning preparation commits and redacts duplicated PII'
);

select extensions.dblink_disconnect('prepared_commit_a');
select extensions.dblink_disconnect('prepared_commit_b');
select extensions.dblink_disconnect('prepared_commit_lock_holder');

delete from private.booking_confirmation_grants
where preparation_id in (
  select id
  from private.booking_preparations
  where owner_id = '98000000-0000-4000-8000-000000000001'
);
delete from public.bookings
where user_id = '98000000-0000-4000-8000-000000000001';
delete from private.booking_preparations
where owner_id = '98000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '98000000-0000-4000-8000-000000000001';
drop schema project_s_prepared_race cascade;

select * from finish();
