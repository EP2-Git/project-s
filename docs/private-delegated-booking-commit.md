# Private delegated booking commit and receipt

This slice of [#17](https://github.com/EP2-Git/project-s/issues/17) implements
commit for a prepared standing mandate or an exact issuer-approved exception
under [ADR 0004](adr/0004-bounded-mandate-implementation.md).
Its inputs are the freshly verified actor context, exact preparation ID and
caller retry key. Only the service role can call the two RPCs for commit and
receipt read. The internal adapter validates the accepted v2 shapes. The
synthetic instance remains unconfigured by the migration.

## First write and retry

The transaction serializes on one principal, verifies the current credential,
locks the required private state and uses the existing host scheduling lock
without waiting. It checks the prepared intent and host snapshot against fresh
authority and availability. The confirmed booking, one-use budget, receipt and
ordered success event commit together. The previous v1 booking creation and
cancellation paths retain their existing rules.

A pending review authorizes no booking. Once the issuer approves it, only its
replacement preparation can commit the exact reviewed meeting before the
grant deadline. The original mandate and other pending requests cannot spend
the same use. The exception can exceed the original guest's limits only for
the reviewed meeting. Current host policy, the approved meeting facts and
slot availability still apply. Neither approval nor preparation reserves a slot.

The commit receipt binds the original actor and credential, exact intent and
retry key digest. A matching retry authenticates the caller and looks for its
prior result before testing eligibility for a first write. The same active
credential can recover its confirmed receipt within the reviewed access window.
Another caller or a different preparation cannot use that receipt. A cancelled
booking returns the reviewed slot refusal. Expired receipt access keeps the
consumption fence. Preparing or approving a new exception against a spent
mandate refuses, and the issuer can see zero remaining uses.

The private receipt preserves the exact reviewed guest timezone. The existing
booking row stores it when its validator accepts it and otherwise uses null,
per [ADR 0006](adr/0006-delegated-booking-timezone-projection.md).

## Concurrent bookings and revocation

The disposable PostgreSQL race suite overlaps transactions on independent
connections. It exercises both winner orders when a confirmed v1 preparation
and a delegated preparation target the same slot, for both standing mandates
and approved exceptions. When v1 holds the host lock, v2 returns
`AUTHORITY_BUSY`. After the v1 transaction commits, retrying with the same
preparation and key returns `SLOT_UNAVAILABLE`. When v2 wins, the waiting v1
commit returns `SLOT_UNAVAILABLE` and leaves its confirmation unused.

The suite also exercises both commit/revocation orders. A first commit
serialized after revocation refuses. Revocation serialized after a successful
commit stops further use while the original active credential can still
recover the confirmed receipt.

## Upgrading an existing receipt

The database CI job resets its disposable stack to the standing-only schema
and commits a synthetic booking through the existing RPC. It then applies the
forward migration to that populated database. The rehearsal checks the
original booking, receipt, retry binding and audit across the upgrade, and
verifies that the same caller can recover the receipt while the original
mandate stays consumed.

## Expired receipt cleanup

Receipt access ends after 24 hours even if cleanup has yet to run. The database
owner can use the private `v2_redact_expired_booking_receipts` function to
clear expired receipt payloads for one principal in batches of up to 100.
Cleanup records a minimal audit event for each batch that clears data and
keeps the bindings needed to refuse a repeat booking. The confirmed booking
remains subject to the host's existing retention rules.

This implements receipt redaction for the synthetic policy in ADR 0004.
Scheduling cleanup and purging old bindings are separate steps before
enablement.

## Key custody and enablement

The domain-separated retry digest uses one database-owned key per synthetic
authority epoch. The owner provisions a random key in disposable fixtures.
The migration contains no key or instance setup. The private key table has no
client or service role access, and the application has no key mutation path.
Missing key material refuses commit. Preserve the key and consumption records
through their live bindings. Epoch rotation and restoration must use the
offline procedure below before any re-enable.

## Offline recovery for synthetic authority

Keep delegated admission disabled during recovery. Stop old workers and drain
their transactions. The database owner supplies the restored instance UUID and
expected epoch, plus a new epoch greater than every epoch issued for that
instance. Record the new epoch in the operator's recovery record outside the
backup. A restored copy can check its own history but cannot tell which epochs
were used after the snapshot. If the external record is incomplete, leave
delegated admission disabled.

Use the private database function
`v2_rotate_synthetic_authority_epoch(instance_id, expected_epoch, new_epoch)`
from a dedicated owner transaction. Active authority operations hold a shared
transaction lock on a private recovery row. Rotation requires the exclusive
lock and returns `AUTHORITY_BUSY` when an authority transaction still holds it.
Rotation also updates the recovery row, so a transaction using an earlier
snapshot cannot authenticate against the old epoch. A failed rotation leaves
the epoch and keys intact. A successful rotation creates a
fresh private retry key and changes the active epoch together. The database
retains existing bookings, old keys and authority history. Old epoch requests
are refused, including requests for earlier delegated receipts. The current
cleanup functions also require the active epoch, so expired private payloads
retained under a retired epoch still need a separate owner-only retention
operation before enablement.

After commit, configure replacement workers with the externally recorded
epoch and verify that the old worker configuration is refused. Reissue only
explicitly granted authority with fresh credentials. Preserve booking history
when resolving any result whose original commit is uncertain. Never lower
the epoch or select it from the snapshot alone.

The CI database job rehearses a synthetic logical backup with `pg_dump` and
`pg_restore` in a separate database inside the same disposable PostgreSQL
cluster. The fixture advances the original database after the backup, then
reserves a higher epoch outside the archive and installs it in the restore.
Fresh worker processes use the real credential verifier with role-scoped SQL
RPCs. They verify that both earlier generations are refused, a newly granted
worker can book, and the restored booking and receipt stay intact. The
archive is removed after the test. Worker shutdown and traffic cutover across
a real deployment, restored Auth and HTTP services, and separate route
enablement still require their own rehearsal and review.

The implementation proof uses disposable PostgreSQL tests, a local-stack Auth
and RPC rehearsal, and shared Node and Deno adapter vectors. Additional
authority race cases, broader retention, real deployment recovery, the
authorized interface, public transports and the separate enablement review
remain open. Keep
authority and receipt state when repairing a failure. Reverting an application
change cannot undo a booking or safely restore a consumed use.
