-- Exact private principal approval and revocation under ADR 0004 C2.
-- A replacement has its own preparation and one-use grant. Booking remains a
-- separate transaction to implement and prove before synthetic enablement.
begin;
set local search_path = pg_catalog;

alter table private.v2_authority_events drop constraint v2_authority_events_action_check;
alter table private.v2_authority_events add constraint v2_authority_events_action_check
  check (action in ('actor_registered','actor_revoked','profile_reviewed','profile_deleted',
    'mandate_reviewed','mandate_approved','mandate_revoked','preparation_created','step_up_requested',
    'step_up_approved','step_up_revoked'));

alter table private.v2_mandates add column superseded_by_step_up uuid;
alter table private.v2_mandates add constraint v2_mandates_step_up_state_check
  check (superseded_by_step_up is null or (state='revoked' and revision=2));

alter table private.v2_step_up_requests
  add column revision bigint not null default 1 check (revision between 1 and 3),
  add column approved_grant_id uuid,
  add column approved_preparation_id uuid,
  add column approved_at timestamptz,
  add column approved_sequence bigint,
  add column revoked_from_revision bigint,
  add column revoked_at timestamptz,
  add column revoked_sequence bigint;
alter table private.v2_step_up_requests drop constraint v2_step_up_requests_state_check;
alter table private.v2_step_up_requests drop constraint v2_step_up_requests_check1;
alter table private.v2_step_up_requests add constraint v2_step_up_requests_state_check
  check (state in ('pending','approved','revoked','invalidated'));
alter table private.v2_step_up_requests add constraint v2_step_up_requests_lifecycle_check
  check ((state='pending' and revision=1 and summary is not null
      and approved_grant_id is null and approved_preparation_id is null and approved_at is null and approved_sequence is null
      and revoked_from_revision is null and revoked_at is null and revoked_sequence is null
      and invalidated_at is null and invalidated_sequence is null)
    or (state='approved' and revision=2 and summary is null
      and approved_grant_id is not null and approved_preparation_id is not null and approved_at is not null and isfinite(approved_at) and approved_sequence is not null
      and revoked_from_revision is null and revoked_at is null and revoked_sequence is null
      and invalidated_at is null and invalidated_sequence is null)
    or (state='revoked' and summary is null and revoked_from_revision is not null
      and revoked_at is not null and isfinite(revoked_at) and revoked_sequence is not null
      and ((revision=2 and revoked_from_revision=1 and approved_grant_id is null and approved_preparation_id is null
          and approved_at is null and approved_sequence is null)
        or (revision=3 and revoked_from_revision=2 and approved_grant_id is not null and approved_preparation_id is not null
          and approved_at is not null and isfinite(approved_at) and approved_sequence is not null))
      and invalidated_at is null and invalidated_sequence is null)
    or (state='invalidated' and summary is null and invalidated_at is not null and isfinite(invalidated_at) and invalidated_sequence is not null
      and revoked_from_revision is null and revoked_at is null and revoked_sequence is null
      and ((revision=1 and approved_grant_id is null and approved_preparation_id is null and approved_at is null and approved_sequence is null)
        or (revision=2 and approved_grant_id is not null and approved_preparation_id is not null
          and approved_at is not null and isfinite(approved_at) and approved_sequence is not null))));
alter table private.v2_step_up_requests add constraint v2_step_up_requests_grant_binding_key
  unique (instance_id,epoch,principal_id,review_id,mandate_id,actor_id,credential_id,profile_id,profile_revision);
alter table private.v2_step_up_requests add foreign key (instance_id,epoch,principal_id,approved_sequence)
  references private.v2_authority_events(instance_id,epoch,principal_id,sequence);
alter table private.v2_step_up_requests add foreign key (instance_id,epoch,principal_id,revoked_sequence)
  references private.v2_authority_events(instance_id,epoch,principal_id,sequence);

