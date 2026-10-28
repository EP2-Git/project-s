-- Private reviewed-profile foundation (ADR 0004). No instance or route is enabled.
begin;
set local search_path = pg_catalog;

-- JavaScript contract bounds count UTF-16 code units, not Unicode code points.
create function private.v2_utf16_length(p_value text)
returns integer
language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select coalesce(sum(case when ascii(c) > 65535 then 2 else 1 end), 0)::integer
  from unnest(string_to_array(p_value, null)) as characters(c);
$$;

create function private.v2_valid_reviewed_profile(p_name text, p_email text, p_zone text)
returns boolean
language sql stable
set search_path = pg_catalog
as $$
  select p_name is not null and p_email is not null and p_zone is not null
    and p_name = btrim(p_name)
    and private.v2_utf16_length(p_name) between 2 and 120
    and p_name !~ U&'[\0001-\001f\007f-\009f]'
    and private.is_valid_booker_email(p_email)
    and private.v2_utf16_length(p_zone) between 1 and 255
    and (
      exists (select 1 from pg_catalog.pg_timezone_names where lower(name) = lower(p_zone))
      -- Modern Intl accepts these fixed-offset identifiers as well as names.
      or p_zone ~ '^[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?$'
    );
$$;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered', 'actor_revoked', 'profile_reviewed', 'profile_deleted'));

create table private.v2_booker_profiles (
  profile_id uuid primary key,
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  revision bigint not null default 1 check (revision = 1),
  state text not null default 'active' check (state in ('active', 'deleted')),
  name text,
  email text,
  guest_time_zone text,
  reviewed_at timestamptz not null,
  expires_at timestamptz not null,
  deleted_at timestamptz,
  reviewed_sequence bigint not null,
  deleted_sequence bigint,
  unique (instance_id, epoch, principal_id, profile_id, revision),
  check (isfinite(reviewed_at) and isfinite(expires_at)
    and expires_at > reviewed_at and expires_at <= reviewed_at + interval '168 hours'),
  check ((state = 'active' and name is not null and email is not null and guest_time_zone is not null
      and deleted_at is null and deleted_sequence is null
      and private.v2_valid_reviewed_profile(name, email, guest_time_zone))
    or (state = 'deleted' and name is null and email is null and guest_time_zone is null
      and deleted_at is not null and isfinite(deleted_at) and deleted_sequence is not null)),
  foreign key (instance_id, epoch, principal_id)
    references private.v2_authority_principals (instance_id, epoch, principal_id),
  foreign key (instance_id, epoch, principal_id, reviewed_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence),
  foreign key (instance_id, epoch, principal_id, deleted_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence)
);

-- Logical account references avoid Auth deletion cascades or legacy wait edges.
alter table private.v2_booker_profiles enable row level security;
revoke all on private.v2_booker_profiles from public, anon, authenticated, service_role;

