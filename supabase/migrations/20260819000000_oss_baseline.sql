-- Project S publication-candidate baseline.
-- This migration intentionally targets a fresh Supabase project. It is not an
-- in-place upgrade for the legacy production database.

begin;

create schema if not exists extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

set local search_path = pg_catalog, public, extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  full_name text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint profiles_username_format check (
    username = lower(username)
    and username ~ '^[a-z0-9][a-z0-9_-]{2,29}$'
  ),
  constraint profiles_full_name_format check (
    full_name = btrim(full_name)
    and char_length(full_name) between 1 and 120
  ),
  constraint profiles_timezone_length check (char_length(timezone) between 1 and 100)
);

create unique index profiles_username_ci_key on public.profiles (lower(username));

create table public.meeting_types (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  duration_minutes smallint not null default 30,
  slot_interval_minutes smallint not null default 15,
  buffer_before_minutes smallint not null default 0,
  buffer_after_minutes smallint not null default 0,
  minimum_notice_minutes integer not null default 60,
  maximum_advance_days smallint not null default 60,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint meeting_types_title_format check (
    title = btrim(title)
    and char_length(title) between 1 and 120
  ),
  constraint meeting_types_description_length check (
    description is null or char_length(description) <= 2000
  ),
  constraint meeting_types_duration_range check (duration_minutes between 5 and 1440),
  constraint meeting_types_slot_interval_range check (slot_interval_minutes between 5 and 720),
  constraint meeting_types_buffer_before_range check (buffer_before_minutes between 0 and 1440),
  constraint meeting_types_buffer_after_range check (buffer_after_minutes between 0 and 1440),
  constraint meeting_types_notice_range check (minimum_notice_minutes between 0 and 525600),
  constraint meeting_types_advance_range check (maximum_advance_days between 1 and 365),
  constraint meeting_types_id_user_key unique (id, user_id)
);

create index meeting_types_owner_active_idx
  on public.meeting_types (user_id, active, created_at);

create table public.availabilities (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null,
  start_time time without time zone not null,
  end_time time without time zone not null,
  buffer_minutes smallint not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint availabilities_weekday_range check (weekday between 0 and 6),
  constraint availabilities_ordered check (start_time < end_time),
  constraint availabilities_buffer_range check (buffer_minutes between 0 and 1440),
  constraint availabilities_minute_precision check (
    extract(second from start_time) = 0
    and extract(second from end_time) = 0
  ),
  constraint availabilities_exact_key unique (user_id, weekday, start_time, end_time),
  constraint availabilities_no_overlap exclude using gist (
    user_id with =,
    weekday with =,
    int4range(
      (extract(hour from start_time)::integer * 60)
        + extract(minute from start_time)::integer,
      (extract(hour from end_time)::integer * 60)
        + extract(minute from end_time)::integer,
      '[)'
    ) with &&
  )
);

create index availabilities_owner_weekday_idx
  on public.availabilities (user_id, weekday, start_time);

create table public.specific_date_availabilities (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  status text not null,
  start_time time without time zone,
  end_time time without time zone,
  buffer_minutes smallint not null default 0,
  note text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint specific_date_availabilities_status check (status in ('available', 'unavailable', 'default')),
  constraint specific_date_availabilities_shape check (
    (
      status = 'available'
      and start_time is not null
      and end_time is not null
      and start_time < end_time
      and extract(second from start_time) = 0
      and extract(second from end_time) = 0
    )
    or
    (
      status in ('unavailable', 'default')
      and start_time is null
      and end_time is null
    )
  ),
  constraint specific_date_availabilities_buffer_range check (buffer_minutes between 0 and 1440),
  constraint specific_date_availabilities_note_length check (
    note is null or char_length(note) <= 500
  ),
  constraint specific_date_availabilities_owner_date_key unique (user_id, date)
);

create index specific_date_availabilities_owner_date_idx
  on public.specific_date_availabilities (user_id, date);

create or replace function private.add_minutes_utc(
  p_instant timestamptz,
  p_minutes integer
)
returns timestamptz
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog
as $$
  select pg_catalog.to_timestamp(
    extract(epoch from p_instant) + (p_minutes::double precision * 60.0)
  );
$$;

