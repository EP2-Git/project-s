begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select no_plan();

create temporary table test_agent_state (
  key text primary key,
  value jsonb not null
) on commit drop;

create function pg_temp.gateway_context(
  p_actor_kind text,
  p_transport text,
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
      'requestId', 'agent-test-request-0001',
      'actorKind', p_actor_kind,
      'transport', p_transport,
      'clientId', case
        when p_actor_kind = 'human' then 'project-s-confirmation-ui'
        else 'agent-test-client'
      end,
      'scopes', p_scopes,
      'provenance', jsonb_build_object(
        'source', p_source,
        'clientVersion', '0.1.0',
        'networkKeyHash', repeat('a', 64),
        'userAgentHash', repeat('b', 64)
      ),
      'confirmationGrant', p_grant
    )
  );
$$;

create function pg_temp.future_instant(
  p_days integer,
  p_hour integer
)
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select to_char(
    (
      current_date::timestamp
      + (p_days * interval '1 day')
      + (p_hour * interval '1 hour')
    ),
    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
  );
$$;

select has_table(
  'private',
  'booking_preparations',
  'private booking preparation storage exists'
);
select has_table(
  'private',
  'booking_confirmation_grants',
  'private one-use confirmation grant storage exists'
);
select has_table(
  'private',
  'booking_audit_events',
  'private append-only booking audit storage exists'
);
select has_table(
  'private',
  'public_rate_limit_buckets',
  'private HMAC rate bucket storage exists'
);

select has_function(
  'public',
  'get_gateway_booking_page_v1',
  array['jsonb', 'jsonb'],
  'canonical gateway booking-page RPC exists'
);
select has_function(
  'public',
  'prepare_public_booking_v1',
  array['jsonb', 'jsonb'],
  'gateway preparation RPC exists'
);
select has_function(
  'public',
  'get_public_booking_preparation_v1',
  array['jsonb', 'jsonb'],
  'gateway confirmation preview RPC exists'
);
select has_function(
  'public',
  'confirm_public_booking_preparation_v1',
  array['jsonb', 'jsonb'],
  'gateway confirmation recorder RPC exists'
);
select has_function(
  'public',
  'commit_prepared_booking_v1',
  array['jsonb', 'jsonb'],
  'gateway locked commit RPC exists'
);
select has_function(
  'public',
  'consume_public_rate_limit_v1',
  array['jsonb', 'jsonb'],
  'gateway reference limiter RPC exists'
);
select has_function(
  'public',
  'append_gateway_audit_event_v1',
  array['jsonb', 'jsonb'],
  'durable gateway outcome audit RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.prepare_public_booking_v1(jsonb,jsonb)',
    'execute'
  ),
  'service role can prepare through the gateway authority'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.get_public_booking_preparation_v1(jsonb,jsonb)',
    'execute'
  ),
  'service role can load the gateway confirmation preview'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.confirm_public_booking_preparation_v1(jsonb,jsonb)',
    'execute'
  ),
  'service role can record verified human confirmation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.commit_prepared_booking_v1(jsonb,jsonb)',
    'execute'
  ),
  'service role can commit a confirmed preparation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.append_gateway_audit_event_v1(jsonb,jsonb)',
    'execute'
  ),
  'service role can append a durable gateway outcome audit event'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.prepare_public_booking_v1(jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.prepare_public_booking_v1(jsonb,jsonb)',
    'execute'
  ),
  'browser roles cannot bypass the gateway preparation boundary'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.commit_prepared_booking_v1(jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.commit_prepared_booking_v1(jsonb,jsonb)',
    'execute'
  ),
  'browser roles cannot bypass confirmation and commit'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.append_gateway_audit_event_v1(jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.append_gateway_audit_event_v1(jsonb,jsonb)',
    'execute'
  ),
  'browser roles cannot forge gateway audit outcomes'
);
select ok(
  not has_table_privilege(
    'service_role',
    'private.booking_preparations',
    'select'
  )
  and not has_table_privilege(
    'service_role',
    'private.booking_confirmation_grants',
    'select'
  )
  and not has_table_privilege(
    'service_role',
    'private.booking_audit_events',
    'select'
  ),
  'service role has no direct private-table access'
);
select is(
  (
    select count(*)::integer
    from pg_class as table_row
    join pg_namespace as schema_row
      on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'private'
      and table_row.relname in (
        'scheduling_authority_versions',
        'booking_preparations',
        'booking_confirmation_grants',
        'booking_audit_events',
        'rate_limit_secrets',
        'public_rate_limit_policies',
        'public_rate_limit_buckets'
      )
      and table_row.relrowsecurity
      and table_row.relforcerowsecurity
  ),
  7,
  'every agent-native private table enables and forces RLS'
);

