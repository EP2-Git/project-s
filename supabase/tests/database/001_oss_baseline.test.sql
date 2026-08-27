begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
grant usage on schema extensions to authenticated;
grant usage on schema extensions to anon;
select no_plan();

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'meeting_types', 'meeting_types table exists');
select has_table('public', 'availabilities', 'availabilities table exists');
select has_table(
  'public',
  'specific_date_availabilities',
  'specific-date availability table exists'
);
select has_table('public', 'bookings', 'bookings table exists');

select has_function(
  'public',
  'get_public_booking_page_v1',
  array['text'],
  'public page RPC signature is stable'
);
select has_function(
  'public',
  'list_public_free_slots_v1',
  array['text', 'uuid', 'date', 'text'],
  'public slot RPC signature is stable'
);
select has_function(
  'public',
  'create_public_booking_v1',
  array['jsonb'],
  'public booking RPC signature is stable'
);
select has_function(
  'public',
  'cancel_booking_v1',
  array['uuid', 'integer'],
  'owner cancellation RPC exists'
);
select has_function(
  'public',
  'set_weekly_schedule_v1',
  array['jsonb'],
  'atomic owner weekly schedule command exists'
);
select hasnt_function(
  'public',
  'update_availability',
  'legacy caller-supplied owner availability RPC is absent'
);
select hasnt_function(
  'public',
  'set_weekly_availability_v1',
  'per-day weekly RPC is absent'
);

select is(
  (
    select count(*)::integer
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in (
        'profiles',
        'meeting_types',
        'availabilities',
        'specific_date_availabilities',
        'bookings'
      )
      and relrowsecurity
      and relforcerowsecurity
  ),
  5,
  'all API tables enable and force RLS'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anon cannot read profiles directly'
);
select ok(
  not has_table_privilege('anon', 'public.bookings', 'select'),
  'anon cannot read booking PII directly'
);
select ok(
  not has_table_privilege('anon', 'public.bookings', 'insert'),
  'anon cannot insert bookings directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.bookings', 'update'),
  'owners cannot bypass the booking mutation RPCs'
);
select ok(
  not has_function_privilege(
    'anon', 'public.get_public_booking_page_v1(text)', 'execute'
  ) and not has_function_privilege(
    'authenticated', 'public.get_public_booking_page_v1(text)', 'execute'
  ),
  'clients cannot bypass the gateway through the legacy page RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'public.list_public_free_slots_v1(text,uuid,date,text)', 'execute'
  ) and not has_function_privilege(
    'authenticated',
    'public.list_public_free_slots_v1(text,uuid,date,text)',
    'execute'
  ),
  'clients cannot bypass gateway slot-search abuse controls'
);
select ok(
  not has_function_privilege(
    'anon', 'public.create_public_booking_v1(jsonb)', 'execute'
  ) and not has_function_privilege(
    'authenticated', 'public.create_public_booking_v1(jsonb)', 'execute'
  ),
  'clients cannot bypass preparation and confirmation through legacy create'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.list_public_free_slots_v1(text,uuid,date,text)',
    'execute'
  ),
  'gateway authority can reuse the hardened free-slot computation'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.cancel_booking_v1(uuid,integer)',
    'execute'
  ),
  'anon cannot execute owner cancellation'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.set_weekly_schedule_v1(jsonb)',
    'execute'
  ),
  'anon cannot execute the owner weekly schedule command'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.set_weekly_schedule_v1(jsonb)',
    'execute'
  ),
  'authenticated owners can execute the weekly schedule command'
);
select ok(
  not has_function_privilege(
    'anon',
    'private.compute_free_slots_v1(text,uuid,date,text,timestamp with time zone)',
    'execute'
  ),
  'anon cannot execute private scheduling helpers'
);
select is(
  (
    select array_agg(procedure_row.proname::text order by procedure_row.proname)
    from pg_proc as procedure_row
    join pg_namespace as namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and has_function_privilege('anon', procedure_row.oid, 'execute')
  ),
  array['is_username_available_v1'],
  'anon RPC execution is restricted to username signup support only'
);
select has_trigger(
  'auth',
  'users',
  'on_auth_user_created',
  'auth profile bootstrap trigger exists'
);
select has_trigger(
  'public',
  'meeting_types',
  'meeting_types_lock_owner_schedule',
  'meeting type writes serialize with booking creation'
);
select has_trigger(
  'public',
  'profiles',
  'profiles_lock_owner_schedule',
  'profile timezone and publication changes serialize with booking creation'
);
select has_trigger(
  'public',
  'availabilities',
  'availabilities_lock_owner_schedule',
  'weekly availability writes serialize with booking creation'
);
select has_trigger(
  'public',
  'specific_date_availabilities',
  'specific_dates_lock_owner_schedule',
  'date override writes serialize with booking creation'
);
select is(
  (
    select count(*)::integer
    from pg_proc as procedure_row
    join pg_namespace as namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname in ('public', 'private')
      and procedure_row.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(procedure_row.proconfig, array[]::text[]))
          as settings(setting_value)
        where settings.setting_value like 'search_path=%'
      )
  ),
  0,
  'every SECURITY DEFINER function fixes search_path'
);

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
  '90000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'owner@example.invalid',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"test-owner","full_name":"Test Owner","timezone":"UTC"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
);

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
  '90000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'other-owner@example.invalid',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"other-owner","full_name":"Other Owner","timezone":"UTC"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
);

