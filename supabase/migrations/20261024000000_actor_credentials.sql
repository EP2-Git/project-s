-- Disabled-boundary C1 storage and internal gateway RPCs (ADR 0004).
-- No instance is configured by this migration and no delegated route is added.
begin;
set local search_path = pg_catalog;

create table private.v2_authority_instance (
  singleton boolean primary key default true check (singleton),
  instance_id uuid not null,
  epoch bigint not null check (epoch between 1 and 9007199254740991),
  audience text not null check (
    audience ~ '^https://([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?$'
    or audience ~ '^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?$'
  ),
  synthetic_only boolean not null default true check (synthetic_only)
);

create table private.v2_authority_principals (
  instance_id uuid not null,
  epoch bigint not null check (epoch between 1 and 9007199254740991),
  principal_id uuid not null,
  disabled boolean not null default false,
  event_sequence bigint not null default 0 check (event_sequence >= 0),
  primary key (instance_id, epoch, principal_id)
);

create table private.v2_authority_events (
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  sequence bigint not null check (sequence > 0),
  action text not null check (action in ('actor_registered', 'actor_revoked')),
  occurred_at timestamptz not null,
  primary key (instance_id, epoch, principal_id, sequence),
  foreign key (instance_id, epoch, principal_id)
    references private.v2_authority_principals (instance_id, epoch, principal_id)
);

create table private.v2_actor_credentials (
  credential_id uuid primary key,
  actor_id uuid not null unique,
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  verifier bytea not null check (octet_length(verifier) = 32),
  label text not null check (label = btrim(label) and char_length(label) between 1 and 80),
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  state text not null default 'active' check (state in ('active', 'revoked')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  registered_sequence bigint not null,
  revoked_sequence bigint,
  check (isfinite(issued_at) and isfinite(expires_at)
    and expires_at > issued_at and expires_at <= issued_at + interval '168 hours'),
  check ((state = 'active' and revision = 1 and revoked_at is null and revoked_sequence is null)
    or (state = 'revoked' and revision = 2 and revoked_at is not null and revoked_sequence is not null)),
  foreign key (instance_id, epoch, principal_id)
    references private.v2_authority_principals (instance_id, epoch, principal_id),
  foreign key (instance_id, epoch, principal_id, registered_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence),
  foreign key (instance_id, epoch, principal_id, revoked_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence)
);

-- No cascades or FKs into legacy auth/profile/booking rows. Tombstones remain
-- private until the separately implemented retention/recovery procedures exist.
alter table private.v2_authority_instance enable row level security;
alter table private.v2_authority_principals enable row level security;
alter table private.v2_authority_events enable row level security;
alter table private.v2_actor_credentials enable row level security;
revoke all on private.v2_authority_instance, private.v2_authority_principals,
  private.v2_authority_events, private.v2_actor_credentials
  from public, anon, authenticated, service_role;

create function private.v2_principal_context(p_context jsonb)
returns table (instance_id uuid, epoch bigint, principal_id uuid)
language plpgsql
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_context) is distinct from 'object' then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  if (select count(*) from jsonb_object_keys(p_context)) <> 8
    or exists (select 1 from jsonb_object_keys(p_context) as k(key)
      where key not in ('contractVersion','requestId','principalId','subjectId',
        'instanceId','epoch','verifiedAt','transport'))
    or p_context -> 'contractVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_context -> 'epoch') is distinct from 'number'
    or jsonb_typeof(p_context -> 'requestId') is distinct from 'string'
    or char_length(p_context ->> 'requestId') not between 8 and 128
    or (p_context ->> 'requestId') !~ '^[A-Za-z0-9._~-]+$'
    or jsonb_typeof(p_context -> 'principalId') is distinct from 'string'
    or jsonb_typeof(p_context -> 'subjectId') is distinct from 'string'
    or jsonb_typeof(p_context -> 'instanceId') is distinct from 'string'
    or jsonb_typeof(p_context -> 'verifiedAt') is distinct from 'string'
    or (p_context ->> 'verifiedAt') !~ '^\d{4}-\d\d-\d\dT'
    or not isfinite((p_context ->> 'verifiedAt')::timestamptz)
    or jsonb_typeof(p_context -> 'transport') is distinct from 'string'
    or (p_context ->> 'transport') not in ('ui','http')
  then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  instance_id := (p_context ->> 'instanceId')::uuid;
  epoch := (p_context ->> 'epoch')::bigint;
  principal_id := (p_context ->> 'principalId')::uuid;
  if epoch not between 1 and 9007199254740991
    or principal_id is distinct from (p_context ->> 'subjectId')::uuid
  then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  return next;
exception when invalid_text_representation or datetime_field_overflow
  or invalid_datetime_format or numeric_value_out_of_range then
  raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
end;
$$;

create function private.v2_assert_instance(p_instance_id uuid, p_epoch bigint)
returns text
language plpgsql
set search_path = pg_catalog
as $$
declare v_audience text;
begin
  select i.audience into v_audience from private.v2_authority_instance i
    where i.singleton and i.synthetic_only and i.instance_id = p_instance_id and i.epoch = p_epoch;
  if not found then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  return v_audience;
end;
$$;

