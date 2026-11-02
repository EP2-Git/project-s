-- Private actor preparations and pending step-up requests (ADR 0004).
-- No instance, route, booking commit or step-up approval is enabled.
begin;
set local search_path = pg_catalog;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered','actor_revoked','profile_reviewed','profile_deleted',
    'mandate_reviewed','mandate_approved','mandate_revoked','preparation_created','step_up_requested'));
alter table private.v2_mandates add constraint v2_mandates_preparation_binding_key
  unique (instance_id,epoch,principal_id,mandate_id,actor_id,credential_id,profile_id,profile_revision);

create table private.v2_delegated_preparations (
  preparation_id uuid primary key,
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  actor_id uuid not null,
  credential_id uuid not null,
  credential_revision bigint not null check (credential_revision=1),
  profile_id uuid not null,
  profile_revision bigint not null check (profile_revision=1),
  mandate_id uuid not null,
  mandate_revision bigint not null check (mandate_revision=1),
  provider text not null default 'local_mandate' check (provider='local_mandate'),
  provider_version integer not null default 1 check (provider_version=1),
  request jsonb not null check (jsonb_typeof(request)='object'),
  summary jsonb check (summary is null or jsonb_typeof(summary)='object'),
  host_snapshot jsonb not null check (jsonb_typeof(host_snapshot)='object'),
  intent_digest text not null check (intent_digest ~ '^[a-f0-9]{64}$'),
  summary_digest text not null check (summary_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','invalidated')),
  created_sequence bigint not null,
  invalidated_at timestamptz,
  invalidated_sequence bigint,
  check (isfinite(created_at) and isfinite(expires_at) and expires_at>created_at
    and expires_at<=created_at+interval '10 minutes'),
  check ((state='pending' and summary is not null and invalidated_at is null and invalidated_sequence is null)
    or (state='invalidated' and summary is null and invalidated_at is not null and isfinite(invalidated_at) and invalidated_sequence is not null)),
  foreign key (instance_id,epoch,principal_id,mandate_id,actor_id,credential_id,profile_id,profile_revision)
    references private.v2_mandates(instance_id,epoch,principal_id,mandate_id,actor_id,credential_id,profile_id,profile_revision),
  foreign key (instance_id,epoch,principal_id,created_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence),
  foreign key (instance_id,epoch,principal_id,invalidated_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence)
);

create table private.v2_step_up_requests (
  review_id uuid primary key,
  instance_id uuid not null,
  epoch bigint not null,
  principal_id uuid not null,
  actor_id uuid not null,
  credential_id uuid not null,
  credential_revision bigint not null check (credential_revision=1),
  profile_id uuid not null,
  profile_revision bigint not null check (profile_revision=1),
  mandate_id uuid not null,
  mandate_revision bigint not null check (mandate_revision=1),
  request jsonb not null check (jsonb_typeof(request)='object'),
  summary jsonb check (summary is null or jsonb_typeof(summary)='object'),
  host_snapshot jsonb not null check (jsonb_typeof(host_snapshot)='object'),
  differences jsonb not null check (jsonb_typeof(differences)='array' and jsonb_array_length(differences) between 1 and 4),
  intent_digest text not null check (intent_digest ~ '^[a-f0-9]{64}$'),
  summary_digest text not null check (summary_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending','invalidated')),
  created_sequence bigint not null,
  invalidated_at timestamptz,
  invalidated_sequence bigint,
  check (isfinite(created_at) and isfinite(expires_at) and expires_at>created_at
    and expires_at<=created_at+interval '5 minutes'),
  check ((state='pending' and summary is not null and invalidated_at is null and invalidated_sequence is null)
    or (state='invalidated' and summary is null and invalidated_at is not null and isfinite(invalidated_at) and invalidated_sequence is not null)),
  foreign key (instance_id,epoch,principal_id,mandate_id,actor_id,credential_id,profile_id,profile_revision)
    references private.v2_mandates(instance_id,epoch,principal_id,mandate_id,actor_id,credential_id,profile_id,profile_revision),
  foreign key (instance_id,epoch,principal_id,created_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence),
  foreign key (instance_id,epoch,principal_id,invalidated_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence)
);

create index v2_delegated_preparations_actor_idx
  on private.v2_delegated_preparations(instance_id,epoch,principal_id,actor_id,created_at);
create index v2_step_up_requests_actor_idx
  on private.v2_step_up_requests(instance_id,epoch,principal_id,actor_id,created_at);
create index v2_delegated_preparations_profile_idx
  on private.v2_delegated_preparations(instance_id,epoch,principal_id,profile_id,preparation_id);
create index v2_step_up_requests_profile_idx
  on private.v2_step_up_requests(instance_id,epoch,principal_id,profile_id,review_id);
alter table private.v2_delegated_preparations enable row level security;
alter table private.v2_step_up_requests enable row level security;
revoke all on private.v2_delegated_preparations,private.v2_step_up_requests
  from public,anon,authenticated,service_role;

create function private.v2_actor_context(p_context jsonb)
returns table (instance_id uuid,epoch bigint,principal_id uuid,actor_id uuid,
  credential_id uuid,credential_revision bigint,credential_fingerprint text)
language plpgsql set search_path=pg_catalog as $$
declare v_key text;
begin
  if jsonb_typeof(p_context) is distinct from 'object' then
    raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED';
  end if;
  if (select count(*) from jsonb_object_keys(p_context))<>12
    or exists(select 1 from jsonb_object_keys(p_context) k(key) where key not in (
      'contractVersion','requestId','principalId','subjectId','instanceId','epoch','verifiedAt',
      'transport','actorId','credentialId','credentialRevision','credentialFingerprint'))
    or p_context->'contractVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_context->'epoch') is distinct from 'number'
    or (p_context->>'epoch') !~ '^[0-9]+$'
    or jsonb_typeof(p_context->'credentialRevision') is distinct from 'number'
    or p_context->'credentialRevision' is distinct from '1'::jsonb
    or jsonb_typeof(p_context->'requestId') is distinct from 'string'
    or char_length(p_context->>'requestId') not between 8 and 128
    or (p_context->>'requestId') !~ '^[A-Za-z0-9._~-]+$'
    or jsonb_typeof(p_context->'transport') is distinct from 'string'
    or (p_context->>'transport') not in ('http','stdio_mcp')
    or jsonb_typeof(p_context->'credentialFingerprint') is distinct from 'string'
    or (p_context->>'credentialFingerprint') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_context->'verifiedAt') is distinct from 'string'
    or (p_context->>'verifiedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
    or not isfinite((p_context->>'verifiedAt')::timestamptz)
    or private.v2_mandate_instant((p_context->>'verifiedAt')::timestamptz)<>p_context->>'verifiedAt'
  then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  foreach v_key in array array['principalId','subjectId','instanceId','actorId','credentialId'] loop
    if jsonb_typeof(p_context->v_key) is distinct from 'string'
      or (p_context->>v_key)::uuid::text is distinct from p_context->>v_key
    then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  end loop;
  instance_id:=(p_context->>'instanceId')::uuid;
  epoch:=(p_context->>'epoch')::bigint;
  principal_id:=(p_context->>'principalId')::uuid;
  actor_id:=(p_context->>'actorId')::uuid;
  credential_id:=(p_context->>'credentialId')::uuid;
  credential_revision:=1;
  credential_fingerprint:=p_context->>'credentialFingerprint';
  if epoch not between 1 and 9007199254740991 or principal_id is distinct from (p_context->>'subjectId')::uuid
  then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  return next;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED';
end;
$$;

create function private.v2_normalize_delegated_request(p_request jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v_key text; v_start timestamptz;
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception sqlstate 'PT400' using message='VALIDATION_ERROR';
  end if;
  if (select count(*) from jsonb_object_keys(p_request))<>4
    or exists(select 1 from jsonb_object_keys(p_request) k(key)
      where key not in ('mandateId','username','meetingTypeId','startAt'))
    or jsonb_typeof(p_request->'username') is distinct from 'string'
    or (p_request->>'username') !~ '^[a-z0-9][a-z0-9_-]{2,29}$'
    or jsonb_typeof(p_request->'startAt') is distinct from 'string'
    or (p_request->>'startAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
  then raise exception sqlstate 'PT400' using message='VALIDATION_ERROR'; end if;
  foreach v_key in array array['mandateId','meetingTypeId'] loop
    if jsonb_typeof(p_request->v_key) is distinct from 'string'
      or (p_request->>v_key)::uuid::text is distinct from p_request->>v_key
    then raise exception sqlstate 'PT400' using message='VALIDATION_ERROR'; end if;
  end loop;
  v_start:=(p_request->>'startAt')::timestamptz;
  if not isfinite(v_start) or private.v2_mandate_instant(v_start)<>p_request->>'startAt'
  then raise exception sqlstate 'PT400' using message='VALIDATION_ERROR'; end if;
  return p_request;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception sqlstate 'PT400' using message='VALIDATION_ERROR';
end;
$$;

create function private.v2_prepared_data(p_row private.v2_delegated_preparations)
returns jsonb language sql immutable strict set search_path=pg_catalog as $$
  select jsonb_build_object('kind','prepared','data',jsonb_build_object(
    'preparationId',(p_row).preparation_id,'expiresAt',private.v2_mandate_instant((p_row).expires_at),
    'notHeld',true,'summaryDigest',(p_row).summary_digest,'summary',(p_row).summary));
$$;
create function private.v2_step_up_data(p_row private.v2_step_up_requests,p_audience text)
returns jsonb language sql immutable strict set search_path=pg_catalog as $$
  select jsonb_build_object('kind','step_up_required','stepUp',jsonb_build_object(
    'reviewId',(p_row).review_id,'expiresAt',private.v2_mandate_instant((p_row).expires_at),
    'reviewUrl',p_audience||'/authority/review#review='||(p_row).review_id::text));
$$;

create function public.project_s_prepare_delegated_booking_v2(
  p_context jsonb,p_preparation_id uuid,p_step_up_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='1s' set statement_timeout='5s' as $$
declare
  c record;
  v_request jsonb;
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_preparation private.v2_delegated_preparations%rowtype;
  v_review private.v2_step_up_requests%rowtype;
  v_disabled boolean;
  v_snapshot jsonb;
  v_summary jsonb;
  v_binding jsonb;
  v_differences jsonb:='[]'::jsonb;
  v_intent_digest text;
  v_summary_digest text;
  v_audience text;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz;
  v_final_now timestamptz;
  v_expiry timestamptz;
  v_in_scope boolean;
  v_pending integer;
  v_recent integer;
  v_sequence bigint;
begin
  select * into c from private.v2_actor_context(p_context);
  v_request:=private.v2_normalize_delegated_request(p_request);
  if p_preparation_id is null or p_step_up_id is null then
    raise exception sqlstate 'PT400' using message='VALIDATION_ERROR';
  end if;
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  select p.disabled into v_disabled from private.v2_authority_principals p
    where (p.instance_id,p.epoch,p.principal_id)=(c.instance_id,c.epoch,c.principal_id) for update;
  if not found or v_disabled then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  select * into v_credential from private.v2_actor_credentials a
    where a.credential_id=c.credential_id and a.actor_id=c.actor_id and a.instance_id=c.instance_id
      and a.epoch=c.epoch and a.principal_id=c.principal_id for update;
  if not found then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_credential.state<>'active' or v_credential.revision<>c.credential_revision
    or encode(v_credential.verifier,'hex')<>c.credential_fingerprint
    or v_credential.issued_at>v_now or v_credential.expires_at<=v_now
  then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;

  -- Ownership is checked before locking a policy reference. Actors cannot
  -- bootstrap a principal or use a known foreign ID as an authorization oracle.
  select * into v_mandate from private.v2_mandates m
    where m.mandate_id=(v_request->>'mandateId')::uuid and m.instance_id=c.instance_id
      and m.epoch=c.epoch and m.principal_id=c.principal_id and m.actor_id=c.actor_id
      and m.credential_id=c.credential_id;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  select * into v_profile from private.v2_booker_profiles p
    where p.profile_id=v_mandate.profile_id and p.instance_id=c.instance_id and p.epoch=c.epoch
      and p.principal_id=c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  select * into v_mandate from private.v2_mandates m
    where m.mandate_id=(v_request->>'mandateId')::uuid and m.instance_id=c.instance_id
      and m.epoch=c.epoch and m.principal_id=c.principal_id and m.actor_id=c.actor_id
      and m.credential_id=c.credential_id for update;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;

  -- Lock any reusable/newly proposed owned references before the legacy owner
  -- boundary. All normal writers already own this same principal fence.
  perform r.review_id from private.v2_step_up_requests r
    where r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id
      and r.actor_id=c.actor_id and (r.review_id=p_step_up_id or r.request=v_request)
    order by r.review_id for update;
  perform p.preparation_id from private.v2_delegated_preparations p
    where p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id
      and p.actor_id=c.actor_id and (p.preparation_id=p_preparation_id or p.request=v_request)
    order by p.preparation_id for update;

  perform private.v2_assert_account(c.principal_id);
  v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_credential.state<>'active' or v_credential.revision<>c.credential_revision
    or encode(v_credential.verifier,'hex')<>c.credential_fingerprint
    or v_credential.issued_at>v_now or v_credential.expires_at<=v_now
  then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  if v_mandate.state<>'active' or v_mandate.revision<>1
    or v_mandate.credential_revision<>v_credential.revision
    or v_profile.state<>'active' or v_profile.revision<>v_mandate.profile_revision or v_profile.expires_at<=v_now
  then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  if v_mandate.expires_at<=v_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
  if (v_mandate.policy->>'notBefore')::timestamptz>v_now
  then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;

  begin
    v_snapshot:=private.v2_mandate_host_snapshot(v_request->>'username',(v_request->>'meetingTypeId')::uuid);
  exception when sqlstate 'PT403' then
    raise exception sqlstate 'PT404' using message='MEETING_TYPE_UNAVAILABLE';
  end;
  -- Host/type key shares and the owner try-lock are held. Later schedule reads
  -- take no new mutable legacy row locks. No booking or v1 authority row changes.
  perform private.v2_assert_account(c.principal_id);
  v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_credential.expires_at<=v_now then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  if v_profile.expires_at<=v_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  if v_mandate.expires_at<=v_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
  v_start:=(v_request->>'startAt')::timestamptz;
  v_end:=private.add_minutes_utc(v_start,(v_snapshot->>'durationMinutes')::smallint);
  if v_start<v_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
    or v_end>v_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
  then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
  -- UTC is only a search-window partition. Exact instant membership is invariant
  -- across viewer zones; preserve the reviewed guest timezone in the summary.
  perform 1 from private.compute_free_slots_v1(v_request->>'username',(v_request->>'meetingTypeId')::uuid,
    (v_start at time zone 'UTC')::date,'UTC',v_now) slot where slot.slot_start=v_start;
  if not found then raise exception sqlstate 'PT409' using message='SLOT_UNAVAILABLE'; end if;
  v_summary:=jsonb_build_object('username',v_request->>'username',
    'hostDisplayName',v_snapshot->>'hostDisplayName','meetingTypeId',v_request->>'meetingTypeId',
    'meetingTypeTitle',v_snapshot->>'meetingTypeTitle','startAt',private.v2_mandate_instant(v_start),
    'endAt',private.v2_mandate_instant(v_end),'hostTimeZone',v_snapshot->>'hostTimeZone',
    'guestTimeZone',v_profile.guest_time_zone);
  v_binding:=jsonb_build_object('instanceId',c.instance_id,'epoch',c.epoch,'principalId',c.principal_id,
    'actorId',c.actor_id,'credentialId',c.credential_id,'credentialRevision',v_credential.revision,
    'profileId',v_profile.profile_id,'profileRevision',v_profile.revision,
    'mandateId',v_mandate.mandate_id,'mandateRevision',v_mandate.revision,
    'provider','local_mandate','providerVersion',1,'request',v_request,'hostSnapshot',v_snapshot);
  v_intent_digest:=encode(extensions.digest(convert_to('project-s:v2:delegated-intent:1:'||v_binding::text,'UTF8'),'sha256'),'hex');
  v_summary_digest:=encode(extensions.digest(convert_to('project-s:v2:delegated-summary:1:'||
    (v_binding||jsonb_build_object('summary',v_summary))::text,'UTF8'),'sha256'),'hex');
  v_in_scope:=v_snapshot->>'hostId'=v_mandate.host_snapshot->>'hostId'
    and v_request->>'username'=v_mandate.policy->>'username'
    and v_request->>'meetingTypeId'=v_mandate.policy->>'meetingTypeId'
    and v_start>=(v_mandate.policy->>'meetingWindowStart')::timestamptz
    and v_end<=(v_mandate.policy->>'meetingWindowEnd')::timestamptz
    and (v_snapshot->>'durationMinutes')::integer<=(v_mandate.policy->>'maxDurationMinutes')::integer;

  -- Final admission clock after all locks and potentially slow slot computation.
  -- These references remain frozen under the principal/owner fences.
  perform private.v2_assert_account(c.principal_id);
  v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_credential.expires_at<=v_now then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  if v_profile.expires_at<=v_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  if v_mandate.expires_at<=v_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
  if (v_mandate.policy->>'notBefore')::timestamptz>v_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  if v_start<v_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
    or v_end>v_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
  then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;

  if v_in_scope then
    select * into v_preparation from private.v2_delegated_preparations p
      where p.preparation_id=p_preparation_id;
    if found and (v_preparation.instance_id<>c.instance_id or v_preparation.epoch<>c.epoch
      or v_preparation.principal_id<>c.principal_id or v_preparation.actor_id<>c.actor_id
      or v_preparation.intent_digest<>v_intent_digest or v_preparation.state<>'pending' or v_preparation.expires_at<=v_now)
    then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
    if v_preparation.preparation_id is null then
      select * into v_preparation from private.v2_delegated_preparations p
        where p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id
          and p.actor_id=c.actor_id and p.credential_id=c.credential_id and p.mandate_id=v_mandate.mandate_id
          and p.intent_digest=v_intent_digest and p.state='pending' and p.expires_at>v_now
        order by p.created_at,p.preparation_id limit 1;
    end if;
    if v_preparation.preparation_id is not null then
      -- Recheck after every potential write/index/FK/audit wait. The locked
      -- support rows cannot change; their original expiries still advance in time.
      -- Preserve created_at/expires_at and roll back all writes on late denial.
      perform private.v2_assert_account(c.principal_id);
      v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
      v_final_now:=clock_timestamp();
      if v_credential.issued_at>v_final_now or v_credential.expires_at<=v_final_now then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
      if v_profile.expires_at<=v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
      if v_mandate.expires_at<=v_final_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
      if (v_mandate.policy->>'notBefore')::timestamptz>v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
      if v_preparation.expires_at<=v_final_now then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
      if v_start<v_final_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
        or v_end>v_final_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
      then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
      return private.v2_prepared_data(v_preparation);
    end if;
  else
    select * into v_review from private.v2_step_up_requests r where r.review_id=p_step_up_id;
    if found and (v_review.instance_id<>c.instance_id or v_review.epoch<>c.epoch
      or v_review.principal_id<>c.principal_id or v_review.actor_id<>c.actor_id
      or v_review.intent_digest<>v_intent_digest or v_review.state<>'pending' or v_review.expires_at<=v_now)
    then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
    if v_review.review_id is null then
      select * into v_review from private.v2_step_up_requests r
        where r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id
          and r.actor_id=c.actor_id and r.credential_id=c.credential_id and r.mandate_id=v_mandate.mandate_id
          and r.intent_digest=v_intent_digest and r.state='pending' and r.expires_at>v_now
        order by r.created_at,r.review_id limit 1;
    end if;
    if v_review.review_id is not null then
      -- Recheck after every potential write/index/FK/audit wait. The locked
      -- support rows cannot change; their original expiries still advance in time.
      -- Preserve created_at/expires_at and roll back all writes on late denial.
      perform private.v2_assert_account(c.principal_id);
      v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
      v_final_now:=clock_timestamp();
      if v_credential.issued_at>v_final_now or v_credential.expires_at<=v_final_now then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
      if v_profile.expires_at<=v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
      if v_mandate.expires_at<=v_final_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
      if (v_mandate.policy->>'notBefore')::timestamptz>v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
      if v_review.expires_at<=v_final_now then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
      if v_start<v_final_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
        or v_end>v_final_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
      then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
      return private.v2_step_up_data(v_review,v_audience);
    end if;
  end if;

  -- One principal fence serializes both capacity and rolling creation counts.
  -- Invalidating/expiring an item cannot evade the rolling creation allowance.
  select count(*)::integer into v_pending from (
    select 1 from private.v2_delegated_preparations p where p.instance_id=c.instance_id and p.epoch=c.epoch
      and p.principal_id=c.principal_id and p.actor_id=c.actor_id and p.state='pending' and p.expires_at>v_now
    union all
    select 1 from private.v2_step_up_requests r where r.instance_id=c.instance_id and r.epoch=c.epoch
      and r.principal_id=c.principal_id and r.actor_id=c.actor_id and r.state='pending' and r.expires_at>v_now
  ) pending;
  select count(*)::integer into v_recent from (
    select 1 from private.v2_delegated_preparations p where p.instance_id=c.instance_id and p.epoch=c.epoch
      and p.principal_id=c.principal_id and p.actor_id=c.actor_id and p.created_at>v_now-interval '10 minutes'
    union all
    select 1 from private.v2_step_up_requests r where r.instance_id=c.instance_id and r.epoch=c.epoch
      and r.principal_id=c.principal_id and r.actor_id=c.actor_id and r.created_at>v_now-interval '10 minutes'
  ) recent;
  if v_pending>=20 or v_recent>=20 then raise exception sqlstate 'PT429' using message='RATE_LIMITED'; end if;
  update private.v2_authority_principals set event_sequence=event_sequence+1
    where (instance_id,epoch,principal_id)=(c.instance_id,c.epoch,c.principal_id)
    returning event_sequence into v_sequence;
  if v_in_scope then
    v_expiry:=least(v_now+interval '10 minutes',v_credential.expires_at,v_profile.expires_at,v_mandate.expires_at);
    insert into private.v2_authority_events values
      (c.instance_id,c.epoch,c.principal_id,v_sequence,'preparation_created',v_now);
    insert into private.v2_delegated_preparations(preparation_id,instance_id,epoch,principal_id,
      actor_id,credential_id,credential_revision,profile_id,profile_revision,mandate_id,mandate_revision,
      request,summary,host_snapshot,intent_digest,summary_digest,created_at,expires_at,created_sequence)
    values(p_preparation_id,c.instance_id,c.epoch,c.principal_id,c.actor_id,c.credential_id,v_credential.revision,
      v_profile.profile_id,v_profile.revision,v_mandate.mandate_id,v_mandate.revision,
      v_request,v_summary,v_snapshot,v_intent_digest,v_summary_digest,v_now,v_expiry,v_sequence)
    returning * into v_preparation;
    -- Recheck after every potential write/index/FK/audit wait. The locked
    -- support rows cannot change; their original expiries still advance in time.
    -- Preserve created_at/expires_at and roll back all writes on late denial.
    perform private.v2_assert_account(c.principal_id);
    v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
    v_final_now:=clock_timestamp();
    if v_credential.issued_at>v_final_now or v_credential.expires_at<=v_final_now then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
    if v_profile.expires_at<=v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
    if v_mandate.expires_at<=v_final_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
    if (v_mandate.policy->>'notBefore')::timestamptz>v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
    if v_preparation.expires_at<=v_final_now then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
    if v_start<v_final_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
      or v_end>v_final_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
    then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
    return private.v2_prepared_data(v_preparation);
  end if;
  if v_snapshot->>'hostId'<>v_mandate.host_snapshot->>'hostId'
    or v_request->>'username'<>v_mandate.policy->>'username' then
    v_differences:=v_differences||jsonb_build_array(jsonb_build_object('field','host',
      'proposed',v_request->>'username','reviewed',v_mandate.policy->>'username'));
  end if;
  if v_request->>'meetingTypeId'<>v_mandate.policy->>'meetingTypeId' then
    v_differences:=v_differences||jsonb_build_array(jsonb_build_object('field','meeting_type',
      'proposed',v_snapshot->>'meetingTypeTitle','reviewed',v_mandate.host_snapshot->>'meetingTypeTitle'));
  end if;
  if v_start<(v_mandate.policy->>'meetingWindowStart')::timestamptz
    or v_end>(v_mandate.policy->>'meetingWindowEnd')::timestamptz then
    v_differences:=v_differences||jsonb_build_array(jsonb_build_object('field','meeting_window',
      'proposed',private.v2_mandate_instant(v_start)||' / '||private.v2_mandate_instant(v_end),
      'reviewed',(v_mandate.policy->>'meetingWindowStart')||' / '||(v_mandate.policy->>'meetingWindowEnd')));
  end if;
  if (v_snapshot->>'durationMinutes')::integer>(v_mandate.policy->>'maxDurationMinutes')::integer then
    v_differences:=v_differences||jsonb_build_array(jsonb_build_object('field','duration',
      'proposed',v_snapshot->>'durationMinutes','reviewed',v_mandate.policy->>'maxDurationMinutes'));
  end if;
  v_expiry:=least(v_now+interval '5 minutes',v_credential.expires_at,v_profile.expires_at,v_mandate.expires_at);
  insert into private.v2_authority_events values
    (c.instance_id,c.epoch,c.principal_id,v_sequence,'step_up_requested',v_now);
  insert into private.v2_step_up_requests(review_id,instance_id,epoch,principal_id,
    actor_id,credential_id,credential_revision,profile_id,profile_revision,mandate_id,mandate_revision,
    request,summary,host_snapshot,differences,intent_digest,summary_digest,created_at,expires_at,created_sequence)
  values(p_step_up_id,c.instance_id,c.epoch,c.principal_id,c.actor_id,c.credential_id,v_credential.revision,
    v_profile.profile_id,v_profile.revision,v_mandate.mandate_id,v_mandate.revision,
    v_request,v_summary,v_snapshot,v_differences,v_intent_digest,v_summary_digest,v_now,v_expiry,v_sequence)
  returning * into v_review;
  -- Recheck after every potential write/index/FK/audit wait. The locked
  -- support rows cannot change; their original expiries still advance in time.
  -- Preserve created_at/expires_at and roll back all writes on late denial.
  perform private.v2_assert_account(c.principal_id);
  v_audience:=private.v2_assert_instance(c.instance_id,c.epoch);
  v_final_now:=clock_timestamp();
  if v_credential.issued_at>v_final_now or v_credential.expires_at<=v_final_now then raise exception sqlstate 'PT401' using message='AUTHENTICATION_REQUIRED'; end if;
  if v_profile.expires_at<=v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  if v_mandate.expires_at<=v_final_now then raise exception sqlstate 'PT410' using message='MANDATE_EXPIRED'; end if;
  if (v_mandate.policy->>'notBefore')::timestamptz>v_final_now then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  if v_review.expires_at<=v_final_now then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  if v_start<v_final_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
    or v_end>v_final_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
  then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
  return private.v2_step_up_data(v_review,v_audience);
exception
  when unique_violation then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT';
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY';
end;
$$;

-- Forward profile deletion extends its existing atomic dependent invalidation.
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
  perform r.review_id from private.v2_step_up_requests r where r.profile_id=p_profile_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id
    order by r.review_id for update;
  perform p.preparation_id from private.v2_delegated_preparations p where p.profile_id=p_profile_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id
    order by p.preparation_id for update;
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
  update private.v2_step_up_requests set state='invalidated',summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch
      and principal_id=c.principal_id and state='pending';
  update private.v2_delegated_preparations set state='invalidated',summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch
      and principal_id=c.principal_id and state='pending';
  update private.v2_booker_profiles set state = 'deleted', name = null, email = null,
    guest_time_zone = null, deleted_at = v_now, deleted_sequence = v_sequence where profile_id = v_row.profile_id;
  return jsonb_build_object('profileId', v_row.profile_id, 'state', 'deleted', 'deletedAt', v_now);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;


revoke all on function private.v2_actor_context(jsonb),private.v2_normalize_delegated_request(jsonb),
  private.v2_prepared_data(private.v2_delegated_preparations),
  private.v2_step_up_data(private.v2_step_up_requests,text)
  from public,anon,authenticated,service_role;
revoke all on function public.project_s_prepare_delegated_booking_v2(jsonb,uuid,uuid,jsonb),
  public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.project_s_prepare_delegated_booking_v2(jsonb,uuid,uuid,jsonb),
  public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint) to service_role;
commit;