select is(
  (
    select username
    from public.profiles
    where id = '90000000-0000-4000-8000-000000000001'
  ),
  'test-owner',
  'auth trigger creates the requested profile'
);
select is(
  (
    select count(*)::integer
    from public.availabilities
    where user_id = '90000000-0000-4000-8000-000000000001'
  ),
  5,
  'auth trigger creates five default weekday windows'
);

select throws_ok(
  $$select public.get_public_booking_page_v1('other-owner')$$,
  'PT404',
  'NOT_FOUND',
  'an account with no active meeting type has no public profile page'
);

insert into public.meeting_types (
  id,
  user_id,
  title,
  duration_minutes,
  active
)
values (
  '91000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000002',
  'Inactive private draft',
  30,
  false
);

select throws_ok(
  $$select public.get_public_booking_page_v1('other-owner')$$,
  'PT404',
  'NOT_FOUND',
  'an account with only inactive meeting types does not disclose its profile'
);

delete from public.availabilities
where user_id = '90000000-0000-4000-8000-000000000001';

insert into public.availabilities (
  user_id,
  weekday,
  start_time,
  end_time,
  buffer_minutes
)
select
  '90000000-0000-4000-8000-000000000001',
  day_number,
  time '00:00',
  time '23:59',
  20
from generate_series(0, 6) as day_number;

insert into public.meeting_types (
  id,
  user_id,
  title,
  duration_minutes,
  slot_interval_minutes,
  minimum_notice_minutes,
  maximum_advance_days
)
values (
  '91000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  'Database test',
  30,
  15,
  0,
  365
);

create temporary table test_context as
select
  current_date + 2 as display_date,
  public.get_public_booking_page_v1('test-owner') as page,
  public.list_public_free_slots_v1(
    'test-owner',
    '91000000-0000-4000-8000-000000000001',
    current_date + 2,
    'UTC'
  ) as slot_response;

