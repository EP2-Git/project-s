-- Private principal-only mandate controls (ADR 0004). No route or instance is enabled.
begin;
set local search_path = pg_catalog;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered', 'actor_revoked', 'profile_reviewed', 'profile_deleted',
    'mandate_reviewed', 'mandate_approved', 'mandate_revoked'));

alter table private.v2_actor_credentials add constraint v2_actor_credentials_partition_identity_key
  unique (instance_id, epoch, principal_id, credential_id, actor_id);

create table private.v2_mandate_reviews (
  review_id uuid primary key,
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  actor_id uuid not null,
  credential_id uuid not null,
  credential_revision bigint not null check (credential_revision = 1),
  profile_id uuid not null,
  profile_revision bigint not null check (profile_revision = 1),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  policy_summary jsonb,
  host_snapshot jsonb not null check (jsonb_typeof(host_snapshot) = 'object'),
  summary_digest text not null check (summary_digest ~ '^[a-f0-9]{64}$'),
  revision bigint not null default 1 check (revision = 1),
  state text not null default 'pending' check (state in ('pending', 'approved', 'invalidated')),
  reviewed_at timestamptz not null,
  expires_at timestamptz not null,
  reviewed_sequence bigint not null,
  approved_mandate_id uuid,
  invalidated_at timestamptz,
  invalidated_sequence bigint,
  unique (instance_id, epoch, principal_id, review_id),
  check (isfinite(reviewed_at) and isfinite(expires_at)
    and expires_at > reviewed_at and expires_at <= reviewed_at + interval '5 minutes'),
  check ((state = 'pending' and policy_summary is not null and jsonb_typeof(policy_summary) = 'object'
      and approved_mandate_id is null and invalidated_at is null and invalidated_sequence is null)
    or (state = 'approved' and policy_summary is null and approved_mandate_id is not null
      and invalidated_at is null and invalidated_sequence is null)
    or (state = 'invalidated' and policy_summary is null and approved_mandate_id is null
      and invalidated_at is not null and isfinite(invalidated_at) and invalidated_sequence is not null)),
  foreign key (instance_id, epoch, principal_id, credential_id, actor_id)
    references private.v2_actor_credentials (instance_id, epoch, principal_id, credential_id, actor_id),
  foreign key (instance_id, epoch, principal_id, profile_id, profile_revision)
    references private.v2_booker_profiles (instance_id, epoch, principal_id, profile_id, revision),
  foreign key (instance_id, epoch, principal_id, reviewed_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence),
  foreign key (instance_id, epoch, principal_id, invalidated_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence)
);