select lives_ok(
  $$
    select public.append_gateway_audit_event_v1(
      jsonb_build_object(
        'operationId', 'project-s.public.get_booking_page.v1',
        'outcome', 'success'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["booking_page:read"]'::jsonb
      )
    )
  $$,
  'gateway audit accepts a successful read outcome'
);
select lives_ok(
  $$
    select public.append_gateway_audit_event_v1(
      jsonb_build_object(
        'operationId', 'project-s.public.prepare_booking.v1',
        'outcome', 'rejected',
        'code', 'VALIDATION_ERROR'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:prepare"]'::jsonb
      )
    )
  $$,
  'gateway audit durably accepts a canonical rejected outcome'
);
select ok(
  exists (
    select 1
    from private.booking_audit_events
    where operation_id = 'project-s.public.get_booking_page.v1'
      and outcome = 'success'
      and reason_code is null
  )
  and exists (
    select 1
    from private.booking_audit_events
    where operation_id = 'project-s.public.prepare_booking.v1'
      and outcome = 'rejected'
      and reason_code = 'VALIDATION_ERROR'
  ),
  'read success and rejected mutation are persisted with bounded taxonomy'
);
select throws_ok(
  $$
    select public.append_gateway_audit_event_v1(
      jsonb_build_object(
        'operationId', 'project-s.public.prepare_booking.v1',
        'outcome', 'rejected',
        'code', 'VALIDATION_ERROR',
        'booker', jsonb_build_object(
          'email', 'must-not-enter-audit@example.invalid'
        )
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:prepare"]'::jsonb
      )
    )
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'gateway audit rejects request bodies and guest identity fields'
);
select throws_ok(
  $$
    select public.append_gateway_audit_event_v1(
      jsonb_build_object(
        'operationId', 'project-s.public.get_booking_page.v1',
        'outcome', 'failure',
        'code', 'FREE_FORM_FAILURE'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["booking_page:read"]'::jsonb
      )
    )
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'gateway audit rejects free-form reason codes'
);
select ok(
  not exists (
    select 1
    from private.booking_audit_events as audit_row
    where row_to_json(audit_row)::text ilike
      '%must-not-enter-audit@example.invalid%'
  ),
  'rejected audit input cannot persist guest PII'
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
  '97000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'agent-owner@example.invalid',
  extensions.crypt('test-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"agent-owner","full_name":"Agent Owner","timezone":"UTC"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
);

delete from public.availabilities
where user_id = '97000000-0000-4000-8000-000000000001';

insert into public.availabilities (
  user_id,
  weekday,
  start_time,
  end_time,
  buffer_minutes
)
select
  '97000000-0000-4000-8000-000000000001',
  weekday,
  time '08:00',
  time '18:00',
  0
from generate_series(0, 6) as weekday;

insert into public.meeting_types (
  id,
  user_id,
  title,
  description,
  duration_minutes,
  slot_interval_minutes,
  buffer_before_minutes,
  buffer_after_minutes,
  minimum_notice_minutes,
  maximum_advance_days,
  active
)
values (
  '97100000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  'Agent-safe call',
  'A synthetic agent-native contract fixture.',
  30,
  15,
  5,
  10,
  0,
  365,
  true
);

select is(
  (
    public.get_gateway_booking_page_v1(
      jsonb_build_object('username', 'agent-owner'),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["booking_page:read"]'::jsonb
      )
    ) #>> '{meetingTypes,0,minNoticeMinutes}'
  )::integer,
  0,
  'gateway page projects the true per-type minimum notice'
);
select is(
  (
    public.get_gateway_booking_page_v1(
      jsonb_build_object('username', 'agent-owner'),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["booking_page:read"]'::jsonb
      )
    ) #>> '{meetingTypes,0,maxAdvanceDays}'
  )::integer,
  365,
  'gateway page projects the true per-type booking horizon'
);

