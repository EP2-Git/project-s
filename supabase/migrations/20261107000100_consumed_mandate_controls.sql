-- ADR 0004: report and enforce the durable one-use booking budget.
begin;
set local search_path = pg_catalog;

create or replace function public.project_s_prepare_delegated_booking_v2(
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

  perform private.v2_assert_mandate_unused(c.instance_id,c.epoch,c.principal_id,v_mandate.mandate_id);

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

create or replace function public.project_s_approve_step_up_v2(
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
  perform private.v2_assert_mandate_unused(c.instance_id,c.epoch,c.principal_id,v_mandate.mandate_id);
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

create or replace function public.project_s_get_mandate_v2(p_context jsonb, p_mandate_id uuid)
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
    'remainingUses', case when v_state = 'active' and not exists (
      select 1 from private.v2_booking_receipts r
      where (r.instance_id,r.epoch,r.principal_id,r.mandate_id) =
        (c.instance_id,c.epoch,c.principal_id,v_row.mandate_id)
    ) then 1 else 0 end);
exception when lock_not_available or deadlock_detected or serialization_failure or query_canceled then
  raise exception sqlstate 'PT503' using message = 'AUTHORITY_BUSY';
end;
$$;

commit;
