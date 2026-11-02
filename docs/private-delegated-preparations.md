# Private delegated booking preparation

This internal [#17](https://github.com/EP2-Git/project-s/issues/17) slice extends
the [private mandate controls](private-mandate-controls.md) under accepted
[ADR 0004](adr/0004-bounded-mandate-implementation.md). A freshly verified actor
can prepare an exact in-scope meeting or create a bounded pending step-up request
outside its current permission. It enables no instance, public route, issuer UI,
SDK/MCP operation, approval grant or delegated booking commit. The existing app
and labelled Authority Lab retain their established behavior.

## Live caller, policy and scheduling checks

The server-only `delegatedPreparations.ts` adapter requires fresh
`authenticateActor` verification. Strict context parsing cannot authenticate a
caller. The service-only RPC independently checks the live instance/epoch,
account, principal, actor/credential binding, revision, verifier fingerprint and
expiry under the principal fence. Actors cannot bootstrap a principal. Requests
contain only mandate ID, public username, meeting-type ID and exact start instant;
booker details, notes, duration/end, provider and authority flags are rejected.
Principal contexts and direct anonymous/authenticated RPC calls are denied.

The kernel resolves the current public host/type and derives duration/end,
notice/horizon, buffers, availability and conflicts. The whole meeting must fit
the mandate's inclusive UTC window and maximum derived duration. Permission is
usable only at `notBefore <= fresh time < expiresAt`, with a live supporting
credential and reviewed profile. Expired/revoked permission cannot create a
replacement review. Private ownership is checked before referenced row locks;
shared legacy rows use NOWAIT and the owner schedule fence uses a try-lock.
Live state/time is checked after waits. Failures are redacted without v1 fallback.
The complete mixed booking-commit lock graph and outer admission deadline remain
enablement gates.

## Preparations and pending step-up requests

An in-scope result contains the existing strict v2 preparation metadata and
actor-visible summary, without reviewed name/email, policy bounds, owner IDs or
credentials. Its digest binds normalized intent, current host revision and
private caller/profile/policy references. Preparations last at most ten minutes,
bounded by all supporting authority expiry. They reserve no slot and spend no
booking use.

An otherwise eligible request outside host/type/window/duration scope records a
real private pending review. The actor receives only its opaque ID, deadline
and configured same-origin review URL. It lasts at most five minutes and cannot
outlive the original permission, credential or profile. Immutable profile
references allow a future principal-only review without copying reviewed name
or email. The actor-visible summary includes the permitted guest timezone.
The reference grants no access or approval; issuer UI and exact replacement
grant approval remain gated.

Exact eligible retries reconcile the original pending ID/expiry without another
event or deadline extension. One actor may have at most 20 live pending
preparations/reviews combined and create at most 20 new records in a trailing
ten-minute window, derived from the longest preparation lifetime. This
conservative implementation of the reviewed cap/rate requirement is part of the
later enablement review. Deduplication precedes both limits; invalidation does
not erase recent creation history. Limits produce `RATE_LIMITED` on new work.

Profile deletion atomically invalidates linked pending records and clears their
cached summaries, including guest timezone, under the same fence/audit event as
dependent mandate revocation and PII removal. Credential or
mandate revocation/expiry denies subsequent preparation retries. Record creation
and minimal sequenced audit commit together; audit failure rolls everything
back. Expiry does not rely on purge; retention cleanup/recovery remain required.

## Time-zone compatibility

Availability search uses the requested instant's UTC date and UTC display zone
to group the search window. Host scheduling timezone and the exact instant are
unchanged. Summaries retain the reviewed guest timezone spelling, including
accepted aliases/fixed offsets. Legacy booking storage validates guest zones
more narrowly; the future commit needs explicit compatibility treatment and
proof before enablement. This slice changes no v1 validation or booking storage.

## Verification, migration and remaining work

Shared Node/Deno vectors cover strict input, microseconds, minimal matching
results, same-origin references, redacted errors and no fallback. Disposable
pgTAP/dblink tests cover real scheduling, scope, expiry during waits, revocation,
deletion/epoch ordering, caps and audit rollback. The guarded
`test:authority:live` proof adds genuine actor Auth-to-RPC preparation/step-up,
deduplication and deletion checks. Distinguish local, hosted and mock evidence.

The additive migration adds separate default-deny private tables, narrow
service RPC/helpers and a forward profile-delete replacement. It inserts no
configuration or legacy FK/cascade, and changes no v1 artifacts, public four-tool
discovery, browser confirmation, booking rows or cancellation. Generated public
RPC types must match the migrated stack.

Atomic one-use commit, exact step-up approval, receipts/replay, full mixed races,
retention/recovery, transports and working authorized issuer/monitoring UI remain.
Separate explicit synthetic enablement review and bilateral #18 proof are still
required. Prefer forward repair with routes disabled; preserve pending
references, invalidation and audit fences. Code rollback cannot revoke durable
authority or undo a booking.
