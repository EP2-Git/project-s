// Local operator fixture cleanup, not a public account-deletion API. The caller
// must first verify its disposable stack ownership and drain demo traffic.
const uuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const refuse = () => { throw new Error('Local demo cleanup requires its exact run-owned manifest.'); };

export function localDemoIdentity(runId) {
  if (!uuid(runId)) refuse();
  const tag = runId.replaceAll('-', '');
  return Object.freeze({
    username: `demo-${tag.slice(0, 24)}`,
    email: `demo-${tag}@example.invalid`,
    hostName: `Local Demo Host ${tag.slice(0, 12)}`,
    guestName: `Local Demo Guest ${tag.slice(0, 12)}`,
    guestEmail: `guest-${tag}@example.invalid`,
  });
}

export function buildLocalDemoCleanup(input) {
  const keys = ['runId', 'userId', 'meetingTypeId', 'bookingId', 'startedAt'];
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== keys.length
    || Object.keys(input).some((key) => !keys.includes(key))) refuse();
  const values = Object.getOwnPropertyDescriptors(input);
  if (keys.some((key) => !values[key] || !Object.hasOwn(values[key], 'value'))) refuse();
  const { runId, userId, meetingTypeId, bookingId, startedAt } = Object.fromEntries(
    keys.map((key) => [key, values[key].value]),
  );
  if (![runId, userId, meetingTypeId, bookingId].every(uuid)
    || new Set([runId, userId, meetingTypeId, bookingId]).size !== 4
    || typeof startedAt !== 'string'
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(startedAt)
    || !Number.isFinite(Date.parse(startedAt))
    || new Date(startedAt).toISOString() !== startedAt) refuse();
  const identity = localDemoIdentity(runId);

  // Every interpolated value above is a primitive canonical UUID/UTC timestamp
  // or derived solely from the reserved UUID tag. No SQL identifier is input.
  // Execute in a fresh psql session with ON_ERROR_STOP=1; accept output only
  // after its process exits successfully. An error rolls the transaction back.
  return `begin;
set local search_path = pg_catalog;
set local lock_timeout = '1s';
set local statement_timeout = '10s';
create temporary table project_s_demo_cleanup_result (
  bookings_deleted integer, preparations_deleted integer, grants_deleted integer,
  audit_events_retained integer
);
do $local_demo_cleanup$
declare
  v_user uuid := '${userId}';
  v_type uuid := '${meetingTypeId}';
  v_booking uuid := '${bookingId}';
  v_started timestamptz := '${startedAt}';
  v_preparation uuid;
  v_preparations integer;
  v_grants integer;
  v_audit integer;
  v_reference record;
  v_join text;
  v_target text;
  v_referenced boolean;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0)) then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_CLEANUP_BUSY';
  end if;
  perform 1 from auth.users where id = v_user for update nowait;
  if not found or not exists (
    select 1 from auth.users where id = v_user
      and email = '${identity.email}' and raw_user_meta_data ->> 'username' = '${identity.username}'
      and is_anonymous is false and email_confirmed_at is not null
      and created_at >= v_started and created_at <= pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_IDENTITY_MISMATCH';
  end if;
  perform 1 from public.profiles where id = v_user for update nowait;
  if not exists (select 1 from public.profiles where id = v_user
    and username = '${identity.username}' and created_at >= v_started) then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_IDENTITY_MISMATCH';
  end if;
  perform 1 from public.meeting_types where user_id = v_user for update nowait;
  perform 1 from public.availabilities where user_id = v_user for update nowait;
  perform 1 from public.specific_date_availabilities where user_id = v_user for update nowait;
  perform 1 from public.bookings where user_id = v_user for update nowait;
  perform 1 from private.booking_preparations where owner_id = v_user for update nowait;
  perform 1 from private.booking_confirmation_grants where preparation_id in (
    select id from private.booking_preparations where owner_id = v_user
  ) for update nowait;

  if (select count(*) from public.meeting_types where user_id = v_user) <> 1
    or not exists (select 1 from public.meeting_types where id = v_type
      and user_id = v_user and created_at >= v_started)
    or (select count(*) from public.bookings where user_id = v_user) <> 1
    or not exists (select 1 from public.bookings where id = v_booking and user_id = v_user
      and meeting_type_id = v_type and booker_name = '${identity.guestName}'
      and booker_email = '${identity.guestEmail}' and created_at >= v_started
      and status = 'cancelled' and version = 2 and canceled_by = 'host'
      and canceled_at is not null and preparation_id is not null)
    or exists (select 1 from public.availabilities where user_id = v_user and created_at < v_started)
    or exists (select 1 from public.specific_date_availabilities where user_id = v_user and created_at < v_started)
  then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_UNEXPECTED_RECORDS';
  end if;
  select preparation_id into strict v_preparation from public.bookings where id = v_booking;
  if not exists (select 1 from private.booking_preparations where id = v_preparation
      and owner_id = v_user and meeting_type_id = v_type and username = '${identity.username}'
      and state = 'committed' and created_at >= v_started)
    or exists (select 1 from private.booking_preparations where owner_id = v_user and (
      created_at < v_started or meeting_type_id <> v_type or username <> '${identity.username}'
      or (state = 'committed' and id <> v_preparation)
      or (state <> 'committed' and (booker_name is distinct from '${identity.guestName}'
        or booker_email is distinct from '${identity.guestEmail}'))
    ))
    or exists (select 1 from public.bookings where preparation_id in (
      select id from private.booking_preparations where owner_id = v_user
    ) and id <> v_booking)
    or exists (select 1 from private.booking_confirmation_grants where consumed_by_booking_id = v_booking
      and preparation_id <> v_preparation)
    or exists (select 1 from private.booking_confirmation_grants where preparation_id in (
      select id from private.booking_preparations where owner_id = v_user
    ) and consumed_by_booking_id is not null and consumed_by_booking_id <> v_booking)
    or (select count(*) from private.booking_confirmation_grants where preparation_id = v_preparation
      and consumed_by_booking_id = v_booking and consumed_at is not null) <> 1
  then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_UNEXPECTED_REFERENCES';
  end if;

  if exists (select 1 from private.v2_authority_principals where principal_id = v_user)
    or exists (select 1 from private.v2_actor_credentials where principal_id = v_user)
    or exists (select 1 from private.v2_authority_events where principal_id = v_user)
    or exists (select 1 from private.v2_booker_profiles where principal_id = v_user)
    or exists (select 1 from storage.objects o where pg_catalog.lower(pg_catalog.to_jsonb(o) ->> 'owner') = v_user::text
      or pg_catalog.lower(pg_catalog.to_jsonb(o) ->> 'owner_id') = v_user::text)
    or exists (select 1 from storage.buckets b where pg_catalog.lower(pg_catalog.to_jsonb(b) ->> 'owner') = v_user::text
      or pg_catalog.lower(pg_catalog.to_jsonb(b) ->> 'owner_id') = v_user::text)
  then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_EXTERNAL_STATE';
  end if;

  -- Refuse rows in added/integrated tables referencing this fixture. Existing
  -- known row families are checked above; Auth-owned session cascades are normal.
  for v_reference in
    select c.conkey, c.confkey, c.conrelid, c.confrelid,
      sn.nspname as source_schema, s.relname as source_table,
      tn.nspname as target_schema, t.relname as target_table
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class s on s.oid = c.conrelid
    join pg_catalog.pg_namespace sn on sn.oid = s.relnamespace
    join pg_catalog.pg_class t on t.oid = c.confrelid
    join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
    where c.contype = 'f' and c.confrelid in (
      'auth.users'::regclass, 'public.profiles'::regclass, 'public.meeting_types'::regclass,
      'public.bookings'::regclass, 'private.booking_preparations'::regclass,
      'private.booking_confirmation_grants'::regclass
    ) and c.conrelid not in (
      'public.profiles'::regclass, 'public.meeting_types'::regclass,
      'public.availabilities'::regclass, 'public.specific_date_availabilities'::regclass,
      'public.bookings'::regclass, 'private.scheduling_authority_versions'::regclass,
      'private.booking_preparations'::regclass, 'private.booking_confirmation_grants'::regclass
    ) and not (sn.nspname = 'auth' and c.confrelid = 'auth.users'::regclass)
  loop
    select pg_catalog.string_agg(pg_catalog.format('s.%I = t.%I', sa.attname, ta.attname), ' and ' order by cols.n)
      into v_join
    from unnest(v_reference.conkey, v_reference.confkey) with ordinality as cols(source_key, target_key, n)
    join pg_catalog.pg_attribute sa on sa.attrelid = v_reference.conrelid and sa.attnum = cols.source_key
    join pg_catalog.pg_attribute ta on ta.attrelid = v_reference.confrelid and ta.attnum = cols.target_key;
    v_target := case v_reference.confrelid
      when 'auth.users'::regclass then pg_catalog.format('t.id = %L::uuid', v_user)
      when 'public.profiles'::regclass then pg_catalog.format('t.id = %L::uuid', v_user)
      when 'public.meeting_types'::regclass then pg_catalog.format('t.id = %L::uuid', v_type)
      when 'public.bookings'::regclass then pg_catalog.format('t.id = %L::uuid', v_booking)
      when 'private.booking_preparations'::regclass then pg_catalog.format('t.owner_id = %L::uuid', v_user)
      when 'private.booking_confirmation_grants'::regclass then pg_catalog.format(
        't.preparation_id in (select id from private.booking_preparations where owner_id = %L::uuid)', v_user)
    end;
    execute pg_catalog.format('select exists (select 1 from %I.%I s join %I.%I t on %s where %s)',
      v_reference.source_schema, v_reference.source_table, v_reference.target_schema,
      v_reference.target_table, v_join, v_target) into v_referenced;
    if v_referenced then
      raise exception using errcode = '55000', message = 'LOCAL_DEMO_EXTERNAL_STATE';
    end if;
  end loop;

  select count(*) into v_audit from private.booking_audit_events where preparation_id in (
    select id from private.booking_preparations where owner_id = v_user
  );
  delete from private.booking_confirmation_grants where preparation_id in (
    select id from private.booking_preparations where owner_id = v_user
  );
  get diagnostics v_grants = row_count;
  delete from public.bookings where id = v_booking and user_id = v_user;
  if not found then raise exception using errcode = '55000', message = 'LOCAL_DEMO_DELETE_MISMATCH'; end if;
  delete from private.booking_preparations where owner_id = v_user;
  get diagnostics v_preparations = row_count;
  delete from auth.users where id = v_user;
  if not found then raise exception using errcode = '55000', message = 'LOCAL_DEMO_DELETE_MISMATCH'; end if;

  if exists (select 1 from auth.users where id = v_user)
    or exists (select 1 from auth.identities where user_id = v_user)
    or exists (select 1 from auth.sessions where user_id = v_user)
    or exists (select 1 from auth.refresh_tokens where user_id::text = v_user::text)
    or exists (select 1 from public.profiles where id = v_user)
    or exists (select 1 from public.meeting_types where user_id = v_user)
    or exists (select 1 from public.availabilities where user_id = v_user)
    or exists (select 1 from public.specific_date_availabilities where user_id = v_user)
    or exists (select 1 from public.bookings where user_id = v_user)
    or exists (select 1 from private.booking_preparations where owner_id = v_user)
  then
    raise exception using errcode = '55000', message = 'LOCAL_DEMO_DELETE_MISMATCH';
  end if;
  insert into project_s_demo_cleanup_result values (1, v_preparations, v_grants, v_audit);
end;
$local_demo_cleanup$;
commit;
select pg_catalog.json_build_object('accountDeleted', true, 'bookingsDeleted', bookings_deleted,
  'preparationsDeleted', preparations_deleted, 'grantsDeleted', grants_deleted,
  'auditEventsRetained', audit_events_retained) from project_s_demo_cleanup_result;
`;
}
