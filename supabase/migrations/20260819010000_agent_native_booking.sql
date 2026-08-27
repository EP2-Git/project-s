-- Agent-native public booking authority.
--
-- These RPCs are an internal PostgREST boundary for the Project S gateway. They
-- are deliberately not part of the public client contract and are executable
-- only by Supabase's service_role. The gateway owns HTTP envelopes, challenge
-- verification, and construction of the server-derived execution context.

begin;

set local search_path = pg_catalog, public, private, extensions;

create table private.scheduling_authority_versions (
  owner_id uuid primary key references public.profiles (id) on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default statement_timestamp(),
  constraint scheduling_authority_versions_revision_positive
    check (revision > 0)
);

insert into private.scheduling_authority_versions (owner_id)
select profile_row.id
from public.profiles as profile_row
on conflict (owner_id) do nothing;

create table private.booking_preparations (
  id uuid primary key default extensions.gen_random_uuid(),
  token_digest bytea not null unique,
  owner_id uuid not null,
  meeting_type_id uuid not null,
  username text not null,
  host_display_name text not null,
  meeting_type_title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  host_timezone text not null,
  guest_timezone text not null,
  booker_name text,
  booker_email text,
  notes text,
  request_fingerprint bytea not null,
  summary_fingerprint bytea not null,
  actor_fingerprint bytea not null,
  authority_revision bigint not null,
  audience text not null default 'project-s.public-booking.v1',
  state text not null default 'prepared',
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint booking_preparations_token_digest_shape
    check (octet_length(token_digest) = 32),
  constraint booking_preparations_request_fingerprint_shape
    check (octet_length(request_fingerprint) = 32),
  constraint booking_preparations_summary_fingerprint_shape
    check (octet_length(summary_fingerprint) = 32),
  constraint booking_preparations_actor_fingerprint_shape
    check (octet_length(actor_fingerprint) = 32),
  constraint booking_preparations_authority_revision_positive
    check (authority_revision > 0),
  constraint booking_preparations_audience
    check (audience = 'project-s.public-booking.v1'),
  constraint booking_preparations_state
    check (state in ('prepared', 'confirmed', 'committed')),
  constraint booking_preparations_expiry_order
    check (expires_at > created_at),
  constraint booking_preparations_time_order
    check (end_time > start_time),
  constraint booking_preparations_state_shape check (
    (
      state = 'prepared'
      and confirmed_at is null
      and committed_at is null
      and booker_name is not null
      and booker_email is not null
    )
    or
    (
      state = 'confirmed'
      and confirmed_at is not null
      and committed_at is null
      and booker_name is not null
      and booker_email is not null
    )
    or
    (
      state = 'committed'
      and confirmed_at is not null
      and committed_at is not null
      and booker_name is null
      and booker_email is null
      and notes is null
    )
  )
);

create index booking_preparations_expiry_idx
  on private.booking_preparations (expires_at)
  where state <> 'committed';

create index booking_preparations_owner_created_idx
  on private.booking_preparations (owner_id, created_at desc);

alter table public.bookings
  add column preparation_id uuid,
  add constraint bookings_preparation_fkey
    foreign key (preparation_id)
    references private.booking_preparations (id)
    on delete restrict,
  add constraint bookings_preparation_key unique (preparation_id);

create table private.booking_confirmation_grants (
  id uuid primary key,
  preparation_id uuid not null unique
    references private.booking_preparations (id) on delete restrict,
  audience text not null,
  summary_fingerprint bytea not null,
  confirmer_actor_fingerprint bytea not null,
  method text not null,
  challenge_digest bytea,
  confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by_booking_id uuid references public.bookings (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint booking_confirmation_grants_audience
    check (audience = 'project-s.public-booking.v1'),
  constraint booking_confirmation_grants_summary_fingerprint_shape
    check (octet_length(summary_fingerprint) = 32),
  constraint booking_confirmation_grants_actor_fingerprint_shape
    check (octet_length(confirmer_actor_fingerprint) = 32),
  constraint booking_confirmation_grants_method
    check (method in ('human_browser', 'verified_challenge')),
  constraint booking_confirmation_grants_challenge_shape check (
    challenge_digest is null or octet_length(challenge_digest) = 32
  ),
  constraint booking_confirmation_grants_expiry_order
    check (expires_at > confirmed_at),
  constraint booking_confirmation_grants_consumption_shape check (
    (consumed_at is null and consumed_by_booking_id is null)
    or
    (consumed_at is not null and consumed_by_booking_id is not null)
  )
);

create table private.booking_audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  request_id text not null,
  operation_id text not null,
  contract_version smallint not null default 1,
  actor_kind text not null,
  transport text not null,
  actor_fingerprint bytea not null,
  client_digest bytea,
  principal_digest bytea,
  subject_digest bytea,
  on_behalf_of_digest bytea,
  delegation_digest bytea,
  provenance_digest bytea not null,
  scopes text[] not null default '{}'::text[],
  confirmation_grant_id uuid,
  preparation_id uuid,
  resource_digest bytea,
  idempotency_digest bytea,
  outcome text not null,
  reason_code text,
  constraint booking_audit_events_contract_version
    check (contract_version = 1),
  constraint booking_audit_events_outcome
    check (outcome in (
      'prepared',
      'confirmed',
      'committed',
      'success',
      'rejected',
      'failure'
    )),
  constraint booking_audit_events_reason_code check (
    reason_code is null
    or reason_code in (
      'VALIDATION_ERROR',
      'INVALID_TIME_ZONE',
      'NOT_FOUND',
      'MEETING_TYPE_UNAVAILABLE',
      'SLOT_UNAVAILABLE',
      'OUTSIDE_BOOKING_WINDOW',
      'AUTHENTICATION_REQUIRED',
      'FORBIDDEN',
      'INSUFFICIENT_SCOPE',
      'CONFIRMATION_REQUIRED',
      'PREPARATION_EXPIRED',
      'PREPARATION_MISMATCH',
      'PREPARATION_STALE',
      'PREPARATION_ALREADY_COMMITTED',
      'IDEMPOTENCY_KEY_REUSED',
      'VERSION_CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR'
    )
  ),
  constraint booking_audit_events_gateway_outcome_shape check (
    (outcome in ('prepared', 'confirmed', 'committed') and reason_code is null)
    or (outcome = 'success' and reason_code is null)
    or (outcome in ('rejected', 'failure') and reason_code is not null)
  ),
  constraint booking_audit_events_digest_shapes check (
    octet_length(actor_fingerprint) = 32
    and (client_digest is null or octet_length(client_digest) = 32)
    and (principal_digest is null or octet_length(principal_digest) = 32)
    and (subject_digest is null or octet_length(subject_digest) = 32)
    and (on_behalf_of_digest is null or octet_length(on_behalf_of_digest) = 32)
    and (delegation_digest is null or octet_length(delegation_digest) = 32)
    and octet_length(provenance_digest) = 32
    and (resource_digest is null or octet_length(resource_digest) = 32)
    and (idempotency_digest is null or octet_length(idempotency_digest) = 32)
  )
);

create index booking_audit_events_preparation_idx
  on private.booking_audit_events (preparation_id, occurred_at);