create table private.v2_mandates (
  mandate_id uuid primary key,
  review_id uuid not null unique,
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  actor_id uuid not null,
  credential_id uuid not null,
  credential_revision bigint not null check (credential_revision = 1),
  profile_id uuid not null,
  profile_revision bigint not null check (profile_revision = 1),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  host_snapshot jsonb not null check (jsonb_typeof(host_snapshot) = 'object'),
  summary_digest text not null check (summary_digest ~ '^[a-f0-9]{64}$'),
  revision bigint not null default 1 check (revision in (1, 2)),
  state text not null default 'active' check (state in ('active', 'revoked')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  issued_sequence bigint not null,
  revoked_at timestamptz,
  revoked_sequence bigint,
  check (isfinite(issued_at) and isfinite(expires_at)
    and expires_at > issued_at and expires_at <= issued_at + interval '24 hours'),
  check ((state = 'active' and revision = 1 and revoked_at is null and revoked_sequence is null)
    or (state = 'revoked' and revision = 2 and revoked_at is not null
      and isfinite(revoked_at) and revoked_sequence is not null)),
  foreign key (instance_id, epoch, principal_id, review_id)
    references private.v2_mandate_reviews (instance_id, epoch, principal_id, review_id),
  foreign key (instance_id, epoch, principal_id, credential_id, actor_id)
    references private.v2_actor_credentials (instance_id, epoch, principal_id, credential_id, actor_id),
  foreign key (instance_id, epoch, principal_id, profile_id, profile_revision)
    references private.v2_booker_profiles (instance_id, epoch, principal_id, profile_id, revision),
  foreign key (instance_id, epoch, principal_id, issued_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence),
  foreign key (instance_id, epoch, principal_id, revoked_sequence)
    references private.v2_authority_events (instance_id, epoch, principal_id, sequence)
);

create index v2_mandate_reviews_profile_idx
  on private.v2_mandate_reviews (instance_id, epoch, principal_id, profile_id, review_id);
create index v2_mandates_profile_idx
  on private.v2_mandates (instance_id, epoch, principal_id, profile_id, mandate_id);
alter table private.v2_mandate_reviews enable row level security;
alter table private.v2_mandates enable row level security;
revoke all on private.v2_mandate_reviews, private.v2_mandates
  from public, anon, authenticated, service_role;

create function private.v2_mandate_instant(p_value timestamptz)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$ select to_char(p_value at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'); $$;

-- The adapter normalizes instants first. SQL independently refuses extra keys,
-- coerced scalar types, rounded fractions and a noncanonical internal policy.
create function private.v2_normalize_mandate_policy(p_policy jsonb)
returns jsonb language plpgsql
set search_path = pg_catalog
as $$
declare
  v_key text;
  v_value timestamptz;
  v_normalized jsonb;
begin
  if jsonb_typeof(p_policy) is distinct from 'object' then
    raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
  end if;
  if (select count(*) from jsonb_object_keys(p_policy)) <> 10
    or exists (select 1 from jsonb_object_keys(p_policy) as k(key)
      where key not in ('actorId', 'profileId', 'profileRevision', 'username', 'meetingTypeId',
        'meetingWindowStart', 'meetingWindowEnd', 'maxDurationMinutes', 'notBefore', 'expiresAt'))
    or jsonb_typeof(p_policy -> 'profileRevision') is distinct from 'number'
    or p_policy -> 'profileRevision' is distinct from '1'::jsonb
    or jsonb_typeof(p_policy -> 'maxDurationMinutes') is distinct from 'number'
    or (p_policy ->> 'maxDurationMinutes') !~ '^[0-9]+$'
    or (p_policy ->> 'maxDurationMinutes')::integer not between 5 and 1440
    or jsonb_typeof(p_policy -> 'username') is distinct from 'string'
    or (p_policy ->> 'username') !~ '^[a-z0-9][a-z0-9_-]{2,29}$'
  then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
  v_normalized := p_policy;
  foreach v_key in array array['actorId', 'profileId', 'meetingTypeId'] loop
    if jsonb_typeof(p_policy -> v_key) is distinct from 'string'
      or (p_policy ->> v_key) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
    perform (p_policy ->> v_key)::uuid;
  end loop;
  foreach v_key in array array['meetingWindowStart', 'meetingWindowEnd', 'notBefore', 'expiresAt'] loop
    if jsonb_typeof(p_policy -> v_key) is distinct from 'string'
      or (p_policy ->> v_key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
    v_value := (p_policy ->> v_key)::timestamptz;
    if not isfinite(v_value) or private.v2_mandate_instant(v_value) <> p_policy ->> v_key
    then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
  end loop;
  if (p_policy ->> 'meetingWindowStart')::timestamptz >= (p_policy ->> 'meetingWindowEnd')::timestamptz
    or (p_policy ->> 'notBefore')::timestamptz >= (p_policy ->> 'expiresAt')::timestamptz
    or (p_policy ->> 'expiresAt')::timestamptz > (p_policy ->> 'notBefore')::timestamptz + interval '24 hours'
  then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
  return v_normalized;
exception when invalid_text_representation or datetime_field_overflow
  or invalid_datetime_format or numeric_value_out_of_range then
  raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR';
end;
$$;

create function private.v2_lock_mandate_principal(p_instance uuid, p_epoch bigint, p_principal uuid)
returns void language plpgsql
set search_path = pg_catalog
as $$
declare v_disabled boolean;
begin
  perform private.v2_assert_instance(p_instance, p_epoch);
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id, p.epoch, p.principal_id) = (p_instance, p_epoch, p_principal) for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  if v_disabled then raise exception sqlstate 'PT401' using message = 'AUTHENTICATION_REQUIRED'; end if;
  perform private.v2_assert_account(p_principal);
  perform private.v2_assert_instance(p_instance, p_epoch);
end;
$$;

-- Every legacy acquisition here is NOWAIT/try-lock. In particular an old CRUD
-- transaction may hold a mutable row and wait on the owner fence: never wait
-- for that row while owning its owner fence. Plain reads follow the fence.
create function private.v2_mandate_host_snapshot(p_username text, p_meeting_type_id uuid)
returns jsonb language plpgsql
set search_path = pg_catalog
as $$
declare
  v_host public.profiles%rowtype;
  v_type public.meeting_types%rowtype;
  v_revision bigint;
begin
  select * into v_host from public.profiles p where p.username = p_username for key share nowait;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  perform mt.id from public.meeting_types mt
    where mt.id = p_meeting_type_id and mt.user_id = v_host.id for key share nowait;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(v_host.id::text, 0)) then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
  end if;
  select * into v_host from public.profiles p where p.id = v_host.id and p.username = p_username;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_type from public.meeting_types mt
    where mt.id = p_meeting_type_id and mt.user_id = v_host.id and mt.active;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select av.revision into v_revision from private.scheduling_authority_versions av where av.owner_id = v_host.id;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  return jsonb_build_object('hostId', v_host.id, 'username', v_host.username,
    'hostDisplayName', v_host.full_name, 'hostTimeZone', v_host.timezone,
    'meetingTypeId', v_type.id, 'meetingTypeTitle', v_type.title,
    'durationMinutes', v_type.duration_minutes, 'authorityRevision', v_revision,
    'slotIntervalMinutes', v_type.slot_interval_minutes,
    'bufferBeforeMinutes', v_type.buffer_before_minutes, 'bufferAfterMinutes', v_type.buffer_after_minutes,
    'minimumNoticeMinutes', v_type.minimum_notice_minutes, 'maximumAdvanceDays', v_type.maximum_advance_days);
end;
$$;

create function private.v2_mandate_support(p_instance uuid, p_epoch bigint, p_principal uuid,
  p_policy jsonb, p_require_future boolean default true)
returns jsonb language plpgsql
set search_path = pg_catalog
as $$
declare
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_snapshot jsonb;
  v_summary jsonb;
  v_now timestamptz;
begin
  select * into v_credential from private.v2_actor_credentials a
    where a.instance_id = p_instance and a.epoch = p_epoch and a.principal_id = p_principal
      and a.actor_id = (p_policy ->> 'actorId')::uuid for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_profile from private.v2_booker_profiles p
    where p.instance_id = p_instance and p.epoch = p_epoch and p.principal_id = p_principal
      and p.profile_id = (p_policy ->> 'profileId')::uuid for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  v_snapshot := private.v2_mandate_host_snapshot(p_policy ->> 'username', (p_policy ->> 'meetingTypeId')::uuid);
  perform private.v2_assert_instance(p_instance, p_epoch);
  v_now := clock_timestamp();
  if v_credential.state <> 'active' or v_credential.revision <> 1 or v_credential.expires_at <= v_now
    or v_profile.state <> 'active' or v_profile.revision <> (p_policy ->> 'profileRevision')::bigint
    or v_profile.expires_at <= v_now
  then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
  if (p_require_future and (p_policy ->> 'notBefore')::timestamptz < v_now)
    or (p_policy ->> 'expiresAt')::timestamptz <= v_now
    or (p_policy ->> 'expiresAt')::timestamptz > v_now + interval '24 hours'
    or (p_policy ->> 'expiresAt')::timestamptz > least(v_credential.expires_at, v_profile.expires_at)
  then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
  v_summary := p_policy || jsonb_build_object('name', v_profile.name, 'email', v_profile.email,
    'guestTimeZone', v_profile.guest_time_zone, 'hostDisplayName', v_snapshot ->> 'hostDisplayName',
    'meetingTypeTitle', v_snapshot ->> 'meetingTypeTitle');
  return jsonb_build_object('instanceId', p_instance, 'epoch', p_epoch, 'principalId', p_principal,
    'credentialId', v_credential.credential_id,
    'credentialRevision', v_credential.revision, 'credentialExpiresAt', private.v2_mandate_instant(v_credential.expires_at),
    'profileExpiresAt', private.v2_mandate_instant(v_profile.expires_at),
    'summary', v_summary, 'hostSnapshot', v_snapshot);
end;
$$;

create function private.v2_mandate_digest(p_support jsonb)
returns text language sql immutable strict parallel safe
set search_path = pg_catalog
as $$ select encode(extensions.digest(convert_to('project-s:v2:mandate-review:1:' || p_support::text, 'UTF8'), 'sha256'), 'hex'); $$;

create function public.project_s_create_mandate_review_v2(p_context jsonb, p_review_id uuid, p_policy jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  c record;
  v_policy jsonb;
  v_support jsonb;
  v_row private.v2_mandate_reviews%rowtype;
  v_now timestamptz;
  v_expiry timestamptz;
  v_sequence bigint;
  v_digest text;
begin
  select * into c from private.v2_principal_context(p_context);
  v_policy := private.v2_normalize_mandate_policy(p_policy);
  if p_review_id is null then raise exception sqlstate 'PT400' using message = 'VALIDATION_ERROR'; end if;
  perform private.v2_lock_mandate_principal(c.instance_id, c.epoch, c.principal_id);
  if exists (select 1 from private.v2_mandate_reviews r where r.review_id = p_review_id
    and (r.instance_id, r.epoch, r.principal_id) <> (c.instance_id, c.epoch, c.principal_id)) then
    raise exception sqlstate 'PT403' using message = 'FORBIDDEN';
  end if;
  v_support := private.v2_mandate_support(c.instance_id, c.epoch, c.principal_id, v_policy);
  select * into v_row from private.v2_mandate_reviews r
    where r.review_id = p_review_id and r.instance_id = c.instance_id
      and r.epoch = c.epoch and r.principal_id = c.principal_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  v_digest := private.v2_mandate_digest(v_support);
  if (v_policy ->> 'notBefore')::timestamptz < v_now
    or (v_policy ->> 'expiresAt')::timestamptz <= v_now
    or (v_support ->> 'credentialExpiresAt')::timestamptz <= v_now
    or (v_support ->> 'profileExpiresAt')::timestamptz <= v_now
  then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
  if v_row.review_id is not null then
    if v_row.state <> 'pending' or v_row.expires_at <= v_now
      or v_row.policy is distinct from v_policy or v_row.summary_digest <> v_digest then
      raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
    end if;
    return jsonb_build_object('reviewId', v_row.review_id, 'revision', 1, 'summaryDigest', v_row.summary_digest,
      'expiresAt', private.v2_mandate_instant(v_row.expires_at), 'policySummary', v_row.policy_summary);
  end if;
  v_expiry := least(v_now + interval '5 minutes', (v_support ->> 'credentialExpiresAt')::timestamptz,
    (v_support ->> 'profileExpiresAt')::timestamptz, (v_policy ->> 'expiresAt')::timestamptz);
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id, epoch, principal_id) = (c.instance_id, c.epoch, c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id, c.epoch, c.principal_id, v_sequence, 'mandate_reviewed', v_now);
  insert into private.v2_mandate_reviews(review_id, instance_id, epoch, principal_id,
    actor_id, credential_id, credential_revision, profile_id, profile_revision,
    policy, policy_summary, host_snapshot, summary_digest, reviewed_at, expires_at, reviewed_sequence)
  values (p_review_id, c.instance_id, c.epoch, c.principal_id,
    (v_policy ->> 'actorId')::uuid, (v_support ->> 'credentialId')::uuid, (v_support ->> 'credentialRevision')::bigint,
    (v_policy ->> 'profileId')::uuid, (v_policy ->> 'profileRevision')::bigint,
    v_policy, v_support -> 'summary', v_support -> 'hostSnapshot', v_digest, v_now, v_expiry, v_sequence);
  return jsonb_build_object('reviewId', p_review_id, 'revision', 1, 'summaryDigest', v_digest,
    'expiresAt', private.v2_mandate_instant(v_expiry), 'policySummary', v_support -> 'summary');
exception
  when unique_violation then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_approve_mandate_v2(p_context jsonb, p_review_id uuid,
  p_mandate_id uuid, p_expected_revision bigint, p_summary_digest text)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_mandate_reviews%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_support jsonb;
  v_now timestamptz;
  v_sequence bigint;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id, c.epoch, c.principal_id);
  -- Read ownership before any referenced object lock; the principal fence makes
  -- this stable across all control RPCs. Re-lock in credential/profile/mandate/review order.
  select * into v_row from private.v2_mandate_reviews r
    where r.review_id = p_review_id and r.instance_id = c.instance_id
      and r.epoch = c.epoch and r.principal_id = c.principal_id;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  if p_expected_revision is null or p_expected_revision <> 1
    or p_summary_digest is null or p_summary_digest <> v_row.summary_digest
    or p_mandate_id is null or v_row.state = 'invalidated'
  then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
  v_support := private.v2_mandate_support(c.instance_id, c.epoch, c.principal_id,
    v_row.policy, v_row.state <> 'approved');
  if private.v2_mandate_digest(v_support) <> v_row.summary_digest
  then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
  if v_row.state = 'approved' then
    select * into v_mandate from private.v2_mandates m
      where m.mandate_id = v_row.approved_mandate_id and m.instance_id = c.instance_id
        and m.epoch = c.epoch and m.principal_id = c.principal_id for update;
    if not found then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
    perform private.v2_assert_account(c.principal_id);
    perform private.v2_assert_instance(c.instance_id, c.epoch);
    v_now := clock_timestamp();
    if v_mandate.state <> 'active' or v_mandate.expires_at <= v_now
    then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
    -- A different fresh internal UUID cannot mint a second grant after a lost
    -- acknowledgement. The original review is the unique issuance identity.
    return jsonb_build_object('mandateId', v_mandate.mandate_id, 'revision', v_mandate.revision,
      'state', 'active', 'issuedAt', private.v2_mandate_instant(v_mandate.issued_at),
      'expiresAt', private.v2_mandate_instant(v_mandate.expires_at));
  end if;
  select * into v_row from private.v2_mandate_reviews r
    where r.review_id = p_review_id and r.instance_id = c.instance_id
      and r.epoch = c.epoch and r.principal_id = c.principal_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  if v_row.expires_at <= v_now or (v_row.policy ->> 'notBefore')::timestamptz < v_now
    or (v_row.policy ->> 'expiresAt')::timestamptz <= v_now
    or (v_row.policy ->> 'expiresAt')::timestamptz > v_now + interval '24 hours'
  then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT'; end if;
  if exists (select 1 from private.v2_mandates m where m.mandate_id = p_mandate_id) then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id, epoch, principal_id) = (c.instance_id, c.epoch, c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id, c.epoch, c.principal_id, v_sequence, 'mandate_approved', v_now);
  insert into private.v2_mandates(mandate_id, review_id, instance_id, epoch, principal_id,
    actor_id, credential_id, credential_revision, profile_id, profile_revision,
    policy, host_snapshot, summary_digest, issued_at, expires_at, issued_sequence)
  values (p_mandate_id, v_row.review_id, c.instance_id, c.epoch, c.principal_id,
    v_row.actor_id, v_row.credential_id, v_row.credential_revision, v_row.profile_id, v_row.profile_revision,
    v_row.policy, v_row.host_snapshot, v_row.summary_digest, v_now,
    (v_row.policy ->> 'expiresAt')::timestamptz, v_sequence);
  update private.v2_mandate_reviews set state = 'approved', policy_summary = null,
    approved_mandate_id = p_mandate_id where review_id = v_row.review_id;
  return jsonb_build_object('mandateId', p_mandate_id, 'revision', 1, 'state', 'active',
    'issuedAt', private.v2_mandate_instant(v_now),
    'expiresAt', private.v2_mandate_instant((v_row.policy ->> 'expiresAt')::timestamptz));
