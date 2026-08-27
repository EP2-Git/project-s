create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

set search_path = public, extensions, pg_catalog;
select no_plan();

-- This test deliberately commits its fixture before opening the two dblink
-- sessions. The remote writer and booking caller must observe the same durable
-- rows while exercising the real cross-session advisory-lock protocol.
delete from public.bookings
where user_id = '94000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '94000000-0000-4000-8000-000000000001';
drop schema if exists project_s_lock_test cascade;

create schema project_s_lock_test;

create or replace function project_s_lock_test.capture_public_booking(
  p_request jsonb
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
    'response', public.create_public_booking_v1(p_request)
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

create or replace function project_s_lock_test.change_schedule_and_hold(
  p_duration_minutes smallint,
  p_timezone text,
  p_active boolean,
  p_hold_seconds double precision
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_user_id constant uuid := '94000000-0000-4000-8000-000000000001';
begin
  update public.profiles
  set timezone = p_timezone
  where id = v_user_id;

  update public.meeting_types
  set
    duration_minutes = p_duration_minutes,
    active = p_active
  where id = '95000000-0000-4000-8000-000000000001';

  perform pg_catalog.pg_sleep(p_hold_seconds);

  return jsonb_build_object(
    'durationMinutes', p_duration_minutes,
    'hostTimeZone', p_timezone,
    'active', p_active
  );
end;
$$;

create or replace function project_s_lock_test.change_notice_and_hold(
  p_minimum_notice_minutes integer,
  p_hold_seconds double precision
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_user_id constant uuid := '94000000-0000-4000-8000-000000000001';
begin
  update public.meeting_types
  set
    duration_minutes = 30,
    minimum_notice_minutes = p_minimum_notice_minutes,
    active = true
  where id = '95000000-0000-4000-8000-000000000001';

  update public.profiles
  set timezone = 'UTC'
  where id = v_user_id;

  perform pg_catalog.pg_sleep(p_hold_seconds);

  return jsonb_build_object(
    'minimumNoticeMinutes', p_minimum_notice_minutes,
    'holdSeconds', p_hold_seconds
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
  '94000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'locking-owner@example.invalid',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"locking-owner","full_name":"Locking Owner","timezone":"UTC"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
);

delete from public.availabilities
where user_id = '94000000-0000-4000-8000-000000000001';

insert into public.availabilities (
  user_id,
  weekday,
  start_time,
  end_time,
  buffer_minutes
)
select
  '94000000-0000-4000-8000-000000000001',
  weekday,
  time '00:00',
  time '23:59',
  0
from generate_series(0, 6) as weekday;

insert into public.meeting_types (
  id,
  user_id,
  title,
  duration_minutes,
  slot_interval_minutes,
  minimum_notice_minutes,
  maximum_advance_days,
  active
)
values (
  '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001',
  'Schedule lock test',
  30,
  15,
  0,
  365,
  true
);

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

select is(
  extensions.dblink_connect(
    'schedule_writer',
    pg_catalog.format(
      'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
      pg_catalog.current_database()
    )
  ),
  'OK',
  'schedule writer connection opens'
);
select is(
  extensions.dblink_connect(
    'booking_client',
    pg_catalog.format(
      'host=host.docker.internal port=54322 dbname=%L user=postgres password=postgres',
      pg_catalog.current_database()
    )
  ),
  'OK',
  'public booking connection opens'
);

create temporary table lock_connection_pids (
  writer_pid integer not null,
  booking_pid integer not null
);

insert into lock_connection_pids (writer_pid, booking_pid)
select writer.pid, booker.pid
from extensions.dblink(
  'schedule_writer',
  'select pg_backend_pid()'
) as writer(pid integer)
cross join extensions.dblink(
  'booking_client',
  'select pg_backend_pid()'
) as booker(pid integer);

select is(
  extensions.dblink_send_query(
    'schedule_writer',
    $remote$
      select project_s_lock_test.change_schedule_and_hold(
        45::smallint,
        'America/Halifax',
        true,
        5::double precision
      )::text as result
    $remote$
  ),
  1,
  'duration/timezone writer starts asynchronously'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select writer_pid from lock_connection_pids),
    true
  ),
  'schedule writer holds the owner advisory lock'
);

select is(
  extensions.dblink_send_query(
    'booking_client',
    $remote$
      select project_s_lock_test.capture_public_booking(
        jsonb_build_object(
          'username', 'locking-owner',
          'meetingTypeId', '95000000-0000-4000-8000-000000000001',
          'startAt', to_char(
            (current_date + 7) + time '12:00',
            'YYYY-MM-DD"T"HH24:MI:SS'
          ) || 'Z',
          'guestTimeZone', 'UTC',
          'idempotencyKey', '96000000-0000-4000-8000-000000000001',
          'booker', jsonb_build_object(
            'name', 'Lock Test Guest',
            'email', 'lock-test@example.invalid'
          )
        )
      )::text as result
    $remote$
  ),
  1,
  'booking starts while the schedule write is uncommitted'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select booking_pid from lock_connection_pids),
    false
  ),
  'booking waits on the owner schedule lock before validation'
);