create table private.rate_limit_secrets (
  singleton boolean primary key default true,
  hmac_key bytea not null default extensions.gen_random_bytes(32),
  created_at timestamptz not null default statement_timestamp(),
  constraint rate_limit_secrets_singleton check (singleton),
  constraint rate_limit_secrets_key_shape check (octet_length(hmac_key) = 32)
);

insert into private.rate_limit_secrets (singleton)
values (true)
on conflict (singleton) do nothing;

create table private.public_rate_limit_policies (
  operation_id text primary key,
  request_limit integer not null,
  window_seconds integer not null,
  constraint public_rate_limit_policies_limit_positive
    check (request_limit > 0),
  constraint public_rate_limit_policies_window_range
    check (window_seconds between 1 and 86400)
);

insert into private.public_rate_limit_policies (
  operation_id,
  request_limit,
  window_seconds
)
values
  ('project-s.public.get_booking_page.v1', 120, 60),
  ('project-s.public.list_free_slots.v1', 60, 60),
  ('project-s.public.prepare_booking.v1', 10, 600),
  ('project-s.public.create_booking.v1', 10, 600);

create table private.public_rate_limit_buckets (
  operation_id text not null
    references private.public_rate_limit_policies (operation_id) on delete restrict,
  subject_digest bytea not null,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, subject_digest, window_started_at),
  constraint public_rate_limit_buckets_subject_digest_shape
    check (octet_length(subject_digest) = 32),
  constraint public_rate_limit_buckets_count_positive
    check (request_count > 0),
  constraint public_rate_limit_buckets_expiry_order
    check (expires_at > window_started_at)
);

create index public_rate_limit_buckets_expiry_idx
  on private.public_rate_limit_buckets (expires_at);

alter table private.scheduling_authority_versions enable row level security;
alter table private.scheduling_authority_versions force row level security;
alter table private.booking_preparations enable row level security;
alter table private.booking_preparations force row level security;
alter table private.booking_confirmation_grants enable row level security;
alter table private.booking_confirmation_grants force row level security;
alter table private.booking_audit_events enable row level security;
alter table private.booking_audit_events force row level security;
alter table private.rate_limit_secrets enable row level security;
alter table private.rate_limit_secrets force row level security;
alter table private.public_rate_limit_policies enable row level security;
alter table private.public_rate_limit_policies force row level security;
alter table private.public_rate_limit_buckets enable row level security;
alter table private.public_rate_limit_buckets force row level security;

