# Scheduling engine

## Authority

The database is authoritative. Browser, SDK, and MCP clients may display computed
slots and prepare an intent, but preparation is short-lived and never reserves
the time. The first create accepts only that opaque preparation token and an
idempotency key, then repeats every consequential check in one database
transaction.

Preparation supplies a public username, meeting type, requested start instant,
guest zone, guest details, and optional notes. The server derives the owner,
duration, end instant, visible summary, and current authority revision. At first
commit, after verifying the durable human grant and taking the same per-owner lock
used by schedule writers, it rechecks:

1. the meeting type exists and is active;
2. the request is within the allowed booking horizon;
3. the local owner-time interval is covered by recurring or date-specific availability;
4. buffers and duration are respected;
5. no active booking overlaps;
6. all public input satisfies length and format limits.

PostgreSQL must also enforce overlap protection with a constraint that remains safe under concurrent transactions. A pre-insert `SELECT` alone is insufficient.

An exact create replay is intentionally resolved as a lookup of the immutable
confirmed booking. It does not insert again or rerun mutable scheduling checks.
Reusing a key for a different preparation is rejected.

## Interval semantics

Intervals are half-open: `[start, end)`. A meeting ending at the exact instant another begins does not overlap unless a configured buffer expands the blocked interval. Cancelled bookings do not block slots.

## Failure contract

Expected validation and conflict failures return stable domain codes suitable for user-facing recovery. Internal schema, SQL, identifiers, and guest data are not included in public error messages.

## Required tests

- weekly windows, date overrides, buffers, duration, boundaries, and inactive types;
- past/horizon rejection and malformed input;
- timezone and DST vectors described in `timezones.md`;
- RLS owner/other/anonymous matrix;
- 50 isolated two-client races, each yielding exactly one success, one `SLOT_UNAVAILABLE` conflict, and one confirmed row.