-- Approval IDs on the source review and original mandate are historical logical
-- references, matching the existing issuance-review pattern. Child FKs point
-- toward their parents, avoiding a circular deletion or insertion dependency.
create table private.v2_step_up_grants (
  grant_id uuid primary key,
  review_id uuid not null unique,
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
  revision bigint not null default 1 check (revision in (1,2)),
  state text not null default 'active' check (state in ('active','revoked','invalidated')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  created_sequence bigint not null,
  revoked_at timestamptz,
  revoked_sequence bigint,
  unique (instance_id,epoch,principal_id,mandate_id),
  unique (instance_id,epoch,principal_id,grant_id,review_id,mandate_id,actor_id,credential_id,profile_id,profile_revision),
  check (isfinite(issued_at) and isfinite(expires_at) and expires_at>issued_at
    and expires_at<=issued_at+interval '5 minutes'),
  check ((state='active' and revision=1 and revoked_at is null and revoked_sequence is null)
    or (state in ('revoked','invalidated') and revision=2 and revoked_at is not null and isfinite(revoked_at) and revoked_sequence is not null)),
  foreign key (instance_id,epoch,principal_id,review_id,mandate_id,actor_id,credential_id,profile_id,profile_revision)
    references private.v2_step_up_requests(instance_id,epoch,principal_id,review_id,mandate_id,actor_id,credential_id,profile_id,profile_revision),
  foreign key (instance_id,epoch,principal_id,created_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence),
  foreign key (instance_id,epoch,principal_id,revoked_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence)
);
create table private.v2_step_up_preparations (
  preparation_id uuid primary key,
  grant_id uuid not null unique,
  review_id uuid not null,
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
  provider text not null default 'principal_step_up' check (provider='principal_step_up'),
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
    and expires_at<=created_at+interval '5 minutes'),
  check ((state='pending' and summary is not null and invalidated_at is null and invalidated_sequence is null)
    or (state='invalidated' and summary is null and invalidated_at is not null and isfinite(invalidated_at) and invalidated_sequence is not null)),
  foreign key (instance_id,epoch,principal_id,grant_id,review_id,mandate_id,actor_id,credential_id,profile_id,profile_revision)
    references private.v2_step_up_grants(instance_id,epoch,principal_id,grant_id,review_id,mandate_id,actor_id,credential_id,profile_id,profile_revision),
  foreign key (instance_id,epoch,principal_id,created_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence),
  foreign key (instance_id,epoch,principal_id,invalidated_sequence)
    references private.v2_authority_events(instance_id,epoch,principal_id,sequence)
);
create index v2_step_up_grants_profile_idx on private.v2_step_up_grants(instance_id,epoch,principal_id,profile_id,grant_id);
create index v2_step_up_preparations_profile_idx on private.v2_step_up_preparations(instance_id,epoch,principal_id,profile_id,preparation_id);
alter table private.v2_step_up_grants enable row level security;
alter table private.v2_step_up_preparations enable row level security;
revoke all on private.v2_step_up_grants,private.v2_step_up_preparations from public,anon,authenticated,service_role;