create or replace function private.bump_scheduling_authority_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_owner_id uuid;
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    v_owner_id := new.id;
  elsif tg_op = 'DELETE' then
    v_owner_id := old.user_id;
  else
    v_owner_id := new.user_id;
  end if;

  -- Cascading profile deletion can remove the parent and version row before a
  -- child-table AFTER DELETE trigger runs. There is no authority state left to
  -- revise in that case.
  if not exists (
    select 1
    from public.profiles as profile_row
    where profile_row.id = v_owner_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  insert into private.scheduling_authority_versions (
    owner_id,
    revision,
    updated_at
  )
  values (v_owner_id, 1, statement_timestamp())
  on conflict (owner_id) do update
  set
    revision = private.scheduling_authority_versions.revision + 1,
    updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_bump_scheduling_authority_revision
after insert or update of username, full_name, timezone on public.profiles
for each row execute function private.bump_scheduling_authority_revision();

create trigger meeting_types_bump_scheduling_authority_revision
after insert or update or delete on public.meeting_types
for each row execute function private.bump_scheduling_authority_revision();

create trigger availabilities_bump_scheduling_authority_revision
after insert or update or delete on public.availabilities
for each row execute function private.bump_scheduling_authority_revision();

create trigger specific_dates_bump_scheduling_authority_revision
after insert or update or delete on public.specific_date_availabilities
for each row execute function private.bump_scheduling_authority_revision();

create or replace function private.reject_booking_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'audit_events_are_append_only';
end;
$$;

create trigger booking_audit_events_append_only
before update or delete on private.booking_audit_events
for each row execute function private.reject_booking_audit_mutation();

create or replace function private.validate_gateway_execution_context_v1(
  p_context jsonb,
  p_required_scope text default null,
  p_require_confirmation_grant boolean default false
)
returns void
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  v_provenance jsonb;
  v_grant jsonb;
begin
  if p_context is null or jsonb_typeof(p_context) <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_context) as context_key(key_name)
    where context_key.key_name not in (
      'requestId',
      'actorKind',
      'transport',
      'clientId',
      'principalId',
      'subjectId',
      'onBehalfOf',
      'delegationId',
      'scopes',
      'provenance',
      'confirmationGrant'
    )
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if not (
    p_context ? 'requestId'
    and p_context ? 'actorKind'
    and p_context ? 'transport'
    and p_context ? 'scopes'
    and p_context ? 'provenance'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if jsonb_typeof(p_context -> 'requestId') <> 'string'
     or (p_context ->> 'requestId') !~ '^[A-Za-z0-9._~-]{8,128}$'
     or jsonb_typeof(p_context -> 'actorKind') <> 'string'
     or (p_context ->> 'actorKind') not in (
       'anonymous', 'human', 'api_client', 'service', 'delegated_agent'
     )
     or jsonb_typeof(p_context -> 'transport') <> 'string'
     or (p_context ->> 'transport') not in (
       'ui', 'http', 'stdio_mcp', 'streamable_http_mcp', 'internal'
     )
     or jsonb_typeof(p_context -> 'scopes') <> 'array'
     or jsonb_array_length(p_context -> 'scopes') > 4 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_context -> 'scopes') as scope_row(scope_value)
    where jsonb_typeof(scope_row.scope_value) <> 'string'
      or scope_row.scope_value #>> '{}' not in (
        'booking_page:read',
        'slots:read',
        'bookings:prepare',
        'bookings:create'
      )
  ) or (
    select count(*)
    from jsonb_array_elements_text(p_context -> 'scopes') as scope_text(value)
  ) <> (
    select count(distinct scope_text.value)
    from jsonb_array_elements_text(p_context -> 'scopes') as scope_text(value)
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if p_required_scope is not null
     and not (p_context -> 'scopes') ? p_required_scope then
    raise exception using errcode = 'PT403', message = 'INSUFFICIENT_SCOPE';
  end if;

  if p_context ? 'clientId' and (
    jsonb_typeof(p_context -> 'clientId') <> 'string'
    or (p_context ->> 'clientId') !~ '^[A-Za-z0-9._~:@/-]{1,128}$'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_each(p_context) as context_entry(key_name, field_value)
    where context_entry.key_name in (
      'principalId', 'subjectId', 'onBehalfOf', 'delegationId'
    )
      and (
        jsonb_typeof(context_entry.field_value) <> 'string'
        or context_entry.field_value #>> '{}' !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      )
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_provenance := p_context -> 'provenance';
  if jsonb_typeof(v_provenance) <> 'object'
     or not (v_provenance ? 'source')
     or jsonb_typeof(v_provenance -> 'source') <> 'string'
     or (v_provenance ->> 'source') not in (
       'project_s_ui', 'project_s_sdk', 'project_s_mcp', 'internal'
     )
     or exists (
       select 1
       from jsonb_object_keys(v_provenance) as provenance_key(key_name)
       where provenance_key.key_name not in (
         'source', 'clientVersion', 'userAgentHash', 'networkKeyHash'
       )
     ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if v_provenance ? 'clientVersion' and (
    jsonb_typeof(v_provenance -> 'clientVersion') <> 'string'
    or char_length(v_provenance ->> 'clientVersion') not between 1 and 64
    or (v_provenance ->> 'clientVersion') ~ '[[:cntrl:]]'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_each(v_provenance) as provenance_entry(key_name, field_value)
    where provenance_entry.key_name in ('userAgentHash', 'networkKeyHash')
      and (
        jsonb_typeof(provenance_entry.field_value) <> 'string'
        or provenance_entry.field_value #>> '{}' !~ '^[0-9a-f]{64}$'
      )
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if p_context ? 'confirmationGrant' then
    v_grant := p_context -> 'confirmationGrant';
    if jsonb_typeof(v_grant) <> 'object'
       or not (
         v_grant ? 'grantId'
         and v_grant ? 'confirmedAt'
         and v_grant ? 'method'
       )
       or exists (
         select 1
         from jsonb_object_keys(v_grant) as grant_key(key_name)
         where grant_key.key_name not in (
           'grantId', 'confirmedAt', 'method', 'challengeId'
         )
       )
       or jsonb_typeof(v_grant -> 'grantId') <> 'string'
       or (v_grant ->> 'grantId') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       or jsonb_typeof(v_grant -> 'confirmedAt') <> 'string'
       or (v_grant ->> 'confirmedAt') !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([zZ]|[+-][0-9]{2}:[0-9]{2})$'
       or jsonb_typeof(v_grant -> 'method') <> 'string'
       or (v_grant ->> 'method') not in (
         'human_browser', 'verified_challenge'
       ) then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
    end if;

    if v_grant ? 'challengeId' and (
      jsonb_typeof(v_grant -> 'challengeId') <> 'string'
      or char_length(v_grant ->> 'challengeId') not between 8 and 128
      or (v_grant ->> 'challengeId') !~ '^[A-Za-z0-9._~-]+$'
    ) then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
    end if;
  elsif p_require_confirmation_grant then
    raise exception using errcode = 'PT409', message = 'CONFIRMATION_REQUIRED';
  end if;
end;
$$;

create or replace function private.gateway_actor_fingerprint_v1(p_context jsonb)
returns bytea
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      jsonb_strip_nulls(
        jsonb_build_object(
          'actorKind', p_context ->> 'actorKind',
          'clientId', p_context ->> 'clientId',
          'principalId', p_context ->> 'principalId',
          'subjectId', p_context ->> 'subjectId',
          'onBehalfOf', p_context ->> 'onBehalfOf',
          'delegationId', p_context ->> 'delegationId'
        )
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.hmac_private_identifier_v1(p_value text)
returns bytea
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select extensions.hmac(
    pg_catalog.convert_to(coalesce(p_value, ''), 'UTF8'),
    secret_row.hmac_key,
    'sha256'
  )
  from private.rate_limit_secrets as secret_row
  where secret_row.singleton;
$$;

create or replace function private.normalize_public_booking_intent_v1(
  p_request jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_booker jsonb;
  v_username text;
  v_meeting_type_id uuid;
  v_start_text text;
  v_start_at timestamptz;
  v_guest_time_zone text;
  v_booker_name text;
  v_booker_email text;
  v_notes text;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_request) as request_key(key_name)
    where request_key.key_name not in (
      'username', 'meetingTypeId', 'startAt', 'guestTimeZone', 'booker'
    )
  ) or not (
    p_request ? 'username'
    and p_request ? 'meetingTypeId'
    and p_request ? 'startAt'
    and p_request ? 'guestTimeZone'
    and p_request ? 'booker'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if jsonb_typeof(p_request -> 'username') <> 'string'
     or jsonb_typeof(p_request -> 'meetingTypeId') <> 'string'
     or jsonb_typeof(p_request -> 'startAt') <> 'string'
     or jsonb_typeof(p_request -> 'guestTimeZone') <> 'string'
     or jsonb_typeof(p_request -> 'booker') <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_booker := p_request -> 'booker';
  if exists (
    select 1
    from jsonb_object_keys(v_booker) as booker_key(key_name)
    where booker_key.key_name not in ('name', 'email', 'notes')
  ) or not (v_booker ? 'name' and v_booker ? 'email')
    or jsonb_typeof(v_booker -> 'name') <> 'string'
    or jsonb_typeof(v_booker -> 'email') <> 'string'
    or (
      v_booker ? 'notes'
      and jsonb_typeof(v_booker -> 'notes') not in ('string', 'null')
    ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_username := lower(btrim(p_request ->> 'username'));
  v_start_text := p_request ->> 'startAt';
  v_guest_time_zone := p_request ->> 'guestTimeZone';
  v_booker_name := btrim(v_booker ->> 'name');
  v_booker_email := lower(btrim(v_booker ->> 'email'));
  v_notes := nullif(btrim(coalesce(v_booker ->> 'notes', '')), '');

  if v_username !~ '^[a-z0-9][a-z0-9_-]{2,29}$'
     or char_length(v_booker_name) not between 2 and 120
     or v_booker_name ~ '[[:cntrl:]]'
     or not private.is_valid_booker_email(v_booker_email)
     or (v_notes is not null and char_length(v_notes) > 2000)
     or v_start_text !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([zZ]|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if not private.is_valid_time_zone(v_guest_time_zone) then
    raise exception using errcode = 'PT400', message = 'INVALID_TIME_ZONE';
  end if;

  begin
    v_meeting_type_id := (p_request ->> 'meetingTypeId')::uuid;
    v_start_at := v_start_text::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end;

  return jsonb_build_object(
    'username', v_username,
    'meetingTypeId', v_meeting_type_id,
    'startAt', v_start_at,
    'guestTimeZone', v_guest_time_zone,
    'booker', jsonb_strip_nulls(
      jsonb_build_object(
        'name', v_booker_name,
        'email', v_booker_email,
        'notes', v_notes
      )
    )
  );
end;
$$;

create or replace function private.public_booking_summary_fingerprint_v1(
  p_username text,
  p_host_display_name text,
  p_meeting_type_id uuid,
  p_meeting_type_title text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_host_time_zone text,
  p_guest_time_zone text,
  p_booker_name text,
  p_booker_email text,
  p_notes text
)
returns bytea
language sql
immutable
security definer
set search_path = pg_catalog
as $$
  select extensions.digest(
    pg_catalog.convert_to(
      jsonb_build_object(
        'username', p_username,
        'hostDisplayName', p_host_display_name,
        'meetingTypeId', p_meeting_type_id,
        'meetingTypeTitle', p_meeting_type_title,
        'startAt', p_start_at,
        'endAt', p_end_at,
        'hostTimeZone', p_host_time_zone,
        'guestTimeZone', p_guest_time_zone,
        'booker', jsonb_strip_nulls(
          jsonb_build_object(
            'name', p_booker_name,
            'email', p_booker_email,
            'notes', p_notes
          )
        )
      )::text,
      'UTF8'
    ),
    'sha256'
  );
$$;

create or replace function private.append_booking_audit_event_v1(
  p_context jsonb,
  p_operation_id text,
  p_outcome text,
  p_preparation_id uuid default null,
  p_confirmation_grant_id uuid default null,
  p_resource text default null,
  p_idempotency_key uuid default null,
  p_reason_code text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
begin
  insert into private.booking_audit_events (
    request_id,
    operation_id,
    actor_kind,
    transport,
    actor_fingerprint,
    client_digest,
    principal_digest,
    subject_digest,
    on_behalf_of_digest,
    delegation_digest,
    provenance_digest,
    scopes,
    confirmation_grant_id,
    preparation_id,
    resource_digest,
    idempotency_digest,
    outcome,
    reason_code
  )
  values (
    p_context ->> 'requestId',
    p_operation_id,
    p_context ->> 'actorKind',
    p_context ->> 'transport',
    private.gateway_actor_fingerprint_v1(p_context),
    case when p_context ? 'clientId'
      then private.hmac_private_identifier_v1(p_context ->> 'clientId') end,
    case when p_context ? 'principalId'
      then private.hmac_private_identifier_v1(p_context ->> 'principalId') end,
    case when p_context ? 'subjectId'
      then private.hmac_private_identifier_v1(p_context ->> 'subjectId') end,
    case when p_context ? 'onBehalfOf'
      then private.hmac_private_identifier_v1(p_context ->> 'onBehalfOf') end,
    case when p_context ? 'delegationId'
      then private.hmac_private_identifier_v1(p_context ->> 'delegationId') end,
    private.hmac_private_identifier_v1((p_context -> 'provenance')::text),
    array(
      select scope_value
      from jsonb_array_elements_text(p_context -> 'scopes') as scope_row(scope_value)
      order by scope_value
    ),
    p_confirmation_grant_id,
    p_preparation_id,
    case when p_resource is not null
      then private.hmac_private_identifier_v1(p_resource) end,
    case when p_idempotency_key is not null
      then private.hmac_private_identifier_v1(p_idempotency_key::text) end,
    p_outcome,
    p_reason_code
  );
end;
$$;

create or replace function public.append_gateway_audit_event_v1(
  p_request jsonb,
  p_context jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_operation_id text;
  v_outcome text;
  v_reason_code text;
  v_required_scope text;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name not in ('operationId', 'outcome', 'code')
     )
     or not (p_request ? 'operationId' and p_request ? 'outcome')
     or jsonb_typeof(p_request -> 'operationId') <> 'string'
     or jsonb_typeof(p_request -> 'outcome') <> 'string'
     or (
       p_request ? 'code'
       and jsonb_typeof(p_request -> 'code') <> 'string'
     ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_operation_id := p_request ->> 'operationId';
  v_outcome := p_request ->> 'outcome';
  v_reason_code := p_request ->> 'code';
  v_required_scope := case v_operation_id
    when 'project-s.public.get_booking_page.v1' then 'booking_page:read'
    when 'project-s.public.list_free_slots.v1' then 'slots:read'
    when 'project-s.public.prepare_booking.v1' then 'bookings:prepare'
    when 'project-s.public.create_booking.v1' then 'bookings:create'
    else null
  end;

  if v_required_scope is null
     or v_outcome not in ('success', 'rejected', 'failure')
     or (
       v_outcome = 'success'
       and v_reason_code is not null
     )
     or (
       v_outcome in ('rejected', 'failure')
       and (
         v_reason_code is null
         or v_reason_code not in (
           'VALIDATION_ERROR',
           'INVALID_TIME_ZONE',
           'NOT_FOUND',
           'MEETING_TYPE_UNAVAILABLE',
           'SLOT_UNAVAILABLE',
           'OUTSIDE_BOOKING_WINDOW',
           'AUTHENTICATION_REQUIRED',
           'FORBIDDEN',
           'INSUFFICIENT_SCOPE',
           'CONFIRMATION_REQUIRED',
           'PREPARATION_EXPIRED',
           'PREPARATION_MISMATCH',
           'PREPARATION_STALE',
           'PREPARATION_ALREADY_COMMITTED',
           'IDEMPOTENCY_KEY_REUSED',
           'VERSION_CONFLICT',
           'RATE_LIMITED',
           'INTERNAL_ERROR'
         )
       )
     ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  perform private.validate_gateway_execution_context_v1(
    p_context,
    v_required_scope,
    false
  );

  perform private.append_booking_audit_event_v1(
    p_context,
    v_operation_id,
    v_outcome,
    null,
    null,
    null,
    null,
    v_reason_code
  );
end;
$$;

create or replace function public.consume_public_rate_limit_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_operation_id text;
  v_bucket_material text;
  v_required_scope text;
  v_limit integer;
  v_window_seconds integer;
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_expires_at timestamptz;
  v_subject_digest bytea;
  v_request_count integer;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name not in ('operationId', 'bucketMaterial')
     )
     or not (p_request ? 'operationId' and p_request ? 'bucketMaterial')
     or jsonb_typeof(p_request -> 'operationId') <> 'string'
     or jsonb_typeof(p_request -> 'bucketMaterial') <> 'string'
     or char_length(p_request ->> 'bucketMaterial') not between 1 and 1024
     or (p_request ->> 'bucketMaterial') ~ '[[:cntrl:]]' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_operation_id := p_request ->> 'operationId';
  v_bucket_material := p_request ->> 'bucketMaterial';
  v_required_scope := case v_operation_id
    when 'project-s.public.get_booking_page.v1' then 'booking_page:read'
    when 'project-s.public.list_free_slots.v1' then 'slots:read'
    when 'project-s.public.prepare_booking.v1' then 'bookings:prepare'
    when 'project-s.public.create_booking.v1' then 'bookings:create'
    else null
  end;

  if v_required_scope is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  perform private.validate_gateway_execution_context_v1(
    p_context,
    v_required_scope,
    false
  );

  select policy_row.request_limit, policy_row.window_seconds
  into v_limit, v_window_seconds
  from private.public_rate_limit_policies as policy_row
  where policy_row.operation_id = v_operation_id;

  if not found then
    raise exception using errcode = 'PT500', message = 'INTERNAL_ERROR';
  end if;

  -- This RPC is called as its own gateway transaction and always returns a
  -- result, including denials. Opportunistic retention work therefore commits
  -- durably instead of being rolled back with a downstream application error.
  with expired_grants as (
    select grant_row.id
    from private.booking_confirmation_grants as grant_row
    join private.booking_preparations as preparation_row
      on preparation_row.id = grant_row.preparation_id
    where preparation_row.state <> 'committed'
      and preparation_row.expires_at <= v_now
      and grant_row.consumed_at is null
    order by preparation_row.expires_at, grant_row.id
    for update of grant_row skip locked
    limit 500
  )
  delete from private.booking_confirmation_grants as grant_row
  using expired_grants as expired_row
  where grant_row.id = expired_row.id;

  with expired_preparations as (
    select preparation_row.id
    from private.booking_preparations as preparation_row
    where preparation_row.state <> 'committed'
      and preparation_row.expires_at <= v_now
      and not exists (
        select 1
        from public.bookings as booking_row
        where booking_row.preparation_id = preparation_row.id
      )
      and not exists (
        select 1
        from private.booking_confirmation_grants as grant_row
        where grant_row.preparation_id = preparation_row.id
      )
    order by preparation_row.expires_at, preparation_row.id
    for update of preparation_row skip locked
    limit 500
  )
  delete from private.booking_preparations as preparation_row
  using expired_preparations as expired_row
  where preparation_row.id = expired_row.id;

  with expired_buckets as (
    select bucket_row.ctid
    from private.public_rate_limit_buckets as bucket_row
    where bucket_row.expires_at <= v_now
    order by bucket_row.expires_at
    for update of bucket_row skip locked
    limit 1000
  )
  delete from private.public_rate_limit_buckets as bucket_row
  using expired_buckets as expired_row
  where bucket_row.ctid = expired_row.ctid;

  v_window_started_at := pg_catalog.to_timestamp(
    floor(extract(epoch from v_now) / v_window_seconds) * v_window_seconds
  );
  v_expires_at := v_window_started_at
    + (v_window_seconds * interval '1 second');
  v_subject_digest := private.hmac_private_identifier_v1(
    v_operation_id || chr(31) || v_bucket_material
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
    v_operation_id,
    v_subject_digest,
    v_window_started_at,
    v_expires_at,
    1,
    v_now
  )
  on conflict (operation_id, subject_digest, window_started_at) do update
  set
    request_count = private.public_rate_limit_buckets.request_count + 1,
    updated_at = excluded.updated_at
  returning request_count into v_request_count;

  return jsonb_build_object(
    'allowed', v_request_count <= v_limit,
    'limit', v_limit,
    'remaining', greatest(v_limit - v_request_count, 0),
    'retryAfterSeconds', case when v_request_count > v_limit
      then greatest(ceil(extract(epoch from v_expires_at - v_now))::integer, 1)
      else 0
    end,
    'resetAt', v_expires_at
  );
end;
$$;

create or replace function public.get_gateway_booking_page_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_username text;
  v_profile public.profiles%rowtype;
  v_meeting_types jsonb;
begin
  perform private.validate_gateway_execution_context_v1(
    p_context,
    'booking_page:read',
    false
  );

  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name <> 'username'
     )
     or not (p_request ? 'username')
     or jsonb_typeof(p_request -> 'username') <> 'string' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_username := lower(btrim(p_request ->> 'username'));
  if v_username !~ '^[a-z0-9][a-z0-9_-]{2,29}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  select *
  into v_profile
  from public.profiles as profile_row
  where profile_row.username = v_username
    and exists (
      select 1
      from public.meeting_types as active_type
      where active_type.user_id = profile_row.id
        and active_type.active
    );

  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'meetingTypeId', meeting_type_row.id,
        'title', meeting_type_row.title,
        'description', meeting_type_row.description,
        'durationMinutes', meeting_type_row.duration_minutes,
        'minNoticeMinutes', meeting_type_row.minimum_notice_minutes,
        'maxAdvanceDays', meeting_type_row.maximum_advance_days
      )
      order by meeting_type_row.created_at, meeting_type_row.id
    ),
    '[]'::jsonb
  )
  into v_meeting_types
  from public.meeting_types as meeting_type_row
  where meeting_type_row.user_id = v_profile.id
    and meeting_type_row.active;

  return jsonb_build_object(
    'username', v_profile.username,
    'displayName', v_profile.full_name,
    'avatarUrl', null,
    'hostTimeZone', v_profile.timezone,
    'meetingTypes', v_meeting_types
  );
end;
$$;

create or replace function public.prepare_public_booking_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_intent jsonb;
  v_username text;
  v_meeting_type_id uuid;
  v_start_at timestamptz;
  v_guest_time_zone text;
  v_booker_name text;
  v_booker_email text;
  v_notes text;
  v_owner_id uuid;
  v_host_display_name text;
  v_meeting_type_title text;
  v_host_time_zone text;
  v_duration smallint;
  v_minimum_notice integer;
  v_maximum_advance smallint;
  v_end_at timestamptz;
  v_slot_date date;
  v_now timestamptz;
  v_authority_revision bigint;
  v_request_fingerprint bytea;
  v_summary_fingerprint bytea;
  v_token text;
  v_token_digest bytea;
  v_preparation private.booking_preparations%rowtype;
begin
  perform private.validate_gateway_execution_context_v1(
    p_context,
    'bookings:prepare',
    false
  );

  if p_context ? 'confirmationGrant' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_intent := private.normalize_public_booking_intent_v1(p_request);
  v_username := v_intent ->> 'username';
  v_meeting_type_id := (v_intent ->> 'meetingTypeId')::uuid;
  v_start_at := (v_intent ->> 'startAt')::timestamptz;
  v_guest_time_zone := v_intent ->> 'guestTimeZone';
  v_booker_name := v_intent #>> '{booker,name}';
  v_booker_email := v_intent #>> '{booker,email}';
  v_notes := v_intent #>> '{booker,notes}';

  select meeting_type_row.user_id
  into v_owner_id
  from public.meeting_types as meeting_type_row
  join public.profiles as profile_row
    on profile_row.id = meeting_type_row.user_id
  where meeting_type_row.id = v_meeting_type_id
    and meeting_type_row.active
    and profile_row.username = v_username;

  if not found then
    raise exception using errcode = 'PT404', message = 'MEETING_TYPE_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text, 0)
  );

  select
    meeting_type_row.user_id,
    profile_row.full_name,
    meeting_type_row.title,
    profile_row.timezone,
    meeting_type_row.duration_minutes,
    meeting_type_row.minimum_notice_minutes,
    meeting_type_row.maximum_advance_days
  into
    v_owner_id,
    v_host_display_name,
    v_meeting_type_title,
    v_host_time_zone,
    v_duration,
    v_minimum_notice,
    v_maximum_advance
  from public.meeting_types as meeting_type_row
  join public.profiles as profile_row
    on profile_row.id = meeting_type_row.user_id
  where meeting_type_row.id = v_meeting_type_id
    and meeting_type_row.active
    and profile_row.username = v_username;

  if not found then
    raise exception using errcode = 'PT404', message = 'MEETING_TYPE_UNAVAILABLE';
  end if;

  select version_row.revision
  into v_authority_revision
  from private.scheduling_authority_versions as version_row
  where version_row.owner_id = v_owner_id;

  if not found then
    raise exception using errcode = 'PT500', message = 'INTERNAL_ERROR';
  end if;

  v_now := clock_timestamp();
  v_end_at := private.add_minutes_utc(v_start_at, v_duration);

  if v_start_at < v_now + (v_minimum_notice * interval '1 minute')
     or v_end_at > v_now + (v_maximum_advance * interval '1 day') then
    raise exception using errcode = 'PT409', message = 'OUTSIDE_BOOKING_WINDOW';
  end if;

  v_slot_date := (v_start_at at time zone v_guest_time_zone)::date;
  perform 1
  from private.compute_free_slots_v1(
    v_username,
    v_meeting_type_id,
    v_slot_date,
    v_guest_time_zone,
    v_now
  ) as free_slot
  where free_slot.slot_start = v_start_at;

  if not found then
    raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
  end if;

  v_request_fingerprint := extensions.digest(
    pg_catalog.convert_to(v_intent::text, 'UTF8'),
    'sha256'
  );
  v_summary_fingerprint := private.public_booking_summary_fingerprint_v1(
    v_username,
    v_host_display_name,
    v_meeting_type_id,
    v_meeting_type_title,
    v_start_at,
    v_end_at,
    v_host_time_zone,
    v_guest_time_zone,
    v_booker_name,
    v_booker_email,
    v_notes
  );
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_digest := extensions.digest(
    pg_catalog.convert_to(v_token, 'UTF8'),
    'sha256'
  );

  insert into private.booking_preparations (
    token_digest,
    owner_id,
    meeting_type_id,
    username,
    host_display_name,
    meeting_type_title,
    start_time,
    end_time,
    host_timezone,
    guest_timezone,
    booker_name,
    booker_email,
    notes,
    request_fingerprint,
    summary_fingerprint,
    actor_fingerprint,
    authority_revision,
    expires_at
  )
  values (
    v_token_digest,
    v_owner_id,
    v_meeting_type_id,
    v_username,
    v_host_display_name,
    v_meeting_type_title,
    v_start_at,
    v_end_at,
    v_host_time_zone,
    v_guest_time_zone,
    v_booker_name,
    v_booker_email,
    v_notes,
    v_request_fingerprint,
    v_summary_fingerprint,
    private.gateway_actor_fingerprint_v1(p_context),
    v_authority_revision,
    v_now + interval '10 minutes'
  )
  returning * into v_preparation;

  perform private.append_booking_audit_event_v1(
    p_context,
    'project-s.public.prepare_booking.v1',
    'prepared',
    v_preparation.id,
    null,
    v_owner_id::text,
    null
  );

  return jsonb_build_object(
    'preparationId', v_preparation.id,
    'preparationToken', v_token,
    'expiresAt', v_preparation.expires_at,
    'notHeld', true,
    'summary', jsonb_build_object(
      'username', v_username,
      'hostDisplayName', v_host_display_name,
      'meetingTypeId', v_meeting_type_id,
      'meetingTypeTitle', v_meeting_type_title,
      'startAt', v_start_at,
      'endAt', v_end_at,
      'hostTimeZone', v_host_time_zone,
      'guestTimeZone', v_guest_time_zone,
      'booker', jsonb_strip_nulls(
        jsonb_build_object(
          'name', v_booker_name,
          'email', v_booker_email,
          'notes', v_notes
        )
      )
    )
  );
end;
$$;

create or replace function public.get_public_booking_preparation_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_token text;
  v_preparation private.booking_preparations%rowtype;
begin
  perform private.validate_gateway_execution_context_v1(
    p_context,
    'bookings:prepare',
    false
  );

  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name <> 'preparationToken'
     )
     or not (p_request ? 'preparationToken')
     or jsonb_typeof(p_request -> 'preparationToken') <> 'string'
     or (p_request ->> 'preparationToken') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_token := p_request ->> 'preparationToken';
  select *
  into v_preparation
  from private.booking_preparations as preparation_row
  where preparation_row.token_digest = extensions.digest(
    pg_catalog.convert_to(v_token, 'UTF8'),
    'sha256'
  );

  if not found then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  if v_preparation.state = 'committed' then
    raise exception using
      errcode = 'PT409',
      message = 'PREPARATION_ALREADY_COMMITTED';
  end if;

  if clock_timestamp() >= v_preparation.expires_at then
    raise exception using errcode = 'PT410', message = 'PREPARATION_EXPIRED';
  end if;

  return jsonb_build_object(
    'preparationId', v_preparation.id,
    'expiresAt', v_preparation.expires_at,
    'notHeld', true,
    'summary', jsonb_build_object(
      'username', v_preparation.username,
      'hostDisplayName', v_preparation.host_display_name,
      'meetingTypeId', v_preparation.meeting_type_id,
      'meetingTypeTitle', v_preparation.meeting_type_title,
      'startAt', v_preparation.start_time,
      'endAt', v_preparation.end_time,
      'hostTimeZone', v_preparation.host_timezone,
      'guestTimeZone', v_preparation.guest_timezone,
      'booker', jsonb_strip_nulls(
        jsonb_build_object(
          'name', v_preparation.booker_name,
          'email', v_preparation.booker_email,
          'notes', v_preparation.notes
        )
      )
    )
  );
end;
$$;

create or replace function public.confirm_public_booking_preparation_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_token text;
  v_confirmation_context jsonb;
  v_grant_id uuid;
  v_confirmed_at timestamptz;
  v_method text;
  v_challenge_id text;
  v_now timestamptz := clock_timestamp();
  v_preparation private.booking_preparations%rowtype;
  v_existing_grant private.booking_confirmation_grants%rowtype;
begin
  perform private.validate_gateway_execution_context_v1(
    p_context,
    'bookings:create',
    true
  );

  if p_context ->> 'actorKind' <> 'human'
     or p_context #>> '{provenance,source}' <> 'project_s_ui'
     or p_context ->> 'transport' not in ('ui', 'http') then
    raise exception using errcode = 'PT403', message = 'FORBIDDEN';
  end if;

  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name <> 'preparationToken'
     )
     or not (p_request ? 'preparationToken')
     or jsonb_typeof(p_request -> 'preparationToken') <> 'string'
     or (p_request ->> 'preparationToken') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_confirmation_context := p_context -> 'confirmationGrant';
  v_grant_id := (v_confirmation_context ->> 'grantId')::uuid;
  v_confirmed_at := (v_confirmation_context ->> 'confirmedAt')::timestamptz;
  v_method := v_confirmation_context ->> 'method';
  v_challenge_id := v_confirmation_context ->> 'challengeId';

  if v_confirmed_at > v_now + interval '30 seconds'
     or v_confirmed_at < v_now - interval '5 minutes'
     or (v_method = 'verified_challenge' and v_challenge_id is null) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_token := p_request ->> 'preparationToken';
  select *
  into v_preparation
  from private.booking_preparations as preparation_row
  where preparation_row.token_digest = extensions.digest(
    pg_catalog.convert_to(v_token, 'UTF8'),
    'sha256'
  )
  for update;

  if not found then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  if v_preparation.state = 'committed' then
    raise exception using
      errcode = 'PT409',
      message = 'PREPARATION_ALREADY_COMMITTED';
  end if;

  if v_now >= v_preparation.expires_at then
    raise exception using errcode = 'PT410', message = 'PREPARATION_EXPIRED';
  end if;

  select *
  into v_existing_grant
  from private.booking_confirmation_grants as grant_row
  where grant_row.preparation_id = v_preparation.id;

  if found then
    -- A lost HTTP response causes the trusted gateway to retry with a fresh
    -- proposed grant ID and timestamp. The durable grant is the authority:
    -- return it idempotently only to the same verified confirmer actor for the
    -- same immutable visible summary. Never replace or duplicate the grant.
    if v_existing_grant.summary_fingerprint
         <> v_preparation.summary_fingerprint
       or v_existing_grant.confirmer_actor_fingerprint
         <> private.gateway_actor_fingerprint_v1(p_context) then
      raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
    end if;

    return jsonb_build_object(
      'preparationId', v_preparation.id,
      'grantId', v_existing_grant.id,
      'confirmedAt', v_existing_grant.confirmed_at,
      'method', v_existing_grant.method
    );
  end if;

  insert into private.booking_confirmation_grants (
    id,
    preparation_id,
    audience,
    summary_fingerprint,
    confirmer_actor_fingerprint,
    method,
    challenge_digest,
    confirmed_at,
    expires_at
  )
  values (
    v_grant_id,
    v_preparation.id,
    v_preparation.audience,
    v_preparation.summary_fingerprint,
    private.gateway_actor_fingerprint_v1(p_context),
    v_method,
    case when v_challenge_id is not null
      then private.hmac_private_identifier_v1(v_challenge_id) end,
    v_confirmed_at,
    v_preparation.expires_at
  );

  update private.booking_preparations
  set
    state = 'confirmed',
    confirmed_at = v_confirmed_at
  where id = v_preparation.id;

  perform private.append_booking_audit_event_v1(
    p_context,
    'project-s.internal.confirm_booking_preparation.v1',
    'confirmed',
    v_preparation.id,
    v_grant_id,
    v_preparation.owner_id::text,
    null
  );

  return jsonb_build_object(
    'preparationId', v_preparation.id,
    'grantId', v_grant_id,
    'confirmedAt', v_confirmed_at,
    'method', v_method
  );
end;
$$;

create or replace function public.commit_prepared_booking_v1(
  p_request jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_token text;
  v_idempotency_key uuid;
  v_preparation private.booking_preparations%rowtype;
  v_grant private.booking_confirmation_grants%rowtype;
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_current_revision bigint;
  v_host_display_name text;
  v_meeting_type_title text;
  v_host_time_zone text;
  v_duration smallint;
  v_minimum_notice integer;
  v_maximum_advance smallint;
  v_current_end_at timestamptz;
  v_current_summary_fingerprint bytea;
  v_effective_buffer_before smallint;
  v_effective_buffer_after smallint;
  v_slot_date date;
  v_now timestamptz;
begin
  perform private.validate_gateway_execution_context_v1(
    p_context,
    'bookings:create',
    false
  );

  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_request) as request_key(key_name)
       where request_key.key_name not in (
         'preparationToken', 'idempotencyKey'
       )
     )
     or not (
       p_request ? 'preparationToken'
       and p_request ? 'idempotencyKey'
     )
     or jsonb_typeof(p_request -> 'preparationToken') <> 'string'
     or (p_request ->> 'preparationToken') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_request -> 'idempotencyKey') <> 'string' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_token := p_request ->> 'preparationToken';
  begin
    v_idempotency_key := (p_request ->> 'idempotencyKey')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end;

  -- The preparation record is retained after commit with PII redacted. This
  -- makes a lost-response replay resolvable even after expiry or publication
  -- changes without persisting the raw capability token.
  select *
  into v_preparation
  from private.booking_preparations as preparation_row
  where preparation_row.token_digest = extensions.digest(
    pg_catalog.convert_to(v_token, 'UTF8'),
    'sha256'
  )
  for update;

  if not found then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  if v_preparation.actor_fingerprint
     <> private.gateway_actor_fingerprint_v1(p_context) then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  -- Exact idempotent replay is resolved before expiry, grant state, active
  -- publication, schedule revision, or current wall-clock checks.
  select *
  into v_existing
  from public.bookings as booking_row
  where booking_row.idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.preparation_id <> v_preparation.id
       or v_existing.request_fingerprint <> v_preparation.request_fingerprint then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing.status <> 'confirmed' then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    end if;

    return jsonb_build_object(
      'confirmationCode', v_existing.confirmation_code,
      'status', 'confirmed',
      'username', v_preparation.username,
      'meetingTypeId', v_existing.meeting_type_id,
      'meetingTypeTitle', v_existing.meeting_type_title,
      'startAt', v_existing.start_time,
      'endAt', v_existing.end_time,
      'hostTimeZone', v_existing.host_timezone,
      'guestTimeZone', v_existing.guest_timezone,
      'idempotencyKey', v_existing.idempotency_key
    );
  end if;

  if v_preparation.state = 'committed' then
    raise exception using
      errcode = 'PT409',
      message = 'PREPARATION_ALREADY_COMMITTED';
  end if;

  v_now := clock_timestamp();
  if v_now >= v_preparation.expires_at then
    raise exception using errcode = 'PT410', message = 'PREPARATION_EXPIRED';
  end if;

  select *
  into v_grant
  from private.booking_confirmation_grants as grant_row
  where grant_row.preparation_id = v_preparation.id
  for update;

  if not found
     or v_grant.consumed_at is not null
     or v_grant.expires_at <= v_now
     or v_grant.audience <> v_preparation.audience
     or v_grant.summary_fingerprint <> v_preparation.summary_fingerprint then
    raise exception using errcode = 'PT409', message = 'CONFIRMATION_REQUIRED';
  end if;

  if p_context ? 'confirmationGrant'
     and (p_context #>> '{confirmationGrant,grantId}')::uuid <> v_grant.id then
    raise exception using errcode = 'PT409', message = 'PREPARATION_MISMATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_preparation.owner_id::text, 0)
  );

  -- Re-read every scheduling authority value only after the shared owner lock.
  select
    profile_row.full_name,
    meeting_type_row.title,
    profile_row.timezone,
    meeting_type_row.duration_minutes,
    meeting_type_row.minimum_notice_minutes,
    meeting_type_row.maximum_advance_days
  into
    v_host_display_name,
    v_meeting_type_title,
    v_host_time_zone,
    v_duration,
    v_minimum_notice,
    v_maximum_advance
  from public.meeting_types as meeting_type_row
  join public.profiles as profile_row
    on profile_row.id = meeting_type_row.user_id
  where meeting_type_row.id = v_preparation.meeting_type_id
    and meeting_type_row.user_id = v_preparation.owner_id
    and meeting_type_row.active
    and profile_row.username = v_preparation.username;

  if not found then
    raise exception using errcode = 'PT409', message = 'PREPARATION_STALE';
  end if;

  select version_row.revision
  into v_current_revision
  from private.scheduling_authority_versions as version_row
  where version_row.owner_id = v_preparation.owner_id;

  if not found or v_current_revision <> v_preparation.authority_revision then
    raise exception using errcode = 'PT409', message = 'PREPARATION_STALE';
  end if;

  v_now := clock_timestamp();
  v_current_end_at := private.add_minutes_utc(
    v_preparation.start_time,
    v_duration
  );
  v_current_summary_fingerprint :=
    private.public_booking_summary_fingerprint_v1(
      v_preparation.username,
      v_host_display_name,
      v_preparation.meeting_type_id,
      v_meeting_type_title,
      v_preparation.start_time,
      v_current_end_at,
      v_host_time_zone,
      v_preparation.guest_timezone,
      v_preparation.booker_name,
      v_preparation.booker_email,
      v_preparation.notes
    );

  if v_current_summary_fingerprint <> v_preparation.summary_fingerprint
     or v_preparation.start_time
       < v_now + (v_minimum_notice * interval '1 minute')
     or v_current_end_at
       > v_now + (v_maximum_advance * interval '1 day') then
    raise exception using errcode = 'PT409', message = 'PREPARATION_STALE';
  end if;

  v_slot_date := (
    v_preparation.start_time at time zone v_preparation.guest_timezone
  )::date;

  select free_slot.slot_buffer_before, free_slot.slot_buffer_after
  into v_effective_buffer_before, v_effective_buffer_after
  from private.compute_free_slots_v1(
    v_preparation.username,
    v_preparation.meeting_type_id,
    v_slot_date,
    v_preparation.guest_timezone,
    v_now
  ) as free_slot
  where free_slot.slot_start = v_preparation.start_time;

  if not found then
    raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
  end if;

  begin
    insert into public.bookings (
      user_id,
      meeting_type_id,
      start_time,
      duration_minutes,
      buffer_before_minutes,
      buffer_after_minutes,
      booker_name,
      booker_email,
      guest_timezone,
      meeting_type_title,
      host_timezone,
      notes,
      responses,
      idempotency_key,
      request_fingerprint,
      preparation_id
    )
    values (
      v_preparation.owner_id,
      v_preparation.meeting_type_id,
      v_preparation.start_time,
      v_duration,
      v_effective_buffer_before,
      v_effective_buffer_after,
      v_preparation.booker_name,
      v_preparation.booker_email,
      v_preparation.guest_timezone,
      v_meeting_type_title,
      v_host_time_zone,
      v_preparation.notes,
      jsonb_build_object('notes', v_preparation.notes),
      v_idempotency_key,
      v_preparation.request_fingerprint,
      v_preparation.id
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    when unique_violation then
      select *
      into v_existing
      from public.bookings as booking_row
      where booking_row.idempotency_key = v_idempotency_key;

      if found
         and v_existing.preparation_id = v_preparation.id
         and v_existing.request_fingerprint = v_preparation.request_fingerprint
         and v_existing.status = 'confirmed' then
        return jsonb_build_object(
          'confirmationCode', v_existing.confirmation_code,
          'status', 'confirmed',
          'username', v_preparation.username,
          'meetingTypeId', v_existing.meeting_type_id,
          'meetingTypeTitle', v_existing.meeting_type_title,
          'startAt', v_existing.start_time,
          'endAt', v_existing.end_time,
          'hostTimeZone', v_existing.host_timezone,
          'guestTimeZone', v_existing.guest_timezone,
          'idempotencyKey', v_existing.idempotency_key
        );
      end if;

      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
  end;

  update private.booking_confirmation_grants
  set
    consumed_at = v_now,
    consumed_by_booking_id = v_booking.id
  where id = v_grant.id;

  update private.booking_preparations
  set
    state = 'committed',
    committed_at = v_now,
    booker_name = null,
    booker_email = null,
    notes = null
  where id = v_preparation.id;

  perform private.append_booking_audit_event_v1(
    p_context,
    'project-s.public.create_booking.v1',
    'committed',
    v_preparation.id,
    v_grant.id,
    v_preparation.owner_id::text,
    v_idempotency_key
  );

  return jsonb_build_object(
    'confirmationCode', v_booking.confirmation_code,
    'status', 'confirmed',
    'username', v_preparation.username,
    'meetingTypeId', v_booking.meeting_type_id,
    'meetingTypeTitle', v_booking.meeting_type_title,
    'startAt', v_booking.start_time,
    'endAt', v_booking.end_time,
    'hostTimeZone', v_booking.host_timezone,
    'guestTimeZone', v_booking.guest_timezone,
    'idempotencyKey', v_booking.idempotency_key
  );
end;
$$;

revoke all on all tables in schema private
  from public, anon, authenticated, service_role;
revoke all on all sequences in schema private
  from public, anon, authenticated, service_role;

revoke all on function public.consume_public_rate_limit_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.append_gateway_audit_event_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_gateway_booking_page_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.prepare_public_booking_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_public_booking_preparation_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_public_booking_preparation_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_prepared_booking_v1(jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Cut public clients over to the rate-limited application gateway. The
-- baseline RPCs remain internal implementation/testing seams, never a second
-- transport that can bypass confirmation, provenance, or abuse controls.
revoke all on function public.get_public_booking_page_v1(text)
  from public, anon, authenticated;
revoke all on function public.list_public_free_slots_v1(text, uuid, date, text)
  from public, anon, authenticated;
revoke all on function public.create_public_booking_v1(jsonb)
  from public, anon, authenticated;

grant execute on function public.consume_public_rate_limit_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.append_gateway_audit_event_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.get_gateway_booking_page_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.prepare_public_booking_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.get_public_booking_preparation_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.confirm_public_booking_preparation_v1(jsonb, jsonb)
  to service_role;
grant execute on function public.commit_prepared_booking_v1(jsonb, jsonb)
  to service_role;

-- The canonical gateway adapter reuses the hardened slot computation from the
-- baseline RPC. Direct callers never receive service_role credentials; this
-- grant is an implementation seam, not a public contract.
grant execute on function public.list_public_free_slots_v1(text, uuid, date, text)
  to service_role;

comment on function public.get_public_booking_page_v1(text) is
  'Legacy internal authority helper. Public clients must use the Project S v1 gateway.';
comment on function public.list_public_free_slots_v1(text, uuid, date, text) is
  'Internal gateway authority helper. Public clients must use the Project S v1 gateway.';
comment on function public.create_public_booking_v1(jsonb) is
  'Legacy internal booking helper with no client EXECUTE grant. Public creation requires prepare, human confirmation, and gateway commit.';

revoke all on function private.bump_scheduling_authority_revision()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_booking_audit_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_gateway_execution_context_v1(jsonb, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.gateway_actor_fingerprint_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.hmac_private_identifier_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.normalize_public_booking_intent_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.public_booking_summary_fingerprint_v1(
  text, text, uuid, text, timestamptz, timestamptz, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.append_booking_audit_event_v1(
  jsonb, text, text, uuid, uuid, text, uuid, text
) from public, anon, authenticated, service_role;

comment on function public.consume_public_rate_limit_v1(jsonb, jsonb) is
  'Gateway-only HMAC-backed reference limiter and bounded expired-state cleanup. A denied response is returned, not raised, so both changes persist.';
comment on function public.append_gateway_audit_event_v1(jsonb, jsonb) is
  'Gateway-only durable success/rejection/failure audit sink. Accepts no request body, token, guest identity, or free-form reason text.';
comment on function public.get_gateway_booking_page_v1(jsonb, jsonb) is
  'Gateway-only canonical booking-page projection with per-meeting-type notice and horizon values.';
comment on function public.prepare_public_booking_v1(jsonb, jsonb) is
  'Gateway-only booking preview. Validates current authority and creates an opaque, non-holding preparation capability.';
comment on function public.get_public_booking_preparation_v1(jsonb, jsonb) is
  'Gateway-only confirmation preview lookup for an opaque preparation token.';
comment on function public.confirm_public_booking_preparation_v1(jsonb, jsonb) is
  'Gateway-only human-confirmation recorder. Requires a server-derived confirmationGrant context.';
comment on function public.commit_prepared_booking_v1(jsonb, jsonb) is
  'Gateway-only locked commit. Revalidates confirmed preparation authority and inserts under the exclusion constraint.';

commit;
