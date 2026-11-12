# Private delegated booking preparation

This internal [#17](https://github.com/EP2-Git/project-s/issues/17) slice extends
the [private mandate controls](private-mandate-controls.md) under accepted
[ADR 0004](adr/0004-bounded-mandate-implementation.md). A freshly verified actor
can prepare an exact in-scope meeting or create a bounded pending step-up request
outside its current permission. The verified issuer can privately inspect,
approve or revoke that request. The separate
[private commit RPC](private-delegated-booking-commit.md) accepts eligible
preparations. Public transport and the issuer interface require further
implementation and enablement review.

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
outlive the original permission, credential or profile. The pending row keeps
immutable profile references without copying the reviewed name or email. The
actor-visible summary includes the permitted guest timezone.
The reference requires principal authentication for review. The issuer interface
and its transport protections remain part of the enablement work.

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
back. Live operations enforce expiry independently of cleanup.

## Issuer review of a recorded request

The private `getStepUpReview` adapter requires a freshly verified issuer
context. Under the principal fence, its service-only RPC checks ownership,
pending state, and the original mandate, credential and profile binding against
live state and time after waits. Foreign and missing references both return
`FORBIDDEN`. An unavailable owned review returns `VERSION_CONFLICT` without its
summary. The issuer sees the recorded meeting and differences, original digest
and expiry, and the name and email from the live reviewed profile. The actor
still receives only the opaque review reference.

This read neither changes authority nor writes an event. Its snapshot is the
request the actor made. A recorded `host` difference can
represent a change of account even when the public username is the same.

## Exact approval and linked revocation

The private `approveStepUpReview` control accepts the recorded revision and
digest from the verified issuer. It revalidates the live account, epoch,
credential, profile, original permission, exact host snapshot and current slot.
Stale host or scheduling facts require a fresh request. Under the principal
fence, approval revokes the original unused permission, invalidates its old
preparations and other pending exception requests, and creates one exact
`principal_step_up` grant with a fresh private preparation. The grant expires
within five minutes of approval, bounded by the original permission, credential
and profile expiry. This deadline belongs to the approved grant, separate from
the pending review's approval deadline.

Grant and preparation records use dedicated default-deny private tables. An
eligible exact retry returns the original preparation ID and deadline. It
appends no second event and creates no second booking budget. An expired or
revoked grant cannot be approved again from the old request. Approval holds no
slot. The future commit must revalidate the exact grant and current scheduling.

The private `revokeStepUpReview` control revokes either a pending request or its
unused approved grant. Revoking the original mandate also revokes its linked
replacement, including when approval already marked that mandate revoked.
Profile deletion invalidates active dependents and clears all linked summary
copies. Earlier revocation timestamps retain their original meaning. Minimal
audit, replacement state and invalidation commit atomically. A late supporting
expiry after a database wait rolls the entire approval back.

## Expired summary retention

For synthetic local instances, a database owner can call the private
`v2_redact_expired_delegated_summaries(instance_id, epoch, principal_id, limit)`
operation. It serializes with existing authority operations on that principal
and uses database time after acquiring the fence. Each call invalidates and
clears the cached summary on up to 100 expired rows across standing
preparations, pending step-up requests and replacement preparations. The shared
limit selects oldest deadlines first. Equal deadlines use that table order,
then UUID order within each table. A nonempty batch records one minimal
`expired_delegated_summaries_redacted` event. An audit failure rolls back the
batch. The function returns the number of summaries cleared.

Approved source requests retain their decision and binding. An approved
replacement preparation has its own deadline. Once cleanup invalidates an
expired pending review, a late revoke returns the existing `VERSION_CONFLICT`
response for stale state. Request references, host snapshots, difference
labels, digests and creation times remain in private storage for binding and
rate accounting. The operation leaves grant, usage, booking and receipt records
intact. Scheduling cleanup and purging retained binding and audit records are
separate retention work.

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
deduplication, issuer review/approval/revocation and deletion checks. Distinguish local,
hosted and mock evidence.

The additive migration adds separate default-deny private tables, narrow
service RPC/helpers and a forward profile-delete replacement. It inserts no
configuration or legacy FK/cascade, and changes no v1 artifacts, public four-tool
discovery, browser confirmation, booking rows or cancellation. Generated public
RPC types must match the migrated stack.
The issuer-review migration adds a single function and service-only execute
permission. It changes no stored records and can be removed after its internal
callers have been disabled.

The summary cleanup migration adds an owner-only function, private selection
indexes and an audit action. To stop cleanup, stop invoking the function.
Retain earlier events and invalidation references when repairing forward.
Cleared summaries cannot be restored through code rollback.

Remaining mixed races, retention/recovery, transports and a working authorized
issuer and monitoring interface still gate enablement.
Separate explicit synthetic enablement review and bilateral #18 proof are still
required. Prefer forward repair with routes disabled; preserve pending
references, invalidation and audit fences. Code rollback cannot revoke durable
authority or undo a booking.