create function public.project_s_create_booker_profile_v2(
  p_context jsonb, p_profile_id uuid, p_profile jsonb
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_booker_profiles%rowtype;
  v_disabled boolean;
  v_name text;
  v_email text;
  v_zone text;
  v_sequence bigint;
  v_now timestamptz;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  if p_profile_id is null or jsonb_typeof(p_profile) is distinct from 'object' then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;
  if (select count(*) from jsonb_object_keys(p_profile)) <> 3
    or exists (select 1 from jsonb_object_keys(p_profile) as k(key)
      where key not in ('name', 'email', 'guestTimeZone'))
    or jsonb_typeof(p_profile -> 'name') is distinct from 'string'
    or jsonb_typeof(p_profile -> 'email') is distinct from 'string'
    or jsonb_typeof(p_profile -> 'guestTimeZone') is distinct from 'string'
  then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;
  v_name := btrim(p_profile ->> 'name');
  v_email := lower(btrim(p_profile ->> 'email'));
  v_zone := p_profile ->> 'guestTimeZone';
  if not private.v2_valid_reviewed_profile(v_name, v_email, v_zone) then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;

  -- Issuer-only bootstrap, covered by the same post-wait live checks as C1.
  insert into private.v2_authority_principals(instance_id, epoch, principal_id)
    values (c.instance_id, c.epoch, c.principal_id) on conflict do nothing;
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (c.instance_id, c.epoch, c.principal_id)
    for update;
  if v_disabled then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  -- Check ownership before taking a referenced object lock.
  if exists (select 1 from private.v2_booker_profiles p where p.profile_id = p_profile_id
    and (p.instance_id, p.epoch, p.principal_id) <> (c.instance_id, c.epoch, c.principal_id)) then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;
  select * into v_row from private.v2_booker_profiles p
    where p.profile_id = p_profile_id and p.instance_id = c.instance_id
      and p.epoch = c.epoch and p.principal_id = c.principal_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  if v_row.profile_id is not null then
    -- Same server-generated identity only: no public create-idempotency promise.
    if v_row.state <> 'active' or v_row.expires_at <= v_now
      or v_row.name is distinct from v_name or v_row.email is distinct from v_email
      or v_row.guest_time_zone is distinct from v_zone then
      raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
    end if;
    return jsonb_build_object('profileId', v_row.profile_id, 'revision', v_row.revision,
      'reviewedAt', v_row.reviewed_at, 'expiresAt', v_row.expires_at);
  end if;

  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id, epoch, principal_id) = (c.instance_id, c.epoch, c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id, c.epoch, c.principal_id, v_sequence, 'profile_reviewed', v_now);
  insert into private.v2_booker_profiles (
    profile_id, instance_id, epoch, principal_id, name, email, guest_time_zone,
    reviewed_at, expires_at, reviewed_sequence
  ) values (
    p_profile_id, c.instance_id, c.epoch, c.principal_id, v_name, v_email, v_zone,
    v_now, v_now + interval '168 hours', v_sequence
  );
  return jsonb_build_object('profileId', p_profile_id, 'revision', 1,
    'reviewedAt', v_now, 'expiresAt', v_now + interval '168 hours');
exception
  when unique_violation then
    -- A cross-principal UUID collision must not reveal rows or commit an event.
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_delete_booker_profile_v2(
  p_context jsonb, p_profile_id uuid, p_expected_revision bigint
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_booker_profiles%rowtype;
  v_disabled boolean;
  v_sequence bigint;
  v_now timestamptz;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (c.instance_id, c.epoch, c.principal_id)
    for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  if v_disabled then raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_row from private.v2_booker_profiles p
    where p.profile_id = p_profile_id and p.instance_id = c.instance_id
      and p.epoch = c.epoch and p.principal_id = c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  if p_expected_revision is null or p_expected_revision <> 1 then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;
  if v_row.state = 'deleted' then
    return jsonb_build_object('profileId', v_row.profile_id, 'state', 'deleted', 'deletedAt', v_row.deleted_at);
  end if;

  -- No mandates exist in this foundation. Their introduction must add dependent
  -- invalidation under this fence before deletion can acknowledge success.
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id, epoch, principal_id) = (c.instance_id, c.epoch, c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id, c.epoch, c.principal_id, v_sequence, 'profile_deleted', v_now);
  update private.v2_booker_profiles set state = 'deleted', name = null, email = null,
    guest_time_zone = null, deleted_at = v_now, deleted_sequence = v_sequence
    where profile_id = v_row.profile_id;
  return jsonb_build_object('profileId', v_row.profile_id, 'state', 'deleted', 'deletedAt', v_now);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_utf16_length(text),
  private.v2_valid_reviewed_profile(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.project_s_create_booker_profile_v2(jsonb, uuid, jsonb),
  public.project_s_delete_booker_profile_v2(jsonb, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.project_s_create_booker_profile_v2(jsonb, uuid, jsonb),
  public.project_s_delete_booker_profile_v2(jsonb, uuid, bigint) to service_role;

commit;