exception
  when unique_violation then raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_get_mandate_v2(p_context jsonb, p_mandate_id uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_mandates%rowtype;
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_state text;
  v_now timestamptz;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id, c.epoch, c.principal_id);
  select * into v_row from private.v2_mandates m where m.mandate_id = p_mandate_id
    and m.instance_id = c.instance_id and m.epoch = c.epoch and m.principal_id = c.principal_id;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  select * into v_credential from private.v2_actor_credentials a where a.credential_id = v_row.credential_id
    and a.instance_id = c.instance_id and a.epoch = c.epoch and a.principal_id = c.principal_id for update;
  select * into v_profile from private.v2_booker_profiles p where p.profile_id = v_row.profile_id
    and p.instance_id = c.instance_id and p.epoch = c.epoch and p.principal_id = c.principal_id for update;
  select * into v_row from private.v2_mandates m where m.mandate_id = p_mandate_id
    and m.instance_id = c.instance_id and m.epoch = c.epoch and m.principal_id = c.principal_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  v_state := case when v_row.state = 'revoked' or v_credential.state is distinct from 'active'
      or v_profile.state is distinct from 'active' then 'revoked'
    when v_row.expires_at <= v_now or v_credential.expires_at <= v_now or v_profile.expires_at <= v_now then 'expired'
    else 'active' end;
  -- This is owner-only budget metadata, not a delegated admission decision.
  -- No PII, policy bounds, credential reference or booking lookup is returned.
  return jsonb_build_object('mandateId', v_row.mandate_id, 'revision', v_row.revision, 'state', v_state,
    'issuedAt', private.v2_mandate_instant(v_row.issued_at),
    'expiresAt', private.v2_mandate_instant(v_row.expires_at),
    'remainingUses', case when v_state = 'active' then 1 else 0 end);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