create function public.project_s_approve_step_up_v2(
  p_context jsonb,p_review_id uuid,p_preparation_id uuid,p_grant_id uuid,
  p_expected_revision bigint,p_summary_digest text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='1s' set statement_timeout='5s'
as $$
declare
  c record;
  v_review private.v2_step_up_requests%rowtype;
  v_credential private.v2_actor_credentials%rowtype;
  v_profile private.v2_booker_profiles%rowtype;
  v_mandate private.v2_mandates%rowtype;
  v_grant private.v2_step_up_grants%rowtype;
  v_preparation private.v2_step_up_preparations%rowtype;
  v_snapshot jsonb;
  v_summary jsonb;
  v_binding jsonb;
  v_now timestamptz;
  v_final_now timestamptz;
  v_expiry timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_sequence bigint;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id,c.epoch,c.principal_id);
  if p_review_id is null or p_preparation_id is null or p_grant_id is null
    or p_summary_digest is null or p_summary_digest !~ '^[a-f0-9]{64}$'
  then raise exception sqlstate 'PT400' using message='VALIDATION_ERROR'; end if;
  select * into v_review from private.v2_step_up_requests r where r.review_id=p_review_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;

  -- Ownership precedes every child lock. Sibling reviews and old preparations
  -- are frozen before touching shared legacy host rows or the owner try-lock.
  select * into v_credential from private.v2_actor_credentials a where a.credential_id=v_review.credential_id
    and a.actor_id=v_review.actor_id and a.instance_id=c.instance_id and a.epoch=c.epoch and a.principal_id=c.principal_id for update;
  select * into v_profile from private.v2_booker_profiles p where p.profile_id=v_review.profile_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id for update;
  select * into v_mandate from private.v2_mandates m where m.mandate_id=v_review.mandate_id
    and m.instance_id=c.instance_id and m.epoch=c.epoch and m.principal_id=c.principal_id for update;
  perform r.review_id from private.v2_step_up_requests r where r.mandate_id=v_review.mandate_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id order by r.review_id for update;
  perform p.preparation_id from private.v2_delegated_preparations p where p.mandate_id=v_review.mandate_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id order by p.preparation_id for update;
  select * into v_grant from private.v2_step_up_grants g where g.review_id=p_review_id
    and g.instance_id=c.instance_id and g.epoch=c.epoch and g.principal_id=c.principal_id for update;
  select * into v_preparation from private.v2_step_up_preparations p where p.review_id=p_review_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id for update;
  select * into v_review from private.v2_step_up_requests r where r.review_id=p_review_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if p_expected_revision is distinct from 1 or p_summary_digest is distinct from v_review.summary_digest
    or v_credential.state is distinct from 'active' or v_credential.actor_id is distinct from v_review.actor_id
    or v_credential.credential_id is distinct from v_review.credential_id
    or v_credential.revision is distinct from v_review.credential_revision
    or v_credential.issued_at>v_now or v_credential.expires_at<=v_now
    or v_profile.state is distinct from 'active' or v_profile.profile_id is distinct from v_review.profile_id
    or v_profile.revision is distinct from v_review.profile_revision
    or v_profile.reviewed_at>v_now or v_profile.expires_at<=v_now
    or v_mandate.mandate_id is distinct from v_review.mandate_id
    or v_mandate.actor_id is distinct from v_review.actor_id or v_mandate.credential_id is distinct from v_review.credential_id
    or v_mandate.credential_revision is distinct from v_review.credential_revision
    or v_mandate.profile_id is distinct from v_review.profile_id or v_mandate.profile_revision is distinct from v_review.profile_revision
    or v_mandate.issued_at>v_now or v_mandate.expires_at<=v_now
    or (v_now >= (v_mandate.policy->>'notBefore')::timestamptz) is not true
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;

  -- A completed exact approval is reconciled before first-approval checks.
  -- It never extends the new grant or reacquires a slot that was never held.
  if v_review.state='approved' then
    if v_review.revision<>2 or v_mandate.state<>'revoked' or v_mandate.revision<>2
      or v_mandate.superseded_by_step_up is distinct from v_review.review_id
      or v_grant.grant_id is distinct from v_review.approved_grant_id
      or v_preparation.preparation_id is distinct from v_review.approved_preparation_id
      or v_preparation.grant_id is distinct from v_grant.grant_id
      or v_grant.state is distinct from 'active' or v_preparation.state is distinct from 'pending'
      or v_grant.issued_at>v_now or v_grant.expires_at<=v_now
      or v_preparation.created_at>v_now or v_preparation.expires_at<=v_now
    then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
    perform private.v2_assert_account(c.principal_id);
    perform private.v2_assert_instance(c.instance_id,c.epoch);
    v_final_now:=clock_timestamp();
    if v_credential.issued_at>v_final_now or v_credential.expires_at<=v_final_now
      or v_profile.reviewed_at>v_final_now or v_profile.expires_at<=v_final_now
      or v_mandate.issued_at>v_final_now or v_mandate.expires_at<=v_final_now
      or (v_final_now >= (v_mandate.policy->>'notBefore')::timestamptz) is not true
      or v_grant.issued_at>v_final_now or v_grant.expires_at<=v_final_now
      or v_preparation.created_at>v_final_now or v_preparation.expires_at<=v_final_now
    then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
    return jsonb_build_object('reviewId',v_review.review_id,'state','approved',
      'preparationId',v_preparation.preparation_id,'expiresAt',private.v2_mandate_instant(v_preparation.expires_at));
  end if;
  if v_review.state<>'pending' or v_review.revision<>1 or v_review.created_at>v_now or v_review.expires_at<=v_now
    or v_mandate.state<>'active' or v_mandate.revision<>v_review.mandate_revision
    or v_mandate.superseded_by_step_up is not null or v_grant.grant_id is not null or v_preparation.preparation_id is not null
    or v_review.summary->>'guestTimeZone' is distinct from v_profile.guest_time_zone
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  if exists(select 1 from private.v2_delegated_preparations p where p.preparation_id=p_preparation_id
      and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id)
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;

  begin
    v_snapshot:=private.v2_mandate_host_snapshot(v_review.request->>'username',(v_review.request->>'meetingTypeId')::uuid);
  exception when sqlstate 'PT403' then
    raise exception sqlstate 'PT409' using message='VERSION_CONFLICT';
  end;
  if v_snapshot is distinct from v_review.host_snapshot then
    raise exception sqlstate 'PT409' using message='VERSION_CONFLICT';
  end if;
  v_start:=(v_review.request->>'startAt')::timestamptz;
  v_end:=private.add_minutes_utc(v_start,(v_snapshot->>'durationMinutes')::smallint);
  v_summary:=jsonb_build_object('username',v_review.request->>'username','hostDisplayName',v_snapshot->>'hostDisplayName',
    'meetingTypeId',v_review.request->>'meetingTypeId','meetingTypeTitle',v_snapshot->>'meetingTypeTitle',
    'startAt',private.v2_mandate_instant(v_start),'endAt',private.v2_mandate_instant(v_end),
    'hostTimeZone',v_snapshot->>'hostTimeZone','guestTimeZone',v_profile.guest_time_zone);
  if v_summary is distinct from v_review.summary then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  v_binding:=jsonb_build_object('instanceId',c.instance_id,'epoch',c.epoch,'principalId',c.principal_id,
    'actorId',v_review.actor_id,'credentialId',v_review.credential_id,'credentialRevision',v_review.credential_revision,
    'profileId',v_review.profile_id,'profileRevision',v_review.profile_revision,'mandateId',v_review.mandate_id,
    'mandateRevision',v_review.mandate_revision,'provider','local_mandate','providerVersion',1,
    'request',v_review.request,'hostSnapshot',v_snapshot);
  if encode(extensions.digest(convert_to('project-s:v2:delegated-intent:1:'||v_binding::text,'UTF8'),'sha256'),'hex')
      is distinct from v_review.intent_digest
    or encode(extensions.digest(convert_to('project-s:v2:delegated-summary:1:'||
      (v_binding||jsonb_build_object('summary',v_summary))::text,'UTF8'),'sha256'),'hex')
      is distinct from v_review.summary_digest
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_credential.issued_at>v_now or v_credential.expires_at<=v_now or v_profile.reviewed_at>v_now or v_profile.expires_at<=v_now
    or v_mandate.issued_at>v_now or v_mandate.expires_at<=v_now
    or (v_now >= (v_mandate.policy->>'notBefore')::timestamptz) is not true
    or v_review.created_at>v_now or v_review.expires_at<=v_now
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  if v_start<v_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
    or v_end>v_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
  then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
  perform 1 from private.compute_free_slots_v1(v_review.request->>'username',(v_review.request->>'meetingTypeId')::uuid,
    (v_start at time zone 'UTC')::date,'UTC',v_now) slot where slot.slot_start=v_start;
  if not found then raise exception sqlstate 'PT409' using message='SLOT_UNAVAILABLE'; end if;
  -- The fresh grant lifetime starts once current scheduling has been derived.
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_credential.issued_at>v_now or v_credential.expires_at<=v_now or v_profile.reviewed_at>v_now or v_profile.expires_at<=v_now
    or v_mandate.issued_at>v_now or v_mandate.expires_at<=v_now
    or (v_now >= (v_mandate.policy->>'notBefore')::timestamptz) is not true
    or v_review.created_at>v_now or v_review.expires_at<=v_now
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  v_expiry:=least(v_now+interval '5 minutes',v_credential.expires_at,v_profile.expires_at,v_mandate.expires_at);
  update private.v2_authority_principals set event_sequence=event_sequence+1
    where (instance_id,epoch,principal_id)=(c.instance_id,c.epoch,c.principal_id) returning event_sequence into v_sequence;
  insert into private.v2_authority_events values(c.instance_id,c.epoch,c.principal_id,v_sequence,'step_up_approved',v_now);
  update private.v2_mandates set state='revoked',revision=2,revoked_at=v_now,revoked_sequence=v_sequence,
    superseded_by_step_up=v_review.review_id where mandate_id=v_mandate.mandate_id;
  update private.v2_delegated_preparations set state='invalidated',summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id
      and mandate_id=v_mandate.mandate_id and state='pending';
  update private.v2_step_up_requests set state='invalidated',summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id
      and mandate_id=v_mandate.mandate_id and review_id<>v_review.review_id and state='pending';
  update private.v2_step_up_requests set state='approved',revision=2,summary=null,
    approved_grant_id=p_grant_id,approved_preparation_id=p_preparation_id,approved_at=v_now,approved_sequence=v_sequence
    where review_id=v_review.review_id;
  insert into private.v2_step_up_grants(grant_id,review_id,instance_id,epoch,principal_id,actor_id,credential_id,credential_revision,
    profile_id,profile_revision,mandate_id,mandate_revision,issued_at,expires_at,created_sequence)
  values(p_grant_id,v_review.review_id,c.instance_id,c.epoch,c.principal_id,v_review.actor_id,v_review.credential_id,v_review.credential_revision,
    v_review.profile_id,v_review.profile_revision,v_review.mandate_id,v_review.mandate_revision,v_now,v_expiry,v_sequence);
  v_binding:=jsonb_build_object('instanceId',c.instance_id,'epoch',c.epoch,'principalId',c.principal_id,
    'actorId',v_review.actor_id,'credentialId',v_review.credential_id,'credentialRevision',v_review.credential_revision,
    'profileId',v_review.profile_id,'profileRevision',v_review.profile_revision,'mandateId',v_review.mandate_id,
    'mandateRevision',v_review.mandate_revision,'reviewId',v_review.review_id,'reviewDigest',v_review.summary_digest,
    'grantId',p_grant_id,'provider','principal_step_up','providerVersion',1,'request',v_review.request,'hostSnapshot',v_snapshot);
  insert into private.v2_step_up_preparations(preparation_id,grant_id,review_id,instance_id,epoch,principal_id,
    actor_id,credential_id,credential_revision,profile_id,profile_revision,mandate_id,mandate_revision,
    request,summary,host_snapshot,intent_digest,summary_digest,created_at,expires_at,created_sequence)
  values(p_preparation_id,p_grant_id,v_review.review_id,c.instance_id,c.epoch,c.principal_id,v_review.actor_id,v_review.credential_id,
    v_review.credential_revision,v_review.profile_id,v_review.profile_revision,v_review.mandate_id,v_review.mandate_revision,
    v_review.request,v_summary,v_snapshot,
    encode(extensions.digest(convert_to('project-s:v2:step-up-intent:1:'||v_binding::text,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to('project-s:v2:step-up-summary:1:'||(v_binding||jsonb_build_object('summary',v_summary))::text,'UTF8'),'sha256'),'hex'),
    v_now,v_expiry,v_sequence);
  -- Index, FK and audit insertion can wait after admission. Preserve original
  -- times and roll back the complete replacement if authority expires there.
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_final_now:=clock_timestamp();
  if v_credential.issued_at>v_final_now or v_credential.expires_at<=v_final_now
    or v_profile.reviewed_at>v_final_now or v_profile.expires_at<=v_final_now
    or v_mandate.issued_at>v_final_now or v_mandate.expires_at<=v_final_now
    or (v_final_now >= (v_mandate.policy->>'notBefore')::timestamptz) is not true
    or v_review.created_at>v_final_now or v_review.expires_at<=v_final_now
    or v_now>v_final_now or v_expiry<=v_final_now
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  if v_start<v_final_now+(v_snapshot->>'minimumNoticeMinutes')::integer*interval '1 minute'
    or v_end>v_final_now+(v_snapshot->>'maximumAdvanceDays')::integer*interval '1 day'
  then raise exception sqlstate 'PT409' using message='OUTSIDE_BOOKING_WINDOW'; end if;
  return jsonb_build_object('reviewId',v_review.review_id,'state','approved',
    'preparationId',p_preparation_id,'expiresAt',private.v2_mandate_instant(v_expiry));
exception
  when unique_violation then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT';
  when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
    raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY';
end;
$$;

create function public.project_s_revoke_step_up_v2(p_context jsonb,p_review_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='1s' set statement_timeout='5s'
as $$
declare
  c record;
  v_review private.v2_step_up_requests%rowtype;
  v_grant private.v2_step_up_grants%rowtype;
  v_now timestamptz;
  v_sequence bigint;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id,c.epoch,c.principal_id);
  select * into v_review from private.v2_step_up_requests r where r.review_id=p_review_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  perform m.mandate_id from private.v2_mandates m where m.mandate_id=v_review.mandate_id
    and m.instance_id=c.instance_id and m.epoch=c.epoch and m.principal_id=c.principal_id for update;
  select * into v_review from private.v2_step_up_requests r where r.review_id=p_review_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id for update;
  select * into v_grant from private.v2_step_up_grants g where g.review_id=p_review_id
    and g.instance_id=c.instance_id and g.epoch=c.epoch and g.principal_id=c.principal_id for update;
  perform p.preparation_id from private.v2_step_up_preparations p where p.review_id=p_review_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id order by p.preparation_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if v_review.state='revoked' and p_expected_revision is not distinct from v_review.revoked_from_revision then
    return jsonb_build_object('reviewId',v_review.review_id,'state','revoked','revision',v_review.revision,
      'revokedAt',private.v2_mandate_instant(v_review.revoked_at));
  end if;
  if v_review.state not in ('pending','approved') or p_expected_revision is distinct from v_review.revision
    or (v_review.state='approved' and (v_grant.grant_id is distinct from v_review.approved_grant_id
      or v_grant.state is distinct from 'active'))
  then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  update private.v2_authority_principals set event_sequence=event_sequence+1
    where (instance_id,epoch,principal_id)=(c.instance_id,c.epoch,c.principal_id) returning event_sequence into v_sequence;
  insert into private.v2_authority_events values(c.instance_id,c.epoch,c.principal_id,v_sequence,'step_up_revoked',v_now);
  update private.v2_step_up_requests set state='revoked',summary=null,revision=v_review.revision+1,
    revoked_from_revision=v_review.revision,revoked_at=v_now,revoked_sequence=v_sequence where review_id=v_review.review_id;
  update private.v2_step_up_grants set state='revoked',revision=2,revoked_at=v_now,revoked_sequence=v_sequence
    where review_id=v_review.review_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='active';
  update private.v2_step_up_preparations set state='invalidated',summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where review_id=v_review.review_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='pending';
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  if v_now>clock_timestamp() then raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY'; end if;
  return jsonb_build_object('reviewId',v_review.review_id,'state','revoked','revision',v_review.revision+1,
    'revokedAt',private.v2_mandate_instant(v_now));
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY';
end;
$$;

-- The original policy remains revoked after replacement expiry. An explicit
-- revoke must still fence its linked unused grant, including an idempotent
-- revoke of a policy whose earlier revocation was part of step-up approval.
create or replace function public.project_s_revoke_mandate_v2(p_context jsonb,p_mandate_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='1s' set statement_timeout='5s'
as $$
declare
  c record;
  v_mandate private.v2_mandates%rowtype;
  v_now timestamptz;
  v_sequence bigint;
  v_linked_active boolean;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id,c.epoch,c.principal_id);
  select * into v_mandate from private.v2_mandates m where m.mandate_id=p_mandate_id
    and m.instance_id=c.instance_id and m.epoch=c.epoch and m.principal_id=c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  perform r.review_id from private.v2_step_up_requests r where r.mandate_id=p_mandate_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id order by r.review_id for update;
  perform g.grant_id from private.v2_step_up_grants g where g.mandate_id=p_mandate_id
    and g.instance_id=c.instance_id and g.epoch=c.epoch and g.principal_id=c.principal_id order by g.grant_id for update;
  perform p.preparation_id from private.v2_step_up_preparations p where p.mandate_id=p_mandate_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id order by p.preparation_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if p_expected_revision is distinct from 1 then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  select exists(select 1 from private.v2_step_up_grants g where g.mandate_id=p_mandate_id
    and g.instance_id=c.instance_id and g.epoch=c.epoch and g.principal_id=c.principal_id and g.state='active') into v_linked_active;
  if v_mandate.state='revoked' and not v_linked_active then
    return jsonb_build_object('mandateId',v_mandate.mandate_id,'revision',v_mandate.revision,'state','revoked',
      'revokedAt',private.v2_mandate_instant(v_mandate.revoked_at));
  end if;
  update private.v2_authority_principals set event_sequence=event_sequence+1
    where (instance_id,epoch,principal_id)=(c.instance_id,c.epoch,c.principal_id) returning event_sequence into v_sequence;
  insert into private.v2_authority_events values(c.instance_id,c.epoch,c.principal_id,v_sequence,'mandate_revoked',v_now);
  if v_mandate.state='active' then
    update private.v2_mandates set state='revoked',revision=2,revoked_at=v_now,revoked_sequence=v_sequence
      where mandate_id=v_mandate.mandate_id returning * into v_mandate;
  end if;
  update private.v2_step_up_requests r set state='revoked',summary=null,revision=3,
    revoked_from_revision=2,revoked_at=v_now,revoked_sequence=v_sequence
    where r.mandate_id=p_mandate_id and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id
      and r.state='approved' and exists(select 1 from private.v2_step_up_grants g where g.review_id=r.review_id
        and g.instance_id=c.instance_id and g.epoch=c.epoch and g.principal_id=c.principal_id and g.state='active');
  update private.v2_step_up_grants set state='revoked',revision=2,revoked_at=v_now,revoked_sequence=v_sequence
    where mandate_id=p_mandate_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='active';
  update private.v2_step_up_preparations set state='invalidated',summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where mandate_id=p_mandate_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='pending';
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  if v_now>clock_timestamp() then raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY'; end if;
  return jsonb_build_object('mandateId',v_mandate.mandate_id,'revision',v_mandate.revision,'state','revoked',
    'revokedAt',private.v2_mandate_instant(v_mandate.revoked_at));
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY';
end;
$$;

create or replace function public.project_s_delete_booker_profile_v2(p_context jsonb,p_profile_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set lock_timeout='1s' set statement_timeout='5s'
as $$
declare
  c record;
  v_profile private.v2_booker_profiles%rowtype;
  v_now timestamptz;
  v_sequence bigint;
begin
  select * into c from private.v2_principal_context(p_context);
  perform private.v2_lock_mandate_principal(c.instance_id,c.epoch,c.principal_id);
  select * into v_profile from private.v2_booker_profiles p where p.profile_id=p_profile_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id for update;
  if not found then raise exception sqlstate 'PT403' using message='FORBIDDEN'; end if;
  perform m.mandate_id from private.v2_mandates m where m.profile_id=p_profile_id
    and m.instance_id=c.instance_id and m.epoch=c.epoch and m.principal_id=c.principal_id order by m.mandate_id for update;
  perform r.review_id from private.v2_mandate_reviews r where r.profile_id=p_profile_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id order by r.review_id for update;
  perform r.review_id from private.v2_step_up_requests r where r.profile_id=p_profile_id
    and r.instance_id=c.instance_id and r.epoch=c.epoch and r.principal_id=c.principal_id order by r.review_id for update;
  perform p.preparation_id from private.v2_delegated_preparations p where p.profile_id=p_profile_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id order by p.preparation_id for update;
  perform g.grant_id from private.v2_step_up_grants g where g.profile_id=p_profile_id
    and g.instance_id=c.instance_id and g.epoch=c.epoch and g.principal_id=c.principal_id order by g.grant_id for update;
  perform p.preparation_id from private.v2_step_up_preparations p where p.profile_id=p_profile_id
    and p.instance_id=c.instance_id and p.epoch=c.epoch and p.principal_id=c.principal_id order by p.preparation_id for update;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  v_now:=clock_timestamp();
  if p_expected_revision is distinct from 1 then raise exception sqlstate 'PT409' using message='VERSION_CONFLICT'; end if;
  if v_profile.state='deleted' then
    return jsonb_build_object('profileId',v_profile.profile_id,'state','deleted','deletedAt',v_profile.deleted_at);
  end if;
  update private.v2_authority_principals set event_sequence=event_sequence+1
    where (instance_id,epoch,principal_id)=(c.instance_id,c.epoch,c.principal_id) returning event_sequence into v_sequence;
  insert into private.v2_authority_events values(c.instance_id,c.epoch,c.principal_id,v_sequence,'profile_deleted',v_now);
  update private.v2_mandates set state='revoked',revision=2,revoked_at=v_now,revoked_sequence=v_sequence
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='active';
  update private.v2_mandate_reviews set state='invalidated',policy_summary=null,invalidated_at=v_now,invalidated_sequence=v_sequence
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='pending';
  -- Preserve prior revocation evidence, but remove every remaining cached profile
  -- field, including timezone, even from a previously closed request.
  update private.v2_step_up_requests set summary=null,
    state=case when state in ('pending','approved') then 'invalidated' else state end,
    invalidated_at=case when state in ('pending','approved') then v_now else invalidated_at end,
    invalidated_sequence=case when state in ('pending','approved') then v_sequence else invalidated_sequence end
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id
      and (summary is not null or state in ('pending','approved'));
  update private.v2_delegated_preparations set summary=null,
    state=case when state='pending' then 'invalidated' else state end,
    invalidated_at=case when state='pending' then v_now else invalidated_at end,
    invalidated_sequence=case when state='pending' then v_sequence else invalidated_sequence end
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id
      and (summary is not null or state='pending');
  update private.v2_step_up_grants set state='invalidated',revision=2,revoked_at=v_now,revoked_sequence=v_sequence
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id and state='active';
  update private.v2_step_up_preparations set summary=null,
    state=case when state='pending' then 'invalidated' else state end,
    invalidated_at=case when state='pending' then v_now else invalidated_at end,
    invalidated_sequence=case when state='pending' then v_sequence else invalidated_sequence end
    where profile_id=p_profile_id and instance_id=c.instance_id and epoch=c.epoch and principal_id=c.principal_id
      and (summary is not null or state='pending');
  update private.v2_booker_profiles set state='deleted',name=null,email=null,guest_time_zone=null,
    deleted_at=v_now,deleted_sequence=v_sequence where profile_id=v_profile.profile_id;
  perform private.v2_assert_account(c.principal_id);
  perform private.v2_assert_instance(c.instance_id,c.epoch);
  if v_now>clock_timestamp() then raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY'; end if;
  return jsonb_build_object('profileId',v_profile.profile_id,'state','deleted','deletedAt',v_now);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message='AUTHORITY_BUSY';
end;
$$;

revoke all on function public.project_s_approve_step_up_v2(jsonb,uuid,uuid,uuid,bigint,text),
  public.project_s_revoke_step_up_v2(jsonb,uuid,bigint),
  public.project_s_revoke_mandate_v2(jsonb,uuid,bigint),public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.project_s_approve_step_up_v2(jsonb,uuid,uuid,uuid,bigint,text),
  public.project_s_revoke_step_up_v2(jsonb,uuid,bigint),
  public.project_s_revoke_mandate_v2(jsonb,uuid,bigint),public.project_s_delete_booker_profile_v2(jsonb,uuid,bigint)
  to service_role;
commit;
