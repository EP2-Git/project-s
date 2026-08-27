# Data model

The migration directory is the source of truth. Generated TypeScript types are a derived artifact checked by `npm run types:check`.

## Core entities

- `profiles`: one public scheduling identity per authenticated user; includes username and IANA timezone.
- `meeting_types`: owner-defined duration and public activation state.
- `availabilities`: recurring weekly windows interpreted in the owner's timezone.
- `specific_date_availabilities`: date overrides in the owner's timezone.
- `bookings`: private guest and timing data owned by a profile.

The `private` schema holds gateway-only authority state:

- `scheduling_authority_versions`: per-owner revision advanced by schedule or
  public-profile changes;
- `booking_preparations`: short-lived non-holding intents addressed by an opaque
  token digest;
- `booking_confirmation_grants`: one durable, one-use human authority grant per
  preparation;
- `booking_audit_events`: append-only minimized authority outcomes; and
- `rate_limit_secrets`, `public_rate_limit_policies`, and
  `public_rate_limit_buckets`: persisted public-gateway abuse controls.

Public transports cannot select or read this authority state. Gateway security
definer functions expose only the narrow derived results required by the four
public operations and browser confirmation support routes.

## Required invariants

- Usernames are case-insensitively unique.
- Durations and buffers are bounded positive values.
- Availability end is later than start and weekdays are valid.
- Booking timestamps are non-null UTC instants with end later than start.
- Meeting type and booking owner cannot disagree.
- Active/confirmed bookings for one owner cannot overlap.
- A preparation cannot be mistaken for a reservation or committed without its
  matching unexpired confirmation grant.
- First commit rechecks time, policy, authority revision, summary, and availability
  after taking the same owner lock used by schedule writers.
- One idempotency key maps to one immutable confirmed result; a changed request
  cannot reuse it.
- Foreign keys and deletion behavior are explicit.
- Every user-owned table has RLS enabled and tested.

## Public data

Anonymous clients may obtain only fields required to render a booking page and computed available slots. Guest names, emails, notes, responses, status history, calendar identifiers, and occupied intervals are private.

The seed file contains synthetic records only. It must be safe to publish, reset repeatedly, and use in browser tests.