create or replace function private.booking_occupied_range(
  p_start_time timestamptz,
  p_duration_minutes integer,
  p_buffer_before_minutes integer,
  p_buffer_after_minutes integer
)
returns tstzrange
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog
as $$
  select pg_catalog.tstzrange(
    private.add_minutes_utc(p_start_time, -p_buffer_before_minutes),
    private.add_minutes_utc(
      p_start_time,
      p_duration_minutes + p_buffer_after_minutes
    ),
    '[)'
  );
$$;

create or replace function private.is_valid_booker_email(p_email text)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog
as $$
  select
    p_email is not null
    and p_email = lower(btrim(p_email))
    and char_length(p_email) between 3 and 320
    and p_email !~ '[[:cntrl:][:space:]?#&]'
    and split_part(p_email, '@', 1) !~ '[.][.]'
    and p_email ~ '^([a-z0-9]|[a-z0-9][a-z0-9._+-]{0,62}[a-z0-9])@([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])([.]([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9]))+$';
$$;

create table public.bookings (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  meeting_type_id uuid not null,
  start_time timestamptz not null,
  duration_minutes smallint not null,
  end_time timestamptz generated always as (
    private.add_minutes_utc(start_time, duration_minutes)
  ) stored,
  buffer_before_minutes smallint not null default 0,
  buffer_after_minutes smallint not null default 0,
  occupied_during tstzrange generated always as (
    private.booking_occupied_range(
      start_time,
      duration_minutes,
      buffer_before_minutes,
      buffer_after_minutes
    )
  ) stored,
  booker_name text not null,
  booker_email text not null,
  guest_timezone text,
  meeting_type_title text not null,
  host_timezone text not null,
  notes text,
  responses jsonb not null default '{}'::jsonb,
  status text not null default 'confirmed',
  confirmation_code text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  idempotency_key uuid not null,
  request_fingerprint bytea not null,
  version integer not null default 1,
  canceled_at timestamptz,
  canceled_by text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint bookings_meeting_type_owner_fkey
    foreign key (meeting_type_id, user_id)
    references public.meeting_types (id, user_id)
    on delete restrict,
  constraint bookings_duration_range check (duration_minutes between 5 and 1440),
  constraint bookings_buffer_before_range check (buffer_before_minutes between 0 and 1440),
  constraint bookings_buffer_after_range check (buffer_after_minutes between 0 and 1440),
  constraint bookings_booker_name_format check (
    booker_name = btrim(booker_name)
    and char_length(booker_name) between 2 and 120
  ),
  constraint bookings_booker_email_format check (
    private.is_valid_booker_email(booker_email)
  ),
  constraint bookings_guest_timezone_length check (
    guest_timezone is null or char_length(guest_timezone) between 1 and 100
  ),
  constraint bookings_meeting_type_title_length check (
    char_length(meeting_type_title) between 1 and 120
  ),
  constraint bookings_host_timezone_length check (
    char_length(host_timezone) between 1 and 100
  ),
  constraint bookings_notes_length check (notes is null or char_length(notes) <= 2000),
  constraint bookings_status check (status in ('confirmed', 'cancelled')),
  constraint bookings_cancellation_actor check (
    canceled_by is null or canceled_by in ('host', 'system')
  ),
  constraint bookings_cancellation_shape check (
    (status = 'confirmed' and canceled_at is null and canceled_by is null)
    or
    (status = 'cancelled' and canceled_at is not null and canceled_by is not null)
  ),
  constraint bookings_version_positive check (version > 0),
  constraint bookings_confirmation_code_key unique (confirmation_code),
  constraint bookings_idempotency_key unique (idempotency_key)
);

alter table public.bookings
  add constraint bookings_no_confirmed_overlap
  exclude using gist (
    user_id with =,
    occupied_during with &&
  )
  where (status = 'confirmed');

create index bookings_owner_start_idx
  on public.bookings (user_id, start_time)
  where status = 'confirmed';

create index bookings_owner_created_idx
  on public.bookings (user_id, created_at desc);

