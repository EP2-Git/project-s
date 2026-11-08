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

## Key custody and enablement

The domain-separated retry digest uses one database-owned key per synthetic
authority epoch. The owner provisions a random key in disposable fixtures.
The migration contains no key or instance setup. The private key table has no
client or service role access, and the application has no key mutation path.
Missing key material refuses commit. Preserve the key and consumption records
through their live bindings. Epoch rotation and restoration must use the
separate reviewed recovery procedure before any re-enable.

The implementation proof uses disposable PostgreSQL tests, a local-stack Auth
and RPC rehearsal, and shared Node and Deno adapter vectors. Mixed v1/v2
concurrency proof, broader retention and recovery, the authorized interface,
public transports and the separate enablement review are later gates. Keep authority and receipt
state when repairing a failure. Reverting an application change cannot undo a
booking or safely restore a consumed use.