create function public.project_s_revoke_mandate_v2(p_context jsonb, p_mandate_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_mandates%rowtype;
  v_now timestamptz;
  v_sequence bigint;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id, c.epoch, c.principal_id);
  select * into v_row from private.v2_mandates m where m.mandate_id = p_mandate_id
    and m.instance_id = c.instance_id and m.epoch = c.epoch and m.principal_id = c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  if p_expected_revision is null or p_expected_revision <> 1 then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;
  if v_row.state = 'revoked' then
    return jsonb_build_object('mandateId', v_row.mandate_id, 'revision', v_row.revision, 'state', 'revoked',
      'revokedAt', private.v2_mandate_instant(v_row.revoked_at));
  end if;
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id, epoch, principal_id) = (c.instance_id, c.epoch, c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id, c.epoch, c.principal_id, v_sequence, 'mandate_revoked', v_now);
  update private.v2_mandates set state = 'revoked', revision = 2,
    revoked_at = v_now, revoked_sequence = v_sequence where mandate_id = v_row.mandate_id;
  return jsonb_build_object('mandateId', v_row.mandate_id, 'revision', 2, 'state', 'revoked',
    'revokedAt', private.v2_mandate_instant(v_now));
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

-- Profile deletion and every dependent invalidation share one principal fence,
-- one event and one transaction. No caller can observe an acknowledged deletion
-- with an active dependent policy, and no pending review retains copied PII.
create or replace function public.project_s_delete_booker_profile_v2(
  p_context jsonb, p_profile_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer
set search_path = pg_catalog set lock_timeout = '1s' set statement_timeout = '5s'
as $$
declare
  c record;
  v_row private.v2_booker_profiles%rowtype;
  v_now timestamptz;
  v_sequence bigint;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id, c.epoch, c.principal_id);
  select * into v_row from private.v2_booker_profiles p where p.profile_id = p_profile_id
    and p.instance_id = c.instance_id and p.epoch = c.epoch and p.principal_id = c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message = 'FORBIDDEN'; end if;
  -- Lock dependent rows in deterministic mandate-before-review order.
  perform m.mandate_id from private.v2_mandates m where m.profile_id = p_profile_id
    and m.instance_id = c.instance_id and m.epoch = c.epoch and m.principal_id = c.principal_id
    order by m.mandate_id for update;
  perform r.review_id from private.v2_mandate_reviews r where r.profile_id = p_profile_id
    and r.instance_id = c.instance_id and r.epoch = c.epoch and r.principal_id = c.principal_id
    order by r.review_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id, c.epoch);
  v_now := clock_timestamp();
  if p_expected_revision is null or p_expected_revision <> 1 then
    raise exception sqlstate 'PT409' using message = 'VERSION_CONFLICT';
  end if;
  if v_row.state = 'deleted' then
    return jsonb_build_object('profileId', v_row.profile_id, 'state', 'deleted', 'deletedAt', v_row.deleted_at);
  end if;
  update private.v2_authority_principals set event_sequence = event_sequence + 1
    where (instance_id, epoch, principal_id) = (c.instance_id, c.epoch, c.principal_id)
    returning event_sequence into v_sequence;
  insert into private.v2_authority_events values
    (c.instance_id, c.epoch, c.principal_id, v_sequence, 'profile_deleted', v_now);
  update private.v2_mandates set state = 'revoked', revision = 2,
    revoked_at = v_now, revoked_sequence = v_sequence
    where profile_id = p_profile_id and instance_id = c.instance_id and epoch = c.epoch
      and principal_id = c.principal_id and state = 'active';
  update private.v2_mandate_reviews set state = 'invalidated', policy_summary = null,
    invalidated_at = v_now, invalidated_sequence = v_sequence
    where profile_id = p_profile_id and instance_id = c.instance_id and epoch = c.epoch
      and principal_id = c.principal_id and state = 'pending';
  update private.v2_booker_profiles set state = 'deleted', name = null, email = null,
    guest_time_zone = null, deleted_at = v_now, deleted_sequence = v_sequence where profile_id = v_row.profile_id;
  return jsonb_build_object('profileId', v_row.profile_id, 'state', 'deleted', 'deletedAt', v_now);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

revoke all on function private.v2_mandate_instant(timestamptz),
  private.v2_normalize_mandate_policy(jsonb), private.v2_lock_mandate_principal(uuid, bigint, uuid),
  private.v2_mandate_host_snapshot(text, uuid), private.v2_mandate_support(uuid, bigint, uuid, jsonb, boolean),
  private.v2_mandate_digest(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.project_s_create_mandate_review_v2(jsonb, uuid, jsonb),
  public.project_s_approve_mandate_v2(jsonb, uuid, uuid, bigint, text),
  public.project_s_get_mandate_v2(jsonb, uuid), public.project_s_revoke_mandate_v2(jsonb, uuid, bigint),
  public.project_s_delete_booker_profile_v2(jsonb, uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.project_s_create_mandate_review_v2(jsonb, uuid, jsonb),
  public.project_s_approve_mandate_v2(jsonb, uuid, uuid, bigint, text),
  public.project_s_get_mandate_v2(jsonb, uuid), public.project_s_revoke_mandate_v2(jsonb, uuid, bigint),
  public.project_s_delete_booker_profile_v2(jsonb, uuid, bigint) to service_role;

commit;