create temporary table first_writer_result (result jsonb not null);
insert into first_writer_result (result)
select result::jsonb
from extensions.dblink_get_result('schedule_writer') as result(result text);

create temporary table first_booking_result (result jsonb not null);
insert into first_booking_result (result)
select result::jsonb
from extensions.dblink_get_result('booking_client') as result(result text);

select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('schedule_writer') as result(result text)
  ),
  0,
  'duration/timezone writer result stream is fully drained'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('booking_client') as result(result text)
  ),
  0,
  'duration/timezone booking result stream is fully drained'
);

select is(
  (select result ->> 'ok' from first_booking_result),
  'true',
  'booking succeeds after the schedule writer commits'
);
select is(
  (select result #>> '{response,hostTimeZone}' from first_booking_result),
  'America/Halifax',
  'booking response uses the post-lock profile timezone'
);
select is(
  (
    select (
      extract(
        epoch from (
          (result #>> '{response,endAt}')::timestamptz
          - (result #>> '{response,startAt}')::timestamptz
        )
      ) / 60
    )::integer
    from first_booking_result
  ),
  45,
  'booking response uses the post-lock meeting duration'
);
select is(
  (
    select duration_minutes::integer
    from public.bookings
    where idempotency_key = '96000000-0000-4000-8000-000000000001'
  ),
  45,
  'persisted booking snapshots the post-lock duration'
);
select is(
  (
    select host_timezone
    from public.bookings
    where idempotency_key = '96000000-0000-4000-8000-000000000001'
  ),
  'America/Halifax',
  'persisted booking snapshots the post-lock timezone'
);

select is(
  extensions.dblink_send_query(
    'schedule_writer',
    $remote$
      select project_s_lock_test.change_schedule_and_hold(
        60::smallint,
        'America/Halifax',
        false,
        5::double precision
      )::text as result
    $remote$
  ),
  1,
  'meeting-type deactivation starts asynchronously'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select writer_pid from lock_connection_pids),
    true
  ),
  'deactivation writer holds the owner advisory lock'
);

select is(
  extensions.dblink_send_query(
    'booking_client',
    $remote$
      select project_s_lock_test.capture_public_booking(
        jsonb_build_object(
          'username', 'locking-owner',
          'meetingTypeId', '95000000-0000-4000-8000-000000000001',
          'startAt', to_char(
            (current_date + 8) + time '12:00',
            'YYYY-MM-DD"T"HH24:MI:SS'
          ) || 'Z',
          'guestTimeZone', 'UTC',
          'idempotencyKey', '96000000-0000-4000-8000-000000000002',
          'booker', jsonb_build_object(
            'name', 'Lock Test Guest',
            'email', 'lock-test@example.invalid'
          )
        )
      )::text as result
    $remote$
  ),
  1,
  'booking starts while deactivation is uncommitted'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select booking_pid from lock_connection_pids),
    false
  ),
  'booking passes its initial active lookup then waits for deactivation'
);

create temporary table second_writer_result (result jsonb not null);
insert into second_writer_result (result)
select result::jsonb
from extensions.dblink_get_result('schedule_writer') as result(result text);

create temporary table second_booking_result (result jsonb not null);
insert into second_booking_result (result)
select result::jsonb
from extensions.dblink_get_result('booking_client') as result(result text);

select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('schedule_writer') as result(result text)
  ),
  0,
  'deactivation writer result stream is fully drained'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('booking_client') as result(result text)
  ),
  0,
  'deactivation booking result stream is fully drained'
);

select is(
  (select result ->> 'ok' from second_booking_result),
  'false',
  'booking rejects the meeting type after deactivation commits'
);
select is(
  (select result ->> 'sqlState' from second_booking_result),
  'PT404',
  'post-lock active-state rejection preserves the typed SQLSTATE'
);
select is(
  (select result ->> 'message' from second_booking_result),
  'MEETING_TYPE_UNAVAILABLE',
  'post-lock active-state rejection preserves the public error code'
);
select is(
  (
    select count(*)::integer
    from public.bookings
    where idempotency_key = '96000000-0000-4000-8000-000000000002'
  ),
  0,
  'deactivated meeting type produces no booking row'
);

-- Build a notice boundary at least twenty seconds in the future but less than
-- eighty-three seconds away. The booking statement begins before that boundary
-- and then waits behind a trigger-acquired schedule lock until after it. A
-- pre-lock statement_timestamp would accept it; the post-lock clock must reject.
update public.meeting_types
set active = true
where id = '95000000-0000-4000-8000-000000000001';

create table project_s_lock_test.notice_context (
  observed_at timestamptz not null,
  start_at timestamptz not null,
  minimum_notice_minutes integer not null,
  boundary_at timestamptz not null,
  hold_seconds double precision not null
);