create or replace function private.is_valid_time_zone(p_time_zone text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    p_time_zone is not null
    and char_length(p_time_zone) between 1 and 100
    and exists (
      select 1
      from pg_catalog.pg_timezone_names
      where name = p_time_zone
    );
$$;

create or replace function private.validate_profile_time_zone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_valid_time_zone(new.timezone) then
    raise exception using
      errcode = '23514',
      message = 'profiles_timezone_valid';
  end if;
  return new;
end;
$$;

create trigger profiles_validate_time_zone
before insert or update of timezone on public.profiles
for each row execute function private.validate_profile_time_zone();

create or replace function private.validate_booking_time_zone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.guest_timezone is not null
     and not private.is_valid_time_zone(new.guest_timezone) then
    raise exception using
      errcode = '23514',
      message = 'bookings_guest_timezone_valid';
  end if;
  if not private.is_valid_time_zone(new.host_timezone) then
    raise exception using
      errcode = '23514',
      message = 'bookings_host_timezone_valid';
  end if;
  return new;
end;
$$;

create trigger bookings_validate_time_zone
before insert or update of guest_timezone, host_timezone on public.bookings
for each row execute function private.validate_booking_time_zone();

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger meeting_types_set_updated_at
before update on public.meeting_types
for each row execute function private.set_updated_at();

create trigger availabilities_set_updated_at
before update on public.availabilities
for each row execute function private.set_updated_at();

create trigger specific_date_availabilities_set_updated_at
before update on public.specific_date_availabilities
for each row execute function private.set_updated_at();

create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function private.set_updated_at();

create or replace function private.lock_owner_schedule_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception using errcode = '23514', message = 'owner_immutable';
  end if;

  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
  else
    v_user_id := new.user_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger meeting_types_lock_owner_schedule
before insert or update or delete on public.meeting_types
for each row execute function private.lock_owner_schedule_write();

create trigger availabilities_lock_owner_schedule
before insert or update or delete on public.availabilities
for each row execute function private.lock_owner_schedule_write();

create trigger specific_dates_lock_owner_schedule
before insert or update or delete on public.specific_date_availabilities
for each row execute function private.lock_owner_schedule_write();

create or replace function private.lock_profile_schedule_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid;
begin
  if tg_op = 'UPDATE' and new.id <> old.id then
    raise exception using errcode = '23514', message = 'profile_id_immutable';
  end if;

  if tg_op = 'DELETE' then
    v_user_id := old.id;
  else
    v_user_id := new.id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger profiles_lock_owner_schedule
before insert or update or delete on public.profiles
for each row execute function private.lock_profile_schedule_write();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_username text;
  v_full_name text;
  v_time_zone text;
begin
  v_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if v_username !~ '^[a-z0-9][a-z0-9_-]{2,29}$' then
    v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  v_full_name := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if char_length(v_full_name) < 1 or char_length(v_full_name) > 120 then
    v_full_name := 'Project S Host';
  end if;

  v_time_zone := coalesce(
    nullif(new.raw_user_meta_data ->> 'timezone', ''),
    nullif(new.raw_user_meta_data ->> 'time_zone', ''),
    'UTC'
  );
  if not private.is_valid_time_zone(v_time_zone) then
    v_time_zone := 'UTC';
  end if;

  insert into public.profiles (id, username, full_name, timezone)
  values (new.id, v_username, v_full_name, v_time_zone);

  insert into public.availabilities (user_id, weekday, start_time, end_time, buffer_minutes)
  select new.id, day_number, time '09:00', time '17:00', 0
  from generate_series(1, 5) as day_number;

  return new;
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'USERNAME_TAKEN';
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.compute_free_slots_v1(
  p_username text,
  p_meeting_type_id uuid,
  p_date date,
  p_display_time_zone text,
  p_now timestamptz
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  slot_buffer_before smallint,
  slot_buffer_after smallint
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_user_id uuid;
  v_host_time_zone text;
  v_duration smallint;
  v_slot_interval smallint;
  v_buffer_before smallint;
  v_buffer_after smallint;
  v_minimum_notice integer;
  v_maximum_advance smallint;
begin
  if v_username !~ '^[a-z0-9][a-z0-9_-]{2,29}$' or p_date is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if p_display_time_zone is null
     or not private.is_valid_time_zone(p_display_time_zone) then
    raise exception using errcode = 'PT400', message = 'INVALID_TIME_ZONE';
  end if;

  select
    p.id,
    p.timezone,
    mt.duration_minutes,
    mt.slot_interval_minutes,
    mt.buffer_before_minutes,
    mt.buffer_after_minutes,
    mt.minimum_notice_minutes,
    mt.maximum_advance_days
  into
    v_user_id,
    v_host_time_zone,
    v_duration,
    v_slot_interval,
    v_buffer_before,
    v_buffer_after,
    v_minimum_notice,
    v_maximum_advance
  from public.profiles as p
  join public.meeting_types as mt
    on mt.user_id = p.id
   and mt.id = p_meeting_type_id
   and mt.active
  where p.username = v_username;

  if not found then
    raise exception using errcode = 'PT404', message = 'MEETING_TYPE_UNAVAILABLE';
  end if;

  return query
  with viewer_bounds as (
    select
      (p_date::timestamp without time zone at time zone p_display_time_zone) as range_start,
      ((p_date + 1)::timestamp without time zone at time zone p_display_time_zone) as range_end
  ),
  host_dates as (
    select day_value::date as local_date
    from viewer_bounds as bounds
    cross join lateral generate_series(
      ((bounds.range_start at time zone v_host_time_zone)::date - 1)::timestamp,
      ((bounds.range_end at time zone v_host_time_zone)::date + 1)::timestamp,
      interval '1 day'
    ) as day_value
  ),
  effective_windows as (
    select dates.local_date, weekly.start_time, weekly.end_time, weekly.buffer_minutes
    from host_dates as dates
    join public.availabilities as weekly
      on weekly.user_id = v_user_id
     and weekly.weekday = extract(dow from dates.local_date)::smallint
    where not exists (
      select 1
      from public.specific_date_availabilities as override_row
      where override_row.user_id = v_user_id
        and override_row.date = dates.local_date
        and override_row.status <> 'default'
    )

    union all

    select dates.local_date, override_row.start_time, override_row.end_time, override_row.buffer_minutes
    from host_dates as dates
    join public.specific_date_availabilities as override_row
      on override_row.user_id = v_user_id
     and override_row.date = dates.local_date
     and override_row.status = 'available'
  ),
  window_instants as (
    select
      windows.local_date,
      windows.start_time,
      windows.end_time,
      windows.buffer_minutes,
      (windows.local_date + windows.start_time) at time zone v_host_time_zone as window_start,
      (windows.local_date + windows.end_time) at time zone v_host_time_zone as window_end
    from effective_windows as windows
  ),
  raw_slots as (
    select
      windows.local_date,
      windows.start_time,
      windows.end_time,
      windows.buffer_minutes,
      generated.slot_start,
      generated.slot_start + (v_duration * interval '1 minute') as slot_end
    from window_instants as windows
    cross join lateral generate_series(
      windows.window_start,
      windows.window_end - (v_duration * interval '1 minute'),
      v_slot_interval * interval '1 minute'
    ) as generated(slot_start)
  ),
  eligible_slots as (
    select
      raw.slot_start,
      raw.slot_end,
      v_buffer_before::smallint as slot_buffer_before,
      greatest(v_buffer_after, raw.buffer_minutes)::smallint as slot_buffer_after
    from raw_slots as raw
    cross join viewer_bounds as bounds
    where raw.slot_start >= bounds.range_start
      and raw.slot_start < bounds.range_end
      and raw.slot_start >= p_now + (v_minimum_notice * interval '1 minute')
      and raw.slot_end <= p_now + (v_maximum_advance * interval '1 day')
      and (raw.slot_start at time zone v_host_time_zone)::date = raw.local_date
      and (raw.slot_end at time zone v_host_time_zone)::date = raw.local_date
      and (
        (raw.slot_end at time zone v_host_time_zone)
        - (raw.slot_start at time zone v_host_time_zone)
      ) = v_duration * interval '1 minute'
      and (raw.slot_start at time zone v_host_time_zone)::time >= raw.start_time
      and (raw.slot_end at time zone v_host_time_zone)::time <= raw.end_time
      and not exists (
        select 1
        from public.bookings as existing
        where existing.user_id = v_user_id
          and existing.status = 'confirmed'
          and existing.occupied_during && tstzrange(
            raw.slot_start - (v_buffer_before * interval '1 minute'),
            raw.slot_end + (greatest(v_buffer_after, raw.buffer_minutes) * interval '1 minute'),
            '[)'
          )
      )
  )
  select distinct
    eligible.slot_start,
    eligible.slot_end,
    eligible.slot_buffer_before,
    eligible.slot_buffer_after
  from eligible_slots as eligible
  order by eligible.slot_start;
end;
$$;

create or replace function public.get_public_booking_page_v1(p_username text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_profile public.profiles%rowtype;
  v_meeting_types jsonb;
  v_min_notice integer;
  v_max_advance integer;
begin
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
        'id', mt.id,
        'title', mt.title,
        'description', mt.description,
        'durationMinutes', mt.duration_minutes
      )
      order by mt.created_at, mt.id
    ),
    '[]'::jsonb
  )
  into v_meeting_types
  from public.meeting_types as mt
  where mt.user_id = v_profile.id
    and mt.active;

  select
    coalesce(min(mt.minimum_notice_minutes), 0),
    coalesce(max(mt.maximum_advance_days), 60)
  into v_min_notice, v_max_advance
  from public.meeting_types as mt
  where mt.user_id = v_profile.id
    and mt.active;

  return jsonb_build_object(
    'version', 1,
    'profile', jsonb_build_object(
      'username', v_profile.username,
      'displayName', v_profile.full_name,
      'avatarUrl', null
    ),
    'meetingTypes', v_meeting_types,
    'scheduling', jsonb_build_object(
      'hostTimeZone', v_profile.timezone,
      'minNoticeMinutes', v_min_notice,
      'maxAdvanceDays', v_max_advance
    ),
    'capabilities', jsonb_build_object(
      'bookingNotifications', false,
      'googleCalendar', 'disabled'
    )
  );