create function private.v2_assert_account(p_principal_id uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform u.id from auth.users u where u.id = p_principal_id
    and u.is_anonymous is false for key share nowait;
  if not found then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
end;
$$;

create function public.project_s_register_actor_v2(
  p_context jsonb, p_actor_id uuid, p_credential_id uuid,
  p_verifier bytea, p_label text, p_expires_at timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
declare
  c record;
  v_disabled boolean;
  v_sequence bigint;
  v_now timestamptz;
  v_audience text;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  if p_actor_id is null or p_credential_id is null or p_verifier is null
    or octet_length(p_verifier) <> 32 or p_label is null or p_label <> btrim(p_label)
    or char_length(p_label) not between 1 and 80 or p_expires_at is null
    or not isfinite(p_expires_at) then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;
  -- Only a verified issuer may bootstrap the first principal fence. Insertion's
  -- unique-key wait is covered by the same deadline revalidation below.
  insert into private.v2_authority_principals(instance_id,epoch,principal_id)
    values(c.instance_id,c.epoch,c.principal_id) on conflict do nothing;
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id,p.epoch,p.principal_id) = (c.instance_id,c.epoch,c.principal_id)
    for update;
  if v_disabled then
    raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED';
  end if;
  perform private.v2_assert_account(c.principal_id);
  v_audience := private.v2_assert_instance(c.instance_id,c.epoch);
  v_now := clock_timestamp();
  if p_expires_at <= v_now or p_expires_at > v_now + interval '168 hours' then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id,epoch,principal_id) = (c.instance_id,c.epoch,c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id,c.epoch,c.principal_id,v_sequence,'actor_registered',v_now);
  insert into private.v2_actor_credentials(
    credential_id,actor_id,instance_id,epoch,principal_id,verifier,label,
    issued_at,expires_at,registered_sequence
  ) values (p_credential_id,p_actor_id,c.instance_id,c.epoch,c.principal_id,
    p_verifier,p_label,v_now,p_expires_at,v_sequence);
  return jsonb_build_object('actorId',p_actor_id,'credentialId',p_credential_id,
    'revision',1,'issuedAt',v_now,'expiresAt',p_expires_at,'audience',v_audience,
    'instanceId',c.instance_id,'epoch',c.epoch);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_get_actor_credential_v2(
  p_credential_id uuid, p_instance_id uuid, p_epoch bigint
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
declare
  v_row private.v2_actor_credentials%rowtype;
  v_disabled boolean;
  v_audience text;
begin
  -- Lookup discovers a private fence reference, never creates one or authenticates
  -- a caller. The server still compares the secret verifier in constant time.
  v_audience := private.v2_assert_instance(p_instance_id,p_epoch);
  select * into v_row from private.v2_actor_credentials
    where credential_id = p_credential_id and instance_id = p_instance_id and epoch = p_epoch;
  if not found then return null; end if;
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id,p.epoch,p.principal_id) = (v_row.instance_id,v_row.epoch,v_row.principal_id)
    for update;
  if not found or v_disabled then return null; end if;
  select * into v_row from private.v2_actor_credentials
    where credential_id = p_credential_id and instance_id = p_instance_id and epoch = p_epoch
    for update;
  perform private.v2_assert_account(v_row.principal_id);
  v_audience := private.v2_assert_instance(p_instance_id,p_epoch);
  if v_row.state <> 'active' or v_row.expires_at <= clock_timestamp() then return null; end if;
  return jsonb_build_object('principalId',v_row.principal_id,'subjectId',v_row.principal_id,
    'actorId',v_row.actor_id,'credentialId',v_row.credential_id,'revision',v_row.revision,
    'verifier',encode(v_row.verifier,'hex'),'issuedAt',v_row.issued_at,'expiresAt',v_row.expires_at,
    'instanceId',v_row.instance_id,'epoch',v_row.epoch,'audience',v_audience);
exception
  when sqlstate 'PT401' then return null;
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_revoke_actor_v2(
  p_context jsonb, p_actor_id uuid, p_expected_revision bigint
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set lock_timeout = '1s'
set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_actor_credentials%rowtype;
  v_sequence bigint;
  v_now timestamptz;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  perform 1 from private.v2_authority_principals p
    where (p.instance_id,p.epoch,p.principal_id) = (c.instance_id,c.epoch,c.principal_id)
    for update;
  if not found then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;
  -- Own-object authorization precedes any referenced credential lock/FK work.
  select * into v_row from private.v2_actor_credentials
    where actor_id = p_actor_id and instance_id = c.instance_id
      and epoch = c.epoch and principal_id = c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now := clock_timestamp();
  if p_expected_revision is null or p_expected_revision <> 1 then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;
  if v_row.state = 'revoked' then
    return jsonb_build_object('actorId',v_row.actor_id,'revision',v_row.revision,
      'state','revoked','revokedAt',v_row.revoked_at);
  end if;
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id,epoch,principal_id) = (c.instance_id,c.epoch,c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id,c.epoch,c.principal_id,v_sequence,'actor_revoked',v_now);
  update private.v2_actor_credentials set state = 'revoked', revision = 2,
    revoked_at = v_now, revoked_sequence = v_sequence where credential_id = v_row.credential_id;
  return jsonb_build_object('actorId',v_row.actor_id,'revision',2,'state','revoked','revokedAt',v_now);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_principal_context(jsonb),
  private.v2_assert_instance(uuid,bigint), private.v2_assert_account(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.project_s_register_actor_v2(jsonb,uuid,uuid,bytea,text,timestamptz),
  public.project_s_get_actor_credential_v2(uuid,uuid,bigint),
  public.project_s_revoke_actor_v2(jsonb,uuid,bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.project_s_register_actor_v2(jsonb,uuid,uuid,bytea,text,timestamptz),
  public.project_s_get_actor_credential_v2(uuid,uuid,bigint),
  public.project_s_revoke_actor_v2(jsonb,uuid,bigint) to service_role;

commit;