insert into project_s_lock_test.notice_context (
  observed_at,
  start_at,
  minimum_notice_minutes,
  boundary_at,
  hold_seconds
)
with base as (
  select
    pg_catalog.clock_timestamp() as observed_at,
    (
      pg_catalog.date_trunc(
        'day',
        pg_catalog.clock_timestamp() at time zone 'UTC'
      ) + interval '36 hours'
    ) at time zone 'UTC' as start_at
), notice as (
  select
    base.observed_at,
    base.start_at,
    pg_catalog.floor(
      extract(
        epoch from (
          base.start_at - base.observed_at - interval '20 seconds'
        )
      ) / 60
    )::integer as minimum_notice_minutes
  from base
), boundary as (
  select
    notice.observed_at,
    notice.start_at,
    notice.minimum_notice_minutes,
    notice.start_at
      - (notice.minimum_notice_minutes * interval '1 minute') as boundary_at
  from notice
)
select
  boundary.observed_at,
  boundary.start_at,
  boundary.minimum_notice_minutes,
  boundary.boundary_at,
  greatest(
    5,
    extract(epoch from (boundary.boundary_at - boundary.observed_at)) + 3
  )
from boundary;

select ok(
  (
    select boundary_at - observed_at >= interval '20 seconds'
      and boundary_at - observed_at < interval '81 seconds'
    from project_s_lock_test.notice_context
  ),
  'notice fixture creates a short deterministic future boundary'
);

select is(
  extensions.dblink_send_query(
    'schedule_writer',
    $remote$
      select project_s_lock_test.change_notice_and_hold(
        minimum_notice_minutes,
        hold_seconds
      )::text as result
      from project_s_lock_test.notice_context
    $remote$
  ),
  1,
  'notice writer starts asynchronously'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select writer_pid from lock_connection_pids),
    true
  ),
  'notice update trigger holds the owner advisory lock'
);

select is(
  extensions.dblink_send_query(
    'booking_client',
    $remote$
      select project_s_lock_test.capture_public_booking(
        jsonb_build_object(
          'username', 'locking-owner',
          'meetingTypeId', '95000000-0000-4000-8000-000000000001',
          'startAt', to_char(
            notice.start_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS'
          ) || 'Z',
          'guestTimeZone', 'UTC',
          'idempotencyKey', '96000000-0000-4000-8000-000000000003',
          'booker', jsonb_build_object(
            'name', 'Notice Boundary Guest',
            'email', 'notice-boundary@example.invalid'
          )
        )
      )::text as result
      from project_s_lock_test.notice_context as notice
    $remote$
  ),
  1,
  'boundary booking starts while notice update is uncommitted'
);
select ok(
  pg_temp.wait_for_advisory_state(
    (select booking_pid from lock_connection_pids),
    false
  ),
  'boundary booking waits on the schedule trigger lock'
);
select ok(
  (
    select activity.query_start < notice.boundary_at
    from pg_catalog.pg_stat_activity as activity
    cross join project_s_lock_test.notice_context as notice
    where activity.pid = (
      select booking_pid from lock_connection_pids
    )
  ),
  'booking statement timestamp precedes the notice boundary'
);

create temporary table notice_writer_result (result jsonb not null);
insert into notice_writer_result (result)
select result::jsonb
from extensions.dblink_get_result('schedule_writer') as result(result text);

create temporary table notice_booking_result (result jsonb not null);
insert into notice_booking_result (result)
select result::jsonb
from extensions.dblink_get_result('booking_client') as result(result text);

select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('schedule_writer') as result(result text)
  ),
  0,
  'notice writer result stream is fully drained'
);
select is(
  (
    select count(*)::integer
    from extensions.dblink_get_result('booking_client') as result(result text)
  ),
  0,
  'notice booking result stream is fully drained'
);

select ok(
  (
    select pg_catalog.clock_timestamp() > boundary_at
    from project_s_lock_test.notice_context
  ),
  'schedule writer releases only after the notice boundary passes'
);
select is(
  (select result ->> 'ok' from notice_booking_result),
  'false',
  'post-lock clock rejects the now-too-late booking'
);
select is(
  (select result ->> 'sqlState' from notice_booking_result),
  'PT409',
  'notice-boundary rejection preserves the typed SQLSTATE'
);
select is(
  (select result ->> 'message' from notice_booking_result),
  'OUTSIDE_BOOKING_WINDOW',
  'notice-boundary rejection uses the public booking-window code'
);
select is(
  (
    select count(*)::integer
    from public.bookings
    where idempotency_key = '96000000-0000-4000-8000-000000000003'
  ),
  0,
  'notice-boundary rejection creates no booking row'
);

select is(
  extensions.dblink_disconnect('booking_client'),
  'OK',
  'public booking connection closes'
);
select is(
  extensions.dblink_disconnect('schedule_writer'),
  'OK',
  'schedule writer connection closes'
);

delete from public.bookings
where user_id = '94000000-0000-4000-8000-000000000001';
delete from auth.users
where id = '94000000-0000-4000-8000-000000000001';
drop schema project_s_lock_test cascade;

select * from finish();