end;
$$;

create or replace function public.list_public_free_slots_v1(
  p_username text,
  p_meeting_type_id uuid,
  p_date date,
  p_display_time_zone text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_slots jsonb;
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'startAt', slots.slot_start,
        'endAt', slots.slot_end
      )
      order by slots.slot_start
    ),
    '[]'::jsonb
  )
  into v_slots
  from private.compute_free_slots_v1(
    p_username,
    p_meeting_type_id,
    p_date,
    p_display_time_zone,
    statement_timestamp()
  ) as slots;

  return jsonb_build_object(
    'date', p_date,
    'displayTimeZone', p_display_time_zone,
    'generatedAt', statement_timestamp(),
    'slots', v_slots
  );
end;
$$;

create or replace function public.create_public_booking_v1(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_booker jsonb;
  v_username text;
  v_meeting_type_id uuid;
  v_start_at timestamptz;
  v_start_text text;
  v_guest_time_zone text;
  v_idempotency_key uuid;
  v_booker_name text;
  v_booker_email text;
  v_notes text;
  v_user_id uuid;
  v_meeting_type_title text;
  v_host_time_zone text;
  v_duration smallint;
  v_minimum_notice integer;
  v_maximum_advance smallint;
  v_effective_buffer_before smallint;
  v_effective_buffer_after smallint;
  v_fingerprint bytea;
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_slot_date date;
  v_now timestamptz;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_request) as request_keys(key_name)
    where request_keys.key_name not in (
      'username',
      'meetingTypeId',
      'startAt',
      'guestTimeZone',
      'idempotencyKey',
      'booker'
    )
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if not (
    p_request ? 'username'
    and p_request ? 'meetingTypeId'
    and p_request ? 'startAt'
    and p_request ? 'guestTimeZone'
    and p_request ? 'idempotencyKey'
    and p_request ? 'booker'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if jsonb_typeof(p_request -> 'username') <> 'string'
     or jsonb_typeof(p_request -> 'meetingTypeId') <> 'string'
     or jsonb_typeof(p_request -> 'startAt') <> 'string'
     or jsonb_typeof(p_request -> 'guestTimeZone') <> 'string'
     or jsonb_typeof(p_request -> 'idempotencyKey') <> 'string'
     or jsonb_typeof(p_request -> 'booker') <> 'object' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  v_booker := p_request -> 'booker';

  if exists (
    select 1
    from jsonb_object_keys(v_booker) as booker_keys(key_name)
    where booker_keys.key_name not in ('name', 'email', 'notes')
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if not (v_booker ? 'name' and v_booker ? 'email')
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
     or v_start_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([zZ]|[+-][0-9]{2}:[0-9]{2})$' then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if not private.is_valid_time_zone(v_guest_time_zone) then
    raise exception using errcode = 'PT400', message = 'INVALID_TIME_ZONE';
  end if;

  begin
    v_meeting_type_id := (p_request ->> 'meetingTypeId')::uuid;
    v_idempotency_key := (p_request ->> 'idempotencyKey')::uuid;
    v_start_at := v_start_text::timestamptz;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end;

  v_fingerprint := extensions.digest(
    pg_catalog.convert_to(
      v_username || chr(31)
      || v_meeting_type_id::text || chr(31)
      || extract(epoch from v_start_at)::text || chr(31)
      || v_guest_time_zone || chr(31)
      || v_booker_name || chr(31)
      || v_booker_email || chr(31)
      || coalesce(v_notes, ''),
      'UTF8'
    ),
    'sha256'
  );

  -- A confirmed idempotent replay is a lookup of the immutable stored result,
  -- not a new booking attempt. Resolve it before consulting mutable profile or
  -- publication state so a lost-response retry survives later rename or
  -- deactivation. A mismatched payload still reveals no row contents.
  select *
  into v_existing
  from public.bookings
  where idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing.status <> 'confirmed' then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    end if;

    return jsonb_build_object(
      'confirmationCode', v_existing.confirmation_code,
      'status', 'confirmed',
      'meetingTypeTitle', v_existing.meeting_type_title,
      'startAt', v_existing.start_time,
      'endAt', v_existing.end_time,
      'hostTimeZone', v_existing.host_timezone
    );
  end if;

  select mt.user_id
  into v_user_id
  from public.meeting_types as mt
  join public.profiles as profile on profile.id = mt.user_id
  where mt.id = v_meeting_type_id
    and mt.active
    and profile.username = v_username;

  if not found then
    raise exception using errcode = 'PT404', message = 'MEETING_TYPE_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  -- Schedule/profile writers take the same owner lock. Re-read every
  -- authoritative value only after acquiring it so validation and persistence
  -- cannot mix pre-change and post-change settings.
  select
    mt.user_id,
    mt.title,
    profile.timezone,
    mt.duration_minutes,
    mt.minimum_notice_minutes,
    mt.maximum_advance_days
  into
    v_user_id,
    v_meeting_type_title,
    v_host_time_zone,
    v_duration,
    v_minimum_notice,
    v_maximum_advance
  from public.meeting_types as mt
  join public.profiles as profile on profile.id = mt.user_id
  where mt.id = v_meeting_type_id
    and mt.active
    and profile.username = v_username;

  if not found then
    raise exception using errcode = 'PT404', message = 'MEETING_TYPE_UNAVAILABLE';
  end if;

  -- Lock waits can be material. All notice/window and slot computations use a
  -- fresh wall-clock value taken only after the authoritative schedule reread.
  v_now := pg_catalog.clock_timestamp();

  -- Re-check after the owner lock to handle two first attempts with the same
  -- idempotency key racing before either row was visible.
  select *
  into v_existing
  from public.bookings
  where idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;

    if v_existing.status <> 'confirmed' then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    end if;

    return jsonb_build_object(
      'confirmationCode', v_existing.confirmation_code,
      'status', 'confirmed',
      'meetingTypeTitle', v_existing.meeting_type_title,
      'startAt', v_existing.start_time,
      'endAt', v_existing.end_time,
      'hostTimeZone', v_existing.host_timezone
    );
  end if;

  if v_start_at < v_now + (v_minimum_notice * interval '1 minute')
     or v_start_at + (v_duration * interval '1 minute')
        > v_now + (v_maximum_advance * interval '1 day') then
    raise exception using errcode = 'PT409', message = 'OUTSIDE_BOOKING_WINDOW';
  end if;

  v_slot_date := (v_start_at at time zone v_guest_time_zone)::date;

  select free_slot.slot_buffer_before, free_slot.slot_buffer_after
  into v_effective_buffer_before, v_effective_buffer_after
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
      request_fingerprint
    )
    values (
      v_user_id,
      v_meeting_type_id,
      v_start_at,
      v_duration,
      v_effective_buffer_before,
      v_effective_buffer_after,
      v_booker_name,
      v_booker_email,
      v_guest_time_zone,
      v_meeting_type_title,
      v_host_time_zone,
      v_notes,
      jsonb_build_object('notes', v_notes),
      v_idempotency_key,
      v_fingerprint
    )
    returning * into v_booking;
  exception
    when exclusion_violation then
      raise exception using errcode = 'PT409', message = 'SLOT_UNAVAILABLE';
    when unique_violation then
      select *
      into v_existing
      from public.bookings
      where idempotency_key = v_idempotency_key;

      if found
         and v_existing.request_fingerprint = v_fingerprint
         and v_existing.status = 'confirmed' then
        return jsonb_build_object(
          'confirmationCode', v_existing.confirmation_code,
          'status', 'confirmed',
          'meetingTypeTitle', v_existing.meeting_type_title,
          'startAt', v_existing.start_time,
          'endAt', v_existing.end_time,
          'hostTimeZone', v_existing.host_timezone
        );
      end if;

      raise exception using errcode = 'PT409', message = 'IDEMPOTENCY_KEY_REUSED';
  end;

  return jsonb_build_object(
    'confirmationCode', v_booking.confirmation_code,
    'status', 'confirmed',
    'meetingTypeTitle', v_booking.meeting_type_title,
    'startAt', v_booking.start_time,
    'endAt', v_booking.end_time,
    'hostTimeZone', v_booking.host_timezone
  );
end;
$$;

create or replace function public.set_weekly_schedule_v1(p_schedule jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'PT401', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_schedule is null
     or jsonb_typeof(p_schedule) <> 'array'
     or jsonb_array_length(p_schedule) <> 7 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
    where jsonb_typeof(schedule_day.day_value) <> 'object'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
    where not (
      schedule_day.day_value ? 'weekday'
      and schedule_day.day_value ? 'enabled'
      and schedule_day.day_value ? 'startTime'
      and schedule_day.day_value ? 'endTime'
      and schedule_day.day_value ? 'bufferMinutes'
    )
    or exists (
      select 1
      from jsonb_object_keys(schedule_day.day_value) as object_key(key_name)
      where object_key.key_name not in (
        'weekday',
        'enabled',
        'startTime',
        'endTime',
        'bufferMinutes'
      )
    )
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
    where jsonb_typeof(schedule_day.day_value -> 'weekday') <> 'number'
      or (schedule_day.day_value ->> 'weekday') !~ '^[0-6]$'
      or jsonb_typeof(schedule_day.day_value -> 'enabled') <> 'boolean'
      or jsonb_typeof(schedule_day.day_value -> 'bufferMinutes') <> 'number'
      or (schedule_day.day_value ->> 'bufferMinutes') !~ '^(0|[1-9][0-9]{0,3})$'
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
    where (schedule_day.day_value ->> 'bufferMinutes')::integer > 1440
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if (
    select count(distinct (schedule_day.day_value ->> 'weekday')::integer)
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
  ) <> 7 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
    where (
      (schedule_day.day_value ->> 'enabled')::boolean
      and (
        jsonb_typeof(schedule_day.day_value -> 'startTime') <> 'string'
        or jsonb_typeof(schedule_day.day_value -> 'endTime') <> 'string'
        or (schedule_day.day_value ->> 'startTime')
          !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or (schedule_day.day_value ->> 'endTime')
          !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      )
    )
    or (
      not (schedule_day.day_value ->> 'enabled')::boolean
      and (
        schedule_day.day_value -> 'startTime' <> 'null'::jsonb
        or schedule_day.day_value -> 'endTime' <> 'null'::jsonb
        or (schedule_day.day_value ->> 'bufferMinutes')::integer <> 0
      )
    )
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_schedule) as schedule_day(day_value)
    where (schedule_day.day_value ->> 'enabled')::boolean
      and (schedule_day.day_value ->> 'startTime')::time
        >= (schedule_day.day_value ->> 'endTime')::time
  ) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  delete from public.availabilities
  where user_id = v_user_id;

  insert into public.availabilities (
    user_id,
    weekday,
    start_time,
    end_time,
    buffer_minutes
  )
  select
    v_user_id,
    (schedule_day.day_value ->> 'weekday')::smallint,
    (schedule_day.day_value ->> 'startTime')::time,
    (schedule_day.day_value ->> 'endTime')::time,
    (schedule_day.day_value ->> 'bufferMinutes')::smallint
  from jsonb_array_elements(p_schedule) as schedule_day(day_value)
  where (schedule_day.day_value ->> 'enabled')::boolean;