select throws_ok(
  $$
    select public.prepare_public_booking_v1(
      jsonb_build_object(
        'username', 'agent-owner',
        'meetingTypeId', '97100000-0000-4000-8000-000000000001',
        'startAt', pg_temp.future_instant(7, 9),
        'guestTimeZone', 'UTC',
        'ownerId', '97000000-0000-4000-8000-000000000001',
        'booker', jsonb_build_object(
          'name', 'Agent Guest',
          'email', 'agent-guest@example.invalid'
        )
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:prepare"]'::jsonb
      )
    )
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'caller-supplied owner authority is rejected'
);

select throws_ok(
  $$
    select public.prepare_public_booking_v1(
      jsonb_build_object(
        'username', 'agent-owner',
        'meetingTypeId', '97100000-0000-4000-8000-000000000001',
        'startAt', replace(pg_temp.future_instant(7, 9), 'Z', '.1234567Z'),
        'guestTimeZone', 'UTC',
        'booker', jsonb_build_object(
          'name', 'Agent Guest',
          'email', 'precision-parity@example.invalid'
        )
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:prepare"]'::jsonb
      )
    )
  $$,
  'PT400',
  'VALIDATION_ERROR',
  'authority rejects instant precision beyond the public six-digit maximum'
);

select throws_ok(
  $$
    select public.prepare_public_booking_v1(
      jsonb_build_object(
        'username', 'agent-owner',
        'meetingTypeId', '97100000-0000-4000-8000-000000000001',
        'startAt', pg_temp.future_instant(7, 9),
        'guestTimeZone', 'UTC',
        'booker', jsonb_build_object(
          'name', 'Agent Guest',
          'email', 'agent-guest@example.invalid'
        )
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["slots:read"]'::jsonb
      )
    )
  $$,
  'PT403',
  'INSUFFICIENT_SCOPE',
  'preparation requires its verified gateway scope'
);

insert into test_agent_state (key, value)
values (
  'primary',
  public.prepare_public_booking_v1(
    jsonb_build_object(
      'username', 'agent-owner',
      'meetingTypeId', '97100000-0000-4000-8000-000000000001',
      'startAt', pg_temp.future_instant(7, 9),
      'guestTimeZone', 'UTC',
      'booker', jsonb_build_object(
        'name', 'Agent Guest',
        'email', 'agent-guest@example.invalid',
        'notes', 'Private preparation note'
      )
    ),
    pg_temp.gateway_context(
      'anonymous',
      'http',
      'project_s_sdk',
      '["bookings:prepare","bookings:create"]'::jsonb
    )
  )
);

select matches(
  (select value ->> 'preparationToken' from test_agent_state where key = 'primary'),
  '^[0-9a-f]{64}$',
  'preparation returns a 64-character opaque capability token'
);
select is(
  (select value ->> 'notHeld' from test_agent_state where key = 'primary'),
  'true',
  'preparation explicitly states that the slot is not held'
);
select is(
  (
    public.get_public_booking_preparation_v1(
      jsonb_build_object(
        'preparationToken', (
          select value ->> 'preparationToken'
          from test_agent_state
          where key = 'primary'
        )
      ),
      pg_temp.gateway_context(
        'human',
        'ui',
        'project_s_ui',
        '["bookings:prepare"]'::jsonb
      )
    ) #>> '{summary,booker,email}'
  ),
  'agent-guest@example.invalid',
  'confirmation preview returns only the requester own stored summary'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.list_public_free_slots_v1(
        'agent-owner',
        '97100000-0000-4000-8000-000000000001',
        (current_date + 7),
        'UTC'
      ) -> 'slots'
    ) as slot_row(slot_value)
    where slot_row.slot_value ->> 'startAt'
      = (select value #>> '{summary,startAt}' from test_agent_state where key = 'primary')
  ),
  'preparation does not reserve or hide the slot'
);
select ok(
  not exists (
    select 1
    from private.booking_preparations as preparation_row
    cross join test_agent_state as state_row
    where state_row.key = 'primary'
      and row_to_json(preparation_row)::text like
        '%' || (state_row.value ->> 'preparationToken') || '%'
  ),
  'the raw preparation token is never stored'
);

