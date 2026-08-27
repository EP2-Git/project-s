-- Synthetic local-only demo data. No production identifiers or personal data.

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
  '10000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'demo@project-s.local',
  extensions.crypt('project-s-demo-password', extensions.gen_salt('bf')),
  statement_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"username":"demo-host","full_name":"Demo Host","timezone":"America/Halifax"}'::jsonb,
  statement_timestamp(),
  statement_timestamp(),
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '{"sub":"10000000-0000-4000-8000-000000000001","email":"demo@project-s.local"}'::jsonb,
  'email',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp()
)
on conflict do nothing;

update public.profiles
set
  username = 'demo-host',
  full_name = 'Demo Host',
  timezone = 'America/Halifax'
where id = '10000000-0000-4000-8000-000000000001';

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
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Intro call',
  'A synthetic meeting type for exploring a local Project S installation.',
  30,
  15,
  0,
  15,
  60,
  60,
  true
)
on conflict (id) do update
set
  title = excluded.title,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  slot_interval_minutes = excluded.slot_interval_minutes,
  buffer_before_minutes = excluded.buffer_before_minutes,
  buffer_after_minutes = excluded.buffer_after_minutes,
  minimum_notice_minutes = excluded.minimum_notice_minutes,
  maximum_advance_days = excluded.maximum_advance_days,
  active = excluded.active;

insert into public.bookings (
  id,
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
  status,
  idempotency_key,
  request_fingerprint,
  canceled_at,
  canceled_by
)
values (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '2026-01-15T15:00:00Z',
  30,
  0,
  15,
  'Example Guest',
  'guest@example.invalid',
  'UTC',
  'Intro call',
  'America/Halifax',
  'Synthetic canceled booking for the local dashboard.',
  '{"notes":"Synthetic canceled booking for the local dashboard."}'::jsonb,
  'cancelled',
  '40000000-0000-4000-8000-000000000001',
  extensions.digest('project-s-local-seed', 'sha256'),
  '2026-01-10T12:00:00Z',
  'system'
)
on conflict (id) do nothing;