end;
$$;

create or replace function public.cancel_booking_v1(
  p_booking_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_booking public.bookings%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'PT401', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_booking_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = 'PT400', message = 'INVALID_REQUEST';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  select *
  into v_booking
  from public.bookings
  where id = p_booking_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'NOT_FOUND';
  end if;

  if v_booking.version <> p_expected_version then
    raise exception using errcode = 'PT409', message = 'VERSION_CONFLICT';
  end if;

  if v_booking.status = 'confirmed' then
    update public.bookings
    set
      status = 'cancelled',
      canceled_at = statement_timestamp(),
      canceled_by = 'host',
      version = version + 1
    where id = v_booking.id
    returning * into v_booking;
  end if;

  return jsonb_build_object(
    'bookingId', v_booking.id,
    'status', v_booking.status,
    'version', v_booking.version,
    'canceledAt', v_booking.canceled_at
  );
end;
$$;

create or replace function public.is_username_available_v1(p_username text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9][a-z0-9_-]{2,29}$'
    and not exists (
      select 1
      from public.profiles
      where username = lower(btrim(p_username))
    );
$$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.meeting_types enable row level security;
alter table public.meeting_types force row level security;
alter table public.availabilities enable row level security;
alter table public.availabilities force row level security;
alter table public.specific_date_availabilities enable row level security;
alter table public.specific_date_availabilities force row level security;
alter table public.bookings enable row level security;
alter table public.bookings force row level security;

create policy profiles_owner_select
on public.profiles for select to authenticated
using (id = auth.uid());

create policy profiles_owner_update
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy meeting_types_owner_select
on public.meeting_types for select to authenticated
using (user_id = auth.uid());

create policy meeting_types_owner_insert
on public.meeting_types for insert to authenticated
with check (user_id = auth.uid());

create policy meeting_types_owner_update
on public.meeting_types for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy meeting_types_owner_delete
on public.meeting_types for delete to authenticated
using (user_id = auth.uid());

create policy availabilities_owner_select
on public.availabilities for select to authenticated
using (user_id = auth.uid());

create policy availabilities_owner_insert
on public.availabilities for insert to authenticated
with check (user_id = auth.uid());

create policy availabilities_owner_update
on public.availabilities for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy availabilities_owner_delete
on public.availabilities for delete to authenticated
using (user_id = auth.uid());

create policy specific_date_overrides_owner_select
on public.specific_date_availabilities for select to authenticated
using (user_id = auth.uid());

create policy specific_date_overrides_owner_insert
on public.specific_date_availabilities for insert to authenticated
with check (user_id = auth.uid());

create policy specific_date_overrides_owner_update
on public.specific_date_availabilities for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy specific_date_overrides_owner_delete
on public.specific_date_availabilities for delete to authenticated
using (user_id = auth.uid());

create policy bookings_owner_select
on public.bookings for select to authenticated
using (user_id = auth.uid());

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.meeting_types to authenticated;
grant select, insert, update, delete on public.availabilities to authenticated;
grant select, insert, update, delete on public.specific_date_availabilities to authenticated;
grant select on public.bookings to authenticated;

grant execute on function public.get_public_booking_page_v1(text)
  to anon, authenticated;
grant execute on function public.list_public_free_slots_v1(text, uuid, date, text)
  to anon, authenticated;
grant execute on function public.create_public_booking_v1(jsonb)
  to anon, authenticated;
grant execute on function public.cancel_booking_v1(uuid, integer)
  to authenticated;
grant execute on function public.set_weekly_schedule_v1(jsonb)
  to authenticated;
grant execute on function public.is_username_available_v1(text)
  to anon, authenticated;

alter default privileges in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public
  revoke all on functions from public, anon, authenticated;
alter default privileges in schema private
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema private
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private
  revoke all on functions from public, anon, authenticated;

comment on table public.bookings is
  'Private booking records. Anonymous callers must use the v1 RPCs; direct table access is forbidden.';
comment on function public.list_public_free_slots_v1(text, uuid, date, text) is
  'Returns free instants grouped by the caller display date; it never returns busy intervals or booking rows.';
comment on function public.create_public_booking_v1(jsonb) is
  'Atomically validates and creates a booking. Owner, duration, end, and buffers are derived server-side.';
comment on function public.set_weekly_schedule_v1(jsonb) is
  'Validates and atomically replaces the complete seven-day schedule for the authenticated owner.';

commit;