select is(
  (
    select array_agg(key_name order by key_name)
    from test_context,
    lateral jsonb_object_keys(page) as keys(key_name)
  ),
  array['capabilities', 'meetingTypes', 'profile', 'scheduling', 'version'],
  'public page has exactly the strict top-level keys'
);
select is(
  (
    select array_agg(key_name order by key_name)
    from test_context,
    lateral jsonb_object_keys(page -> 'meetingTypes' -> 0) as keys(key_name)
  ),
  array['description', 'durationMinutes', 'id', 'title'],
  'meeting type DTO has exactly the strict public fields'
);
select is(
  (select page #>> '{scheduling,maxAdvanceDays}' from test_context),
  '365',
  'page scheduling summary remains positive'
);
select is(
  (select page #>> '{capabilities,googleCalendar}' from test_context),
  'disabled',
  'page reports Google Calendar as disabled'
);
select ok(
  (select page::text from test_context)
    !~* 'bookerEmail|booker_email|"bookings"|"availabilities"|"responses"',
  'page response contains no PII or raw scheduling rows'
);
select is(
  (
    select array_agg(key_name order by key_name)
    from test_context,
    lateral jsonb_object_keys(slot_response) as keys(key_name)
  ),
  array['date', 'displayTimeZone', 'generatedAt', 'slots'],
  'free-slot response has exactly the strict top-level keys'
);
select ok(
  jsonb_array_length((select slot_response -> 'slots' from test_context)) > 0,
  'slot engine returns future availability'
);
select is(
  (
    select array_agg(key_name order by key_name)
    from test_context,
    lateral jsonb_object_keys(slot_response -> 'slots' -> 0) as keys(key_name)
  ),
  array['endAt', 'startAt'],
  'slot DTO exposes only absolute start and end instants'
);

create temporary table booking_context as
select public.create_public_booking_v1(
  jsonb_build_object(
    'username', 'test-owner',
    'meetingTypeId', '91000000-0000-4000-8000-000000000001',
    'startAt', (select slot_response #>> '{slots,0,startAt}' from test_context),
    'guestTimeZone', 'UTC',
    'idempotencyKey', '92000000-0000-4000-8000-000000000001',
    'booker', jsonb_build_object(
      'name', 'Synthetic Guest',
      'email', 'synthetic@example.invalid',
      'notes', 'pgTAP fixture'
    )
  )
) as response;

create temporary table booked_id_context as
select id as booking_id
from public.bookings
where idempotency_key = '92000000-0000-4000-8000-000000000001';
grant select on booked_id_context to authenticated;

select is(
  (
    select array_agg(key_name order by key_name)
    from booking_context,
    lateral jsonb_object_keys(response) as keys(key_name)
  ),
  array[
    'confirmationCode',
    'endAt',
    'hostTimeZone',
    'meetingTypeTitle',
    'startAt',
    'status'
  ],
  'booking success has exactly the strict confirmation keys'
);
select is(
  (select response ->> 'status' from booking_context),
  'confirmed',
  'valid request creates a confirmed booking'
);
select ok(
  (select response::text from booking_context)
    !~* 'synthetic@example.invalid|Synthetic Guest|pgTAP fixture',
  'booking confirmation returns no guest PII'
);
select is(
  (
    select buffer_after_minutes
    from public.bookings
    where idempotency_key = '92000000-0000-4000-8000-000000000001'
  ),
  20::smallint,
  'effective availability buffer is snapshotted into occupied time'
);
select is(
  (
    select responses ->> 'notes'
    from public.bookings
    where idempotency_key = '92000000-0000-4000-8000-000000000001'
  ),
  'pgTAP fixture',
  'notes are mirrored into legacy-compatible responses'
);
select is(
  public.create_public_booking_v1(
    jsonb_build_object(
      'username', 'test-owner',
      'meetingTypeId', '91000000-0000-4000-8000-000000000001',
      'startAt', (select slot_response #>> '{slots,0,startAt}' from test_context),
      'guestTimeZone', 'UTC',
      'idempotencyKey', '92000000-0000-4000-8000-000000000001',
      'booker', jsonb_build_object(
        'name', 'Synthetic Guest',
        'email', 'synthetic@example.invalid',
        'notes', 'pgTAP fixture'
      )
    )
  ) ->> 'confirmationCode',
  (select response ->> 'confirmationCode' from booking_context),
  'idempotent replay returns the same confirmation'
);

update public.meeting_types
set active = false
where id = '91000000-0000-4000-8000-000000000001';

select is(
  public.create_public_booking_v1(
    jsonb_build_object(
      'username', 'test-owner',
      'meetingTypeId', '91000000-0000-4000-8000-000000000001',
      'startAt', (select slot_response #>> '{slots,0,startAt}' from test_context),
      'guestTimeZone', 'UTC',
      'idempotencyKey', '92000000-0000-4000-8000-000000000001',
      'booker', jsonb_build_object(
        'name', 'Synthetic Guest',
        'email', 'synthetic@example.invalid',
        'notes', 'pgTAP fixture'
      )
    )
  ) ->> 'confirmationCode',
  (select response ->> 'confirmationCode' from booking_context),
  'exact replay survives later meeting-type deactivation'
);

update public.meeting_types
set active = true
where id = '91000000-0000-4000-8000-000000000001';

update public.profiles
set username = 'renamed-test-owner'
where id = '90000000-0000-4000-8000-000000000001';

select is(
  public.create_public_booking_v1(
    jsonb_build_object(
      'username', 'test-owner',
      'meetingTypeId', '91000000-0000-4000-8000-000000000001',
      'startAt', (select slot_response #>> '{slots,0,startAt}' from test_context),
      'guestTimeZone', 'UTC',
      'idempotencyKey', '92000000-0000-4000-8000-000000000001',
      'booker', jsonb_build_object(
        'name', 'Synthetic Guest',
        'email', 'synthetic@example.invalid',
        'notes', 'pgTAP fixture'
      )
    )
  ) ->> 'confirmationCode',
  (select response ->> 'confirmationCode' from booking_context),
  'exact replay survives a later profile rename'
);

update public.profiles
set username = 'test-owner'
where id = '90000000-0000-4000-8000-000000000001';

select throws_ok(
  format(
    $sql$
      select public.create_public_booking_v1(
        jsonb_build_object(
          'username', 'test-owner',
          'meetingTypeId', '91000000-0000-4000-8000-000000000001',
          'startAt', %L,
          'guestTimeZone', 'UTC',
          'idempotencyKey', '92000000-0000-4000-8000-000000000001',
          'booker', jsonb_build_object(
            'name', 'Synthetic Guest',
            'email', 'changed@example.invalid',
            'notes', 'pgTAP fixture'
          )
        )
      )
    $sql$,
    (select slot_response #>> '{slots,0,startAt}' from test_context)
  ),
  'PT409',
  'IDEMPOTENCY_KEY_REUSED',
  'same idempotency key with a changed payload is rejected'
);

select throws_ok(
  format(
    $sql$
      select public.create_public_booking_v1(
        jsonb_build_object(
          'username', 'test-owner',
          'meetingTypeId', '91000000-0000-4000-8000-000000000001',
          'startAt', %L,
          'guestTimeZone', 'UTC',
          'idempotencyKey', '92000000-0000-4000-8000-000000000002',
          'booker', jsonb_build_object(
            'name', 'Second Guest',
            'email', 'second@example.invalid'
          )
        )
      )
    $sql$,
    (select slot_response #>> '{slots,0,startAt}' from test_context)
  ),
  'PT409',
  'SLOT_UNAVAILABLE',
  'overlapping booking is rejected'
);
select throws_ok(
  $$select public.create_public_booking_v1('{"unexpected":true}'::jsonb)$$,
  'PT400',
  'VALIDATION_ERROR',
  'unknown request keys are rejected'
);
select throws_ok(
  $$select public.create_public_booking_v1(
    '{
      "username":"test-owner",
      "meetingTypeId":"91000000-0000-4000-8000-000000000001",
      "startAt":"2030-01-01T12:00:00Z",
      "guestTimeZone":"UTC",
      "idempotencyKey":"92000000-0000-4000-8000-000000000003",
      "booker":{
        "name":"Guest",
        "email":"guest@example.invalid",
        "unexpected":true
      }
    }'::jsonb
  )$$,
  'PT400',
  'VALIDATION_ERROR',
  'unknown nested booker keys are rejected'
);

select throws_ok(
  format(
    $sql$
      select public.create_public_booking_v1(
        jsonb_build_object(
          'username', 'test-owner',
          'meetingTypeId', '91000000-0000-4000-8000-000000000001',
          'startAt', %L,
          'guestTimeZone', 'UTC',
          'idempotencyKey', extensions.gen_random_uuid(),
          'booker', jsonb_build_object(
            'name', 'Guest',
            'email', %L
          )
        )
      )
    $sql$,
    (select slot_response #>> '{slots,1,startAt}' from test_context),
    invalid.email
  ),
  'PT400',
  'VALIDATION_ERROR',
  'public booking rejects ' || invalid.label
)
from (
  values
    ('guest?tag@example.invalid', 'question-mark email delimiters'),
    ('guest#tag@example.invalid', 'fragment email delimiters'),
    ('guest&tag@example.invalid', 'ampersand email delimiters'),
    (E'guest\t@example.invalid', 'control or whitespace in email')
) as invalid(email, label);

select throws_ok(
  $$
    insert into public.bookings (
      user_id,
      meeting_type_id,
      start_time,
      duration_minutes,
      booker_name,
      booker_email,
      meeting_type_title,
      host_timezone,
      idempotency_key,
      request_fingerprint
    )
    values (
      '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      statement_timestamp() + interval '30 days',
      30,
      'Direct Table Guest',
      'guest#tag@example.invalid',
      'Database test',
      'UTC',
      '92000000-0000-4000-8000-000000000010',
      decode(repeat('00', 32), 'hex')
    )
  $$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_booker_email_format"',
  'booking table constraint rejects unsafe email delimiters'
);
select throws_ok(
  $$
    insert into public.bookings (
      user_id,
      meeting_type_id,
      start_time,
      duration_minutes,
      booker_name,
      booker_email,
      meeting_type_title,
      host_timezone,
      idempotency_key,
      request_fingerprint
    )
    values (
      '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      statement_timestamp() + interval '31 days',
      30,
      'Direct Table Guest',
      E'guest\n@example.invalid',
      'Database test',
      'UTC',
      '92000000-0000-4000-8000-000000000011',
      decode(repeat('00', 32), 'hex')
    )
  $$,
  '23514',
  'new row for relation "bookings" violates check constraint "bookings_booker_email_format"',
  'booking table constraint rejects email controls and whitespace'
);

select throws_ok(
  $$select public.create_public_booking_v1(
    '{
      "username":"test-owner",
      "meetingTypeId":"91000000-0000-4000-8000-000000000001",
      "startAt":"2099-01-01T12:00:00Z",
      "guestTimeZone":"UTC",
      "idempotencyKey":"92000000-0000-4000-8000-000000000004",
      "booker":{"name":"Guest","email":"guest@example.invalid"}
    }'::jsonb
  )$$,
  'PT409',
  'OUTSIDE_BOOKING_WINDOW',
  'server-derived booking window rejects distant requests'
);
select throws_ok(
  $$select public.list_public_free_slots_v1(
    'test-owner',
    '91000000-0000-4000-8000-000000000001',
    current_date,
    'Not/AZone'
  )$$,
  'PT400',
  'INVALID_TIME_ZONE',
  'invalid IANA time zone is rejected safely'
);

insert into public.specific_date_availabilities (
  id,
  user_id,
  date,
  status,
  note
)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    current_date + 1000,
    'default',
    'owner RLS matrix fixture'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000002',
    current_date + 1001,
    'default',
    'other-owner RLS matrix fixture'
  );

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$select count(*) from public.profiles$$,
  '42501',
  'permission denied for table profiles',
  'anon cannot SELECT profiles directly'
);
select throws_ok(
  $$delete from public.profiles where false$$,
  '42501',
  'permission denied for table profiles',
  'anon cannot mutate profiles directly'
);
select throws_ok(
  $$select count(*) from public.meeting_types$$,
  '42501',
  'permission denied for table meeting_types',
  'anon cannot SELECT meeting types directly'
);
select throws_ok(
  $$delete from public.meeting_types where false$$,
  '42501',
  'permission denied for table meeting_types',
  'anon cannot mutate meeting types directly'
);
select throws_ok(
  $$select count(*) from public.availabilities$$,
  '42501',
  'permission denied for table availabilities',
  'anon cannot SELECT weekly availability directly'
);
select throws_ok(
  $$delete from public.availabilities where false$$,
  '42501',
  'permission denied for table availabilities',
  'anon cannot mutate weekly availability directly'
);
select throws_ok(
  $$select count(*) from public.specific_date_availabilities$$,
  '42501',
  'permission denied for table specific_date_availabilities',
  'anon cannot SELECT specific-date availability directly'
);
select throws_ok(
  $$delete from public.specific_date_availabilities where false$$,
  '42501',
  'permission denied for table specific_date_availabilities',
  'anon cannot mutate specific-date availability directly'
);
select throws_ok(
  $$select count(*) from public.bookings$$,
  '42501',
  'permission denied for table bookings',
  'anon cannot SELECT booking PII directly'
);
select throws_ok(
  $$delete from public.bookings where false$$,
  '42501',
  'permission denied for table bookings',
  'anon cannot mutate bookings directly'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select is((select count(*)::integer from public.profiles), 1, 'owner RLS exposes own profile');
select is((select count(*)::integer from public.bookings), 1, 'owner RLS exposes own booking');
select is(
  (select count(*)::integer from public.meeting_types),
  1,
  'owner SELECT sees exactly their meeting type'
);
select is(
  (select count(*)::integer from public.availabilities),
  7,
  'owner SELECT sees exactly their weekly availability rows'
);
select is(
  (select count(*)::integer from public.specific_date_availabilities),
  1,
  'owner SELECT sees exactly their specific-date row'
);
select results_eq(
  $$
    with changed as (
      update public.profiles
      set full_name = full_name
      where id = '90000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[1],
  'owner can mutate their profile'
);
select results_eq(
  $$
    with changed as (
      update public.profiles
      set full_name = full_name
      where id = '90000000-0000-4000-8000-000000000002'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'owner cannot mutate another profile'
);
select results_eq(
  $$
    with changed as (
      update public.meeting_types
      set description = coalesce(description, 'owner RLS matrix')
      where id = '91000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[1],
  'owner can mutate their meeting type'
);
select results_eq(
  $$
    with changed as (
      update public.meeting_types
      set description = description
      where id = '91000000-0000-4000-8000-000000000002'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'owner cannot mutate another meeting type'
);
select results_eq(
  $$
    with changed as (
      update public.availabilities
      set buffer_minutes = buffer_minutes
      where user_id = '90000000-0000-4000-8000-000000000001'
        and weekday = 1
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[1],
  'owner can mutate their weekly availability'
);
select results_eq(
  $$
    with changed as (
      update public.availabilities
      set buffer_minutes = buffer_minutes
      where user_id = '90000000-0000-4000-8000-000000000002'
        and weekday = 1
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'owner cannot mutate another weekly availability row'
);
select results_eq(
  $$
    with changed as (
      update public.specific_date_availabilities
      set note = 'owner RLS matrix updated'
      where id = '93000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[1],
  'owner can mutate their specific-date availability'
);
select results_eq(
  $$
    with changed as (
      update public.specific_date_availabilities
      set note = note
      where id = '93000000-0000-4000-8000-000000000002'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'owner cannot mutate another specific-date availability row'
);
select results_eq(
  $$
    with inserted as (
      insert into public.meeting_types (
        id,
        user_id,
        title,
        duration_minutes
      )
      values (
        '97100000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001',
        'Owner CRUD matrix',
        25
      )
      returning 1
    )
    select count(*)::integer from inserted
  $$,
  array[1],
  'meeting type policy permits an owner INSERT'
);
select throws_ok(
  $$
    insert into public.meeting_types (id, user_id, title, duration_minutes)
    values (
      '97100000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000002',
      'Forged owner',
      25
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "meeting_types"',
  'meeting type policy rejects a forged-owner INSERT'
);
select throws_ok(
  $$
    update public.meeting_types
    set user_id = '90000000-0000-4000-8000-000000000002'
    where id = '97100000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'owner_immutable',
  'meeting type trigger rejects ownership-changing UPDATE'
);
select results_eq(
  $$
    with removed as (
      delete from public.meeting_types
      where id = '97100000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from removed
  $$,
  array[1],
  'meeting type policy permits an owner DELETE'
);
select results_eq(
  $$
    with removed as (
      delete from public.availabilities
      where user_id = '90000000-0000-4000-8000-000000000001'
        and weekday = 6
      returning 1
    )
    select count(*)::integer from removed
  $$,
  array[1],
  'weekly availability policy permits an owner DELETE'
);
select results_eq(
  $$
    with inserted as (
      insert into public.availabilities (
        id,
        user_id,
        weekday,
        start_time,
        end_time,
        buffer_minutes
      )
      values (
        '97200000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001',
        6,
        time '00:00',
        time '23:59',
        20
      )
      returning 1
    )
    select count(*)::integer from inserted
  $$,
  array[1],
  'weekly availability policy permits an owner INSERT'
);
select throws_ok(
  $$
    insert into public.availabilities (
      id,
      user_id,
      weekday,
      start_time,
      end_time,
      buffer_minutes
    )
    values (
      '97200000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000002',
      6,
      time '18:00',
      time '19:00',
      0
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "availabilities"',
  'weekly availability policy rejects a forged-owner INSERT'
);
select throws_ok(
  $$
    update public.availabilities
    set user_id = '90000000-0000-4000-8000-000000000002'
    where id = '97200000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'owner_immutable',
  'weekly availability trigger rejects ownership-changing UPDATE'
);
select results_eq(
  $$
    with inserted as (
      insert into public.specific_date_availabilities (
        id,
        user_id,
        date,
        status,
        note
      )
      values (
        '97300000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001',
        current_date + 1100,
        'default',
        'Owner CRUD matrix'
      )
      returning 1
    )
    select count(*)::integer from inserted
  $$,
  array[1],
  'specific-date policy permits an owner INSERT'
);
select throws_ok(
  $$
    insert into public.specific_date_availabilities (
      id,
      user_id,
      date,
      status
    )
    values (
      '97300000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000002',
      current_date + 1101,
      'default'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "specific_date_availabilities"',
  'specific-date policy rejects a forged-owner INSERT'
);
select throws_ok(
  $$
    update public.specific_date_availabilities
    set user_id = '90000000-0000-4000-8000-000000000002'
    where id = '97300000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'owner_immutable',
  'specific-date trigger rejects ownership-changing UPDATE'
);
select results_eq(
  $$
    with removed as (
      delete from public.specific_date_availabilities
      where id = '97300000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from removed
  $$,
  array[1],
  'specific-date policy permits an owner DELETE'
);
select throws_ok(
  $$update public.bookings set notes = notes where false$$,
  '42501',
  'permission denied for table bookings',
  'owner cannot bypass booking mutation RPCs with a direct write'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select is((select count(*)::integer from public.bookings), 0, 'other-owner RLS hides booking');
select is(
  (select count(*)::integer from public.profiles),
  1,
  'other owner SELECT sees exactly their profile'
);
select is(
  (select count(*)::integer from public.meeting_types),
  1,
  'other owner SELECT sees exactly their meeting type'
);
select is(
  (select count(*)::integer from public.availabilities),
  5,
  'other owner SELECT sees exactly their weekly availability rows'
);
select is(
  (select count(*)::integer from public.specific_date_availabilities),
  1,
  'other owner SELECT sees exactly their specific-date row'
);
select results_eq(
  $$
    with changed as (
      update public.profiles
      set full_name = full_name
      where id = '90000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'other owner cannot mutate the first owner profile'
);
select results_eq(
  $$
    with changed as (
      update public.meeting_types
      set description = description
      where id = '91000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'other owner cannot mutate the first owner meeting type'
);
select results_eq(
  $$
    with changed as (
      update public.availabilities
      set buffer_minutes = buffer_minutes
      where user_id = '90000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'other owner cannot mutate the first owner weekly availability'
);
select results_eq(
  $$
    with changed as (
      update public.specific_date_availabilities
      set note = note
      where id = '93000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from changed
  $$,
  array[0],
  'other owner cannot mutate the first owner specific-date availability'
);
select results_eq(
  $$
    with removed as (
      delete from public.meeting_types
      where id = '91000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from removed
  $$,
  array[0],
  'meeting type policy hides another owner row from DELETE'
);
select results_eq(
  $$
    with removed as (
      delete from public.availabilities
      where id = '97200000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from removed
  $$,
  array[0],
  'weekly availability policy hides another owner row from DELETE'
);
select results_eq(
  $$
    with removed as (
      delete from public.specific_date_availabilities
      where id = '93000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from removed
  $$,
  array[0],
  'specific-date policy hides another owner row from DELETE'
);
select throws_ok(
  $$update public.bookings set notes = notes where false$$,
  '42501',
  'permission denied for table bookings',
  'other owner cannot mutate bookings directly'
);
select throws_ok(
  $$select public.cancel_booking_v1(
    (
      select booking_id
      from booked_id_context
    ),
    1
  )$$,
  'PT404',
  'NOT_FOUND',
  'another owner cannot cancel or enumerate a booking'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select lives_ok(
  $$
    select public.set_weekly_schedule_v1((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', weekday,
          'enabled', weekday <> 0,
          'startTime', case when weekday = 0 then null else '08:00' end,
          'endTime', case when weekday = 0 then null else '12:00' end,
          'bufferMinutes', case when weekday = 0 then 0 else 10 end
        )
        order by weekday
      )
      from generate_series(0, 6) as weekday
    ))
  $$,
  'owner can atomically replace the complete weekly schedule'
);
select is(
  (
    select count(*)::integer
    from public.availabilities
  ),
  6,
  'disabled weekdays are represented by deleted rows'
);
select ok(
  (
    select bool_and(
      weekday between 1 and 6
      and start_time = time '08:00'
      and end_time = time '12:00'
      and buffer_minutes = 10
    )
    from public.availabilities
  ),
  'enabled weekdays store the validated complete replacement'
);
select throws_ok(
  $$
    select public.set_weekly_schedule_v1((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', case when weekday = 6 then 5 else weekday end,
          'enabled', true,
          'startTime', '09:00',
          'endTime', '17:00',
          'bufferMinutes', 0
        )
        order by weekday
      )
      from generate_series(0, 6) as weekday
    ))
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'duplicate and therefore missing weekdays are rejected before mutation'
);
select is(
  (select count(*)::integer from public.availabilities),
  6,
  'invalid duplicate payload leaves the previous schedule intact'
);
select ok(
  (
    select bool_and(
      weekday between 1 and 6
      and start_time = time '08:00'
      and end_time = time '12:00'
      and buffer_minutes = 10
    )
    from public.availabilities
  ),
  'invalid duplicate payload rolls back without partial replacement'
);
select throws_ok(
  $$
    select public.set_weekly_schedule_v1((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', weekday,
          'enabled', true,
          'startTime', '09:00',
          'endTime', '17:00',
          'bufferMinutes', 0
        )
        order by weekday
      )
      from generate_series(0, 5) as weekday
    ))
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'six-day payloads are rejected before mutation'
);
select throws_ok(
  $$
    select public.set_weekly_schedule_v1((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', weekday,
          'enabled', true,
          'startTime', case when weekday = 3 then '18:00' else '09:00' end,
          'endTime', '17:00',
          'bufferMinutes', 0,
          'unexpected', case when weekday = 3 then true else null end
        )
        order by weekday
      )
      from generate_series(0, 6) as weekday
    ))
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'unknown keys and malformed windows are rejected before mutation'
);
select lives_ok(
  $$
    select public.set_weekly_schedule_v1((
      select jsonb_agg(
        jsonb_build_object(
          'weekday', weekday,
          'enabled', true,
          'startTime', '00:00',
          'endTime', '23:59',
          'bufferMinutes', 20
        )
        order by weekday
      )
      from generate_series(0, 6) as weekday
    ))
  $$,
  'owner can atomically restore all seven weekdays'
);
select is(
  (select count(*)::integer from public.availabilities),
  7,
  'complete enabled schedule persists all seven rows'
);
select is(
  public.cancel_booking_v1(
    (
      select booking_id
      from booked_id_context
    ),
    1
  ) ->> 'status',
  'cancelled',
  'owner can soft-cancel with the expected version'
);
select is(
  (
    select version
    from public.bookings
    where idempotency_key = '92000000-0000-4000-8000-000000000001'
  ),
  2,
  'owner cancellation increments the optimistic version'
);
reset role;

insert into public.specific_date_availabilities (user_id, date, status)
select
  '90000000-0000-4000-8000-000000000001',
  display_date,
  'default'
from test_context;

select ok(
  jsonb_array_length(
    public.list_public_free_slots_v1(
      'test-owner',
      '91000000-0000-4000-8000-000000000001',
      (select display_date from test_context),
      'UTC'
    ) -> 'slots'
  ) > 0,
  'default specific-date row falls back to weekly availability'
);

update public.specific_date_availabilities
set status = 'unavailable'
where user_id = '90000000-0000-4000-8000-000000000001';

select is(
  jsonb_array_length(
    public.list_public_free_slots_v1(
      'test-owner',
      '91000000-0000-4000-8000-000000000001',
      (select display_date from test_context),
      'UTC'
    ) -> 'slots'
  ),
  0,
  'unavailable specific-date row suppresses weekly availability'
);

delete from public.specific_date_availabilities
where user_id = '90000000-0000-4000-8000-000000000001';
delete from public.availabilities
where user_id = '90000000-0000-4000-8000-000000000001';
update public.profiles
set timezone = 'America/Halifax'
where id = '90000000-0000-4000-8000-000000000001';
update public.meeting_types
set slot_interval_minutes = 30
where id = '91000000-0000-4000-8000-000000000001';

insert into public.specific_date_availabilities (
  user_id,
  date,
  status,
  start_time,
  end_time
)
values (
  '90000000-0000-4000-8000-000000000001',
  date '2027-03-14',
  'available',
  time '00:00',
  time '04:00'
);

select is(
  (
    select count(*)::integer
    from private.compute_free_slots_v1(
      'test-owner',
      '91000000-0000-4000-8000-000000000001',
      date '2027-03-14',
      'America/Halifax',
      timestamptz '2027-03-13 00:00:00+00'
    )
  ),
  5,
  'spring-forward skips nonexistent and wall-clock-distorted slots'
);
select is(
  (
    select count(*)::integer
    from private.compute_free_slots_v1(
      'test-owner',
      '91000000-0000-4000-8000-000000000001',
      date '2027-03-14',
      'America/Halifax',
      timestamptz '2027-03-13 00:00:00+00'
    ) as slot
    where extract(hour from slot.slot_start at time zone 'America/Halifax') = 2
  ),
  0,
  'spring-forward never emits the nonexistent local hour'
);

update public.specific_date_availabilities
set
  date = date '2027-11-07',
  start_time = time '00:00',
  end_time = time '03:00'
where user_id = '90000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)::integer
    from private.compute_free_slots_v1(
      'test-owner',
      '91000000-0000-4000-8000-000000000001',
      date '2027-11-07',
      'America/Halifax',
      timestamptz '2027-11-06 00:00:00+00'
    )
  ),
  7,
  'fall-back preserves real instants but excludes the distorted crossing slot'
);
select is(
  (
    select count(*)::integer
    from private.compute_free_slots_v1(
      'test-owner',
      '91000000-0000-4000-8000-000000000001',
      date '2027-11-07',
      'America/Halifax',
      timestamptz '2027-11-06 00:00:00+00'
    ) as slot
    where extract(hour from slot.slot_start at time zone 'America/Halifax') = 1
      and extract(minute from slot.slot_start at time zone 'America/Halifax') = 0
  ),
  2,
  'fall-back exposes both distinct 01:00 instants'
);

select ok(public.is_username_available_v1('new-valid-name'), 'unused username is available');
select ok(not public.is_username_available_v1('test-owner'), 'existing username is unavailable');
select ok(not public.is_username_available_v1('bad space'), 'invalid username is unavailable');

select * from finish();
rollback;