select throws_ok(
  $$
    select public.commit_prepared_booking_v1(
      jsonb_build_object(
        'preparationToken', (
          select value ->> 'preparationToken'
          from test_agent_state
          where key = 'primary'
        ),
        'idempotencyKey', '97200000-0000-4000-8000-000000000001'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:create"]'::jsonb
      )
    )
  $$,
  'PT409',
  'CONFIRMATION_REQUIRED',
  'commit refuses an unconfirmed preparation'
);

select throws_ok(
  $$
    select public.commit_prepared_booking_v1(
      jsonb_build_object(
        'preparationToken', (
          select value ->> 'preparationToken'
          from test_agent_state
          where key = 'primary'
        ),
        'idempotencyKey', '97200000-0000-4000-8000-000000000001'
      ),
      pg_temp.gateway_context(
        'service',
        'internal',
        'internal',
        '["bookings:create"]'::jsonb
      )
    )
  $$,
  'PT409',
  'PREPARATION_MISMATCH',
  'commit is bound to the server-derived preparing actor'
);

insert into test_agent_state (key, value)
values (
  'primary-grant',
  jsonb_build_object(
    'grantId', '97300000-0000-4000-8000-000000000001',
    'confirmedAt', to_char(
      clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'method', 'verified_challenge',
    'challengeId', 'challenge-primary-0001'
  )
);

insert into test_agent_state (key, value)
values (
  'primary-confirmation',
  public.confirm_public_booking_preparation_v1(
    jsonb_build_object(
      'preparationToken', (
        select value ->> 'preparationToken'
        from test_agent_state
        where key = 'primary'
      )
    ),
    pg_temp.gateway_context(
      'human',
      'ui',
      'project_s_ui',
      '["bookings:create"]'::jsonb,
      (select value from test_agent_state where key = 'primary-grant')
    )
  )
);

select is(
  (
    select array_agg(key_name order by key_name)
    from test_agent_state as state_row,
      lateral jsonb_object_keys(state_row.value) as key_row(key_name)
    where state_row.key = 'primary-confirmation'
  ),
  array['confirmedAt', 'grantId', 'method', 'preparationId'],
  'confirmation result has only the internal support contract fields'
);
insert into test_agent_state (key, value)
values (
  'primary-confirmation-retry-grant',
  jsonb_build_object(
    'grantId', '97300000-0000-4000-8000-000000000099',
    'confirmedAt', to_char(
      clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'method', 'verified_challenge',
    'challengeId', 'challenge-primary-retry-0001'
  )
);
select is(
  public.confirm_public_booking_preparation_v1(
    jsonb_build_object(
      'preparationToken', (
        select value ->> 'preparationToken'
        from test_agent_state
        where key = 'primary'
      )
    ),
    pg_temp.gateway_context(
      'human',
      'ui',
      'project_s_ui',
      '["bookings:create"]'::jsonb,
      (
        select value
        from test_agent_state
        where key = 'primary-confirmation-retry-grant'
      )
    )
  ),
  (select value from test_agent_state where key = 'primary-confirmation'),
  'lost confirmation response retry returns the existing durable grant'
);
select is(
  (
    select count(*)::integer
    from private.booking_confirmation_grants
    where preparation_id = (
      select (value ->> 'preparationId')::uuid
      from test_agent_state
      where key = 'primary'
    )
  ),
  1,
  'confirmation retry with a fresh proposed ID never duplicates the grant'
);

insert into test_agent_state (key, value)
values (
  'primary-commit',
  public.commit_prepared_booking_v1(
    jsonb_build_object(
      'preparationToken', (
        select value ->> 'preparationToken'
        from test_agent_state
        where key = 'primary'
      ),
      'idempotencyKey', '97200000-0000-4000-8000-000000000001'
    ),
    pg_temp.gateway_context(
      'anonymous',
      'http',
      'project_s_sdk',
      '["bookings:create"]'::jsonb
    )
  )
);

select is(
  (
    select array_agg(key_name order by key_name)
    from test_agent_state as state_row,
      lateral jsonb_object_keys(state_row.value) as key_row(key_name)
    where state_row.key = 'primary-commit'
  ),
  array[
    'confirmationCode',
    'endAt',
    'guestTimeZone',
    'hostTimeZone',
    'idempotencyKey',
    'meetingTypeId',
    'meetingTypeTitle',
    'startAt',
    'status',
    'username'
  ],
  'commit result exactly matches the frozen raw create data contract'
);
select is(
  (
    select count(*)::integer
    from public.bookings
    where preparation_id = (
      select (value ->> 'preparationId')::uuid
      from test_agent_state
      where key = 'primary'
    )
  ),
  1,
  'confirmed preparation inserts exactly one booking'
);
select ok(
  (
    select state = 'committed'
      and booker_name is null
      and booker_email is null
      and notes is null
    from private.booking_preparations
    where id = (
      select (value ->> 'preparationId')::uuid
      from test_agent_state
      where key = 'primary'
    )
  ),
  'committed preparation redacts its duplicated guest PII'
);
select ok(
  (
    select consumed_at is not null
      and consumed_by_booking_id is not null
    from private.booking_confirmation_grants
    where id = '97300000-0000-4000-8000-000000000001'
  ),
  'confirmation grant is consumed by the booking atomically'
);
select ok(
  not exists (
    select 1
    from private.booking_audit_events as audit_row
    where row_to_json(audit_row)::text ilike '%agent-guest@example.invalid%'
       or row_to_json(audit_row)::text ilike '%private preparation note%'
       or row_to_json(audit_row)::text like '%' || (
         select value ->> 'preparationToken'
         from test_agent_state
         where key = 'primary'
       ) || '%'
  ),
  'audit rows contain no guest email, notes, or raw capability token'
);
select throws_ok(
  $$
    update private.booking_audit_events
    set outcome = outcome
    where preparation_id = (
      select (value ->> 'preparationId')::uuid
      from test_agent_state
      where key = 'primary'
    )
  $$,
  '55000',
  'audit_events_are_append_only',
  'booking audit events reject updates'
);

-- A schedule-authority change after confirmation invalidates the preparation,
-- but does not consume its one-use grant.
insert into test_agent_state (key, value)
values (
  'stale',
  public.prepare_public_booking_v1(
    jsonb_build_object(
      'username', 'agent-owner',
      'meetingTypeId', '97100000-0000-4000-8000-000000000001',
      'startAt', pg_temp.future_instant(7, 11),
      'guestTimeZone', 'UTC',
      'booker', jsonb_build_object(
        'name', 'Stale Guest',
        'email', 'stale-guest@example.invalid'
      )
    ),
    pg_temp.gateway_context(
      'anonymous',
      'http',
      'project_s_sdk',
      '["bookings:prepare","bookings:create"]'::jsonb
    )
  )
);
insert into test_agent_state (key, value)
values (
  'stale-grant',
  jsonb_build_object(
    'grantId', '97300000-0000-4000-8000-000000000002',
    'confirmedAt', to_char(
      clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'method', 'human_browser'
  )
);
select public.confirm_public_booking_preparation_v1(
  jsonb_build_object(
    'preparationToken', (
      select value ->> 'preparationToken'
      from test_agent_state
      where key = 'stale'
    )
  ),
  pg_temp.gateway_context(
    'human',
    'ui',
    'project_s_ui',
    '["bookings:create"]'::jsonb,
    (select value from test_agent_state where key = 'stale-grant')
  )
);

update public.meeting_types
set title = 'Agent-safe call revised'
where id = '97100000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    select public.commit_prepared_booking_v1(
      jsonb_build_object(
        'preparationToken', (
          select value ->> 'preparationToken'
          from test_agent_state
          where key = 'stale'
        ),
        'idempotencyKey', '97200000-0000-4000-8000-000000000002'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:create"]'::jsonb
      )
    )
  $$,
  'PT409',
  'PREPARATION_STALE',
  'authority revision changes reject a confirmed stale preparation'
);
select ok(
  (
    select consumed_at is null
    from private.booking_confirmation_grants
    where id = '97300000-0000-4000-8000-000000000002'
  ),
  'stale rejection leaves the confirmation grant unconsumed'
);

-- Expiry and token tamper produce stable, non-oracular errors.
insert into test_agent_state (key, value)
values (
  'expired',
  public.prepare_public_booking_v1(
    jsonb_build_object(
      'username', 'agent-owner',
      'meetingTypeId', '97100000-0000-4000-8000-000000000001',
      'startAt', pg_temp.future_instant(7, 13),
      'guestTimeZone', 'UTC',
      'booker', jsonb_build_object(
        'name', 'Expired Guest',
        'email', 'expired-guest@example.invalid'
      )
    ),
    pg_temp.gateway_context(
      'anonymous',
      'http',
      'project_s_sdk',
      '["bookings:prepare","bookings:create"]'::jsonb
    )
  )
);
insert into test_agent_state (key, value)
values (
  'expired-grant',
  jsonb_build_object(
    'grantId', '97300000-0000-4000-8000-000000000003',
    'confirmedAt', to_char(
      clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'method', 'human_browser'
  )
);
select public.confirm_public_booking_preparation_v1(
  jsonb_build_object(
    'preparationToken', (
      select value ->> 'preparationToken'
      from test_agent_state
      where key = 'expired'
    )
  ),
  pg_temp.gateway_context(
    'human',
    'ui',
    'project_s_ui',
    '["bookings:create"]'::jsonb,
    (select value from test_agent_state where key = 'expired-grant')
  )
);
update private.booking_preparations
set
  created_at = clock_timestamp() - interval '20 minutes',
  confirmed_at = clock_timestamp() - interval '15 minutes',
  expires_at = clock_timestamp() - interval '10 minutes'
where id = (
  select (value ->> 'preparationId')::uuid
  from test_agent_state
  where key = 'expired'
);
update private.booking_confirmation_grants
set
  confirmed_at = clock_timestamp() - interval '15 minutes',
  expires_at = clock_timestamp() - interval '10 minutes'
where id = '97300000-0000-4000-8000-000000000003';

select throws_ok(
  $$
    select public.get_public_booking_preparation_v1(
      jsonb_build_object(
        'preparationToken', (
          select value ->> 'preparationToken'
          from test_agent_state
          where key = 'expired'
        )
      ),
      pg_temp.gateway_context(
        'human',
        'ui',
        'project_s_ui',
        '["bookings:prepare"]'::jsonb
      )
    )
  $$,
  'PT410',
  'PREPARATION_EXPIRED',
  'expired preparation cannot be previewed for confirmation'
);
select throws_ok(
  $$
    select public.commit_prepared_booking_v1(
      jsonb_build_object(
        'preparationToken', repeat('0', 64),
        'idempotencyKey', '97200000-0000-4000-8000-000000000003'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:create"]'::jsonb
      )
    )
  $$,
  'PT409',
  'PREPARATION_MISMATCH',
  'tampered opaque token reveals no preparation details'
);

-- Exact replay wins before current expiry, rename, active-state, revision, or
-- grant-consumption checks.
update public.profiles
set username = 'agent-owner-renamed'
where id = '97000000-0000-4000-8000-000000000001';
update public.meeting_types
set active = false
where id = '97100000-0000-4000-8000-000000000001';
update private.booking_preparations
set expires_at = greatest(
  created_at + interval '1 microsecond',
  clock_timestamp() - interval '1 microsecond'
)
where id = (
  select (value ->> 'preparationId')::uuid
  from test_agent_state
  where key = 'primary'
);

select is(
  public.commit_prepared_booking_v1(
    jsonb_build_object(
      'preparationToken', (
        select value ->> 'preparationToken'
        from test_agent_state
        where key = 'primary'
      ),
      'idempotencyKey', '97200000-0000-4000-8000-000000000001'
    ),
    pg_temp.gateway_context(
      'anonymous',
      'stdio_mcp',
      'project_s_mcp',
      '["bookings:create"]'::jsonb
    )
  ),
  (select value from test_agent_state where key = 'primary-commit'),
  'cross-transport exact replay returns the immutable original confirmation'
);
select throws_ok(
  $$
    select public.commit_prepared_booking_v1(
      jsonb_build_object(
        'preparationToken', (
          select value ->> 'preparationToken'
          from test_agent_state
          where key = 'primary'
        ),
        'idempotencyKey', '97200000-0000-4000-8000-000000000099'
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["bookings:create"]'::jsonb
      )
    )
  $$,
  'PT409',
  'PREPARATION_ALREADY_COMMITTED',
  'one preparation cannot commit under a second idempotency key'
);

insert into private.public_rate_limit_buckets (
  operation_id,
  subject_digest,
  window_started_at,
  expires_at,
  request_count,
  updated_at
)
values (
  'project-s.public.get_booking_page.v1',
  extensions.digest('expired-rate-fixture', 'sha256'),
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '1 hour',
  1,
  clock_timestamp() - interval '2 hours'
);

with rate_calls as materialized (
  select
    call_number,
    public.consume_public_rate_limit_v1(
      jsonb_build_object(
        'operationId', 'project-s.public.get_booking_page.v1',
        'bucketMaterial', jsonb_build_object(
          'networkKeyHash', repeat('c', 64),
          'usernameHash', repeat('d', 64)
        )::text
      ),
      pg_temp.gateway_context(
        'anonymous',
        'http',
        'project_s_sdk',
        '["booking_page:read"]'::jsonb
      )
    ) as result
  from generate_series(1, 121) as call_number
)
insert into test_agent_state (key, value)
select 'rate-denial', result
from rate_calls
order by call_number desc
limit 1;

select is(
  (select value ->> 'allowed' from test_agent_state where key = 'rate-denial'),
  'false',
  'rate limiter persists and denies the first request beyond policy'
);
select is(
  (
    select max(request_count)
    from private.public_rate_limit_buckets
    where operation_id = 'project-s.public.get_booking_page.v1'
  ),
  121,
  'rate bucket atomically records denied attempts'
);
select ok(
  not exists (
    select 1
    from private.public_rate_limit_buckets as bucket_row
    where row_to_json(bucket_row)::text like '%' || repeat('c', 64) || '%'
  ),
  'rate buckets store only a keyed digest, never gateway bucket material'
);
select ok(
  not exists (
    select 1
    from private.public_rate_limit_buckets
    where subject_digest = extensions.digest('expired-rate-fixture', 'sha256')
  ),
  'limiter transaction opportunistically deletes expired rate buckets'
);
select ok(
  not exists (
    select 1
    from private.booking_preparations
    where id = (
      select (value ->> 'preparationId')::uuid
      from test_agent_state
      where key = 'expired'
    )
  )
  and not exists (
    select 1
    from private.booking_confirmation_grants
    where id = '97300000-0000-4000-8000-000000000003'
  ),
  'limiter transaction deletes expired uncommitted grant and preparation PII'
);
select ok(
  exists (
    select 1
    from private.booking_preparations
    where id = (
      select (value ->> 'preparationId')::uuid
      from test_agent_state
      where key = 'primary'
    )
      and state = 'committed'
      and booker_name is null
      and booker_email is null
      and notes is null
  ),
  'cleanup retains committed replay state with duplicated PII redacted'
);
select is(
  public.commit_prepared_booking_v1(
    jsonb_build_object(
      'preparationToken', (
        select value ->> 'preparationToken'
        from test_agent_state
        where key = 'primary'
      ),
      'idempotencyKey', '97200000-0000-4000-8000-000000000001'
    ),
    pg_temp.gateway_context(
      'anonymous',
      'stdio_mcp',
      'project_s_mcp',
      '["bookings:create"]'::jsonb
    )
  ),
  (select value from test_agent_state where key = 'primary-commit'),
  'cleanup preserves exact committed replay after expiry'
);

select * from finish();
rollback;
