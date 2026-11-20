# Booking approval experience: status, decline and requester display

- **Status: Proposed; explicit maintainer design review required.**
- Date: 2026-11-20
- Tracks: [#17](https://github.com/EP2-Git/project-s/issues/17)
- Builds on [ADR 0003](../adr/0003-authority-provider-bounded-mandates.md),
  [ADR 0004](../adr/0004-bounded-mandate-implementation.md) and the
  [accepted implementation supplement](bounded-mandate-implementation.md).
- Scope: the first local synthetic issuer approval experience. This document
  does not accept new contracts, enable routes or authorize deployment.

## Decision requested

Approve the additive owner-visible status and requester-label projection in A
and C, or identify the part to change. B records the screen's presentation of
the already-accepted C2 actions; it does not reopen their kernel semantics or
ask for the same authority approval again. The three recommendations form one
bounded screen-design package:

| Choice | Recommended behavior | Consequence |
| --- | --- | --- |
| A. Reopening a request | Add a minimal owner-authenticated status read, separate from the existing pending-details read. | A reload or lost reply can be reconciled without restoring deleted personal details or pretending an approval is a booking. |
| B. Approve and decline | Approve uses the existing exact one-use replacement. **Decline this request** revokes only this pending exception. | Approval replaces the original unused one-booking permission. Declining the pending exception leaves that original permission intact if it is otherwise usable; it does not block all future requests. |
| C. Who is asking | Display the server-resolved registered agent label while the request is usable, clearly described as a name assigned by the account owner. | The label helps people recognize the request but is not verified identity, an agent's explanation, or authority evidence. |

Acceptance would authorize implementing this presentation/status contract and
its proof. The separate synthetic enablement and full-pipeline gates in ADR 0004
would remain in force. A green documentation PR is not design acceptance.

## Why the screen needs a decision now

The [private review reader](../private-step-up-review-http.md) verifies the
account and ownership, but returns details only for a `pending`, revision `1`
request that passes its existing read-side checks. This read does not prove the
shared booking budget is unused or the slot is currently available. The
[SQL read](../../supabase/migrations/20261103000000_private_step_up_review.sql)
collapses owned non-pending and stale outcomes to `VERSION_CONFLICT`. Its
[strict response](../../packages/contracts/src/v2/controls.ts) has no requester
label. A UI cannot derive a truthful terminal reason from that generic error.

The [current approval implementation](../../supabase/migrations/20261107000100_consumed_mandate_controls.sql)
returns an approval/preparation reference and deadline, not a confirmed booking.
It revokes/replaces the original unused one-booking mandate. The
[revoke operation](../../supabase/migrations/20261104000000_private_step_up_approval.sql)
can close a pending request or invalidate an unused approved replacement.
Revocation can also follow other authority changes, so `revoked` alone does not
prove that a person clicked Decline. Preparation deduplication applies while a
review is pending; it does not establish permanent refusal of future requests.

The served v2 transport, actor step-up status adapter and genuine issuer screen
are still missing. The existing Authority Lab is synthetic. The v1 booking
review can supply layout ideas, but its challenge/confirmation mechanism cannot
be used as v2 authority.

## A. Minimal status without reopening the private snapshot

Propose an additive principal-only
`GET /api/v2/authority/step-ups/{reviewId}/status`. Keep the existing pending
details schema and endpoint semantics unchanged. Use the strict v2 success and
problem envelopes; new schemas and SQL remain unimplemented pending review.

The server freshly verifies a non-anonymous account and derives the principal,
instance and epoch. It proves ownership before inspecting dependent references
or disclosing state. Unknown, foreign and no-longer-retained references retain
one bounded non-disclosing refusal. Link possession and monitoring access never
grant control or original-actor receipt access. Terminal metadata still requires
a live owner account and current instance/epoch binding. It may describe a
historical exact commit after the actor credential is revoked; it must not
restore that credential's receipt access or enable another action. Pending and
usable-approved states require the relevant live supporting authority.

The proposed response carries only the review reference, current CAS revision,
server observation time and one discriminated state:

| State | Minimal state-specific data | What it establishes |
| --- | --- | --- |
| `pending` | Review expiry and server-resolved requester label. | The request is currently usable for review; it does not reserve the time. The existing details read is still required before approving an exact digest. |
| `approved` | Approval expiry. | A recorded, currently usable unused exact grant exists. It does not establish a booking. |
| `closed` | One allowlisted reason: `revoked`, `expired`, `already_handled` or `unavailable`. | This request cannot currently authorize another first write. A specific reason is returned only when durable current state proves it. |

No status response contains reviewed name/email, the detailed snapshot, summary
digest, preparation/grant/receipt identity, confirmation code, credential,
private principal/actor identity or raw audit record. Only usable pending status
includes the requester label. Labels use the existing credential record; no new
historical label copy is retained.

State is derived under the existing principal fence using fresh time and the
same scope/binding checks as the relevant operation:

1. Report `already_handled` only when retained durable evidence proves a
   successful `principal_step_up` commit through this exact review/grant. This
   takes precedence over a later deadline but never proves the booking remains
   confirmed. If the original standing mandate consumed the shared budget
   elsewhere, this exception is `unavailable`, not an approval that was used.
2. Distinguish a later genuine revocation from the expected supersession of the
   original mandate by this exact review's replacement. The original mandate's
   resulting revoked state must not close its valid approved grant. Prove the
   review/grant/supersession chain; do not inspect that state label alone.
3. Use the pending review deadline only while pending. Once approved, use the
   replacement grant/preparation deadline already bounded by the approval
   operation. The older pending-review deadline must not expire an otherwise
   valid replacement. A proved later revocation precedes an expiry label.
4. Missing or changed supporting authority yields `unavailable` without exposing
   which supporting record changed. If the shared budget is consumed but exact
   same-review consumption cannot be proved, also return `unavailable`.
   Otherwise evaluate unused records from their live supporting state: a usable
   unused replacement is `approved`; a usable pending review with unused shared
   budget is `pending`. Unused records do not need a commit receipt. Neither
   state proves current slot availability.

The implementation must prove these distinctions and ordering in SQL races and
after receipt-payload cleanup. Do not infer them from `VERSION_CONFLICT`, a
client clock or shared-budget consumption alone. If a consumed budget cannot be
linked to this exact review using retained fences, return neutral `unavailable`;
do not retain or reconstruct private receipt payload just to produce a more
specific label.

There is an existing source for that historical distinction: the
[exception receipt schema](../../supabase/migrations/20261108000000_private_exception_booking_commit.sql)
retains provider and exact review/grant/preparation linkage under composite
ownership and epoch constraints. The
[receipt payload redactor](../../supabase/migrations/20261111000000_expired_booking_receipt_retention.sql)
clears the booking payload without deleting those links. This is internal
historical-use evidence, not a reason to read or expose the actor's receipt.

Status is available only while existing minimal ownership/state fences remain
retained. This proposal adds no retention period and does not extend ADR 0004's
five-minute review payload lifetime. After payload cleanup, do not reconstruct
the old snapshot from a current profile or expose it again for convenience.
After fence removal, use the same bounded unavailable-reference refusal as
unknown/foreign input. Real-user/Cloud retention still needs separate review.

All responses remain `no-store`, `no-referrer` and `nosniff`, with fresh server
request IDs and fixed redacted errors. No label, personal fields, credential,
request body or capability URL enters logs or minimal audit. Existing direct
RPC/table access stays default-deny. Any implementation needs additive narrow
SQL/grants, generated types and explicit owner/cross-owner tests; this proposal
does not itself change them.

## B. Actions and clear outcomes

The primary button stays **Approve this booking**. Before it, show the exact
person, host, meeting, date, start/end, duration, reviewed time zones and the
server-recorded differences that require approval. Keep these visible to both
first-time and experienced users. Show the permission consequence plainly:
“Allow your agent to book this meeting once. This replaces your current unused
one-booking permission. The time is not reserved.”

Use the exact instants and reviewed time zones in the authorized snapshot.
[ADR 0006](../adr/0006-delegated-booking-timezone-projection.md) preserves the
reviewed zone even when the older booking field is empty; do not silently
replace it or borrow an actor's receipt to reconstruct the display.

The secondary action is **Decline this request**. While pending, it calls the
existing exact revoke with the current revision. Explain: “Your agent's existing
permission stays unchanged if it remains valid.” This does not
create a durable denial of the same intent, revoke the agent credential or
cancel a booking. An approved unused grant needs a separately labeled revoke
action; do not silently map the pending Decline button to broader revocation.

| Observed outcome | Human-facing result and next step |
| --- | --- |
| Approval acknowledged, or status proves a usable approval | **Approval recorded.** This records permission to book, not a booking confirmation. Show the approval deadline and reconcile current status after a delayed reply. Do not show Booked or a confirmation code. |
| This page's exact pending decline is acknowledged | **Request declined.** Keep the scope explanation visible. On reopening, use a neutral closed/revoked message unless trustworthy decision provenance proves a human decline. |
| Expired | **This request has expired.** Ask your agent for a new request. Expiry never restores the permission replaced by approval. |
| Already handled | **This approval has already been used.** Ask the original agent for its receipt; do not offer another approval or assert that the booking remains confirmed. |
| Revoked or otherwise unavailable | **This request is no longer active.** Ask your agent to check current permission. Do not guess who revoked it or why supporting data changed. |
| Approval action returns `SLOT_UNAVAILABLE` or another canonical scheduling refusal | Explain the specific safe refusal and ask for another time. Do not substitute a slot, reserve one or retry with broader authority. |
| Response lost, network error or busy | **Checking the result** / **Unable to check yet** with a safe retry. Do not display success, decline or booking confirmation without a recorded result. |

For a lost approval reply, reconcile with the proposed status read. While the
page still holds the reviewed body in memory, an explicit retry must use the
same review ID, revision and digest; existing exact-retry rules remain
authoritative. After reload, do not recreate permission or persist private
snapshot data in browser storage to work around a missing status API.

The original authenticated actor must use its separately authorized step-up
status and original preparation/key/receipt path to resume. That accepted actor
status path still needs implementation. The issuer account must not borrow
actor credentials, receive another actor's receipt or mint a fresh key/approval
to reconcile an uncertain result. A later confirmed receipt may be returned by
the agent; only authoritative confirmation justifies **Booked**.

The first-party evaluation flow must stop this attempt after a closed/refused
result, rather than automatically generating another review to work around
Decline. A new explicitly requested attempt still needs the normal authority
checks. This client behavior is not a promise that the server permanently
suppresses every future request from a third-party agent.

## C. Requester display and interaction baseline

Resolve the label through this review's bound actor/credential, after ownership
checks. Display it as escaped plain text under “Your registered agent”, with
“A name you assigned to this agent.” Never treat a model-supplied name, rationale
or header as that identity. Show why approval is needed from the allowlisted
recorded differences, without claiming access to private agent reasoning.

Use the existing accessible cards, buttons, loading and recovery components.
The first-time phone view should explain the action without requiring knowledge
of mandates. The returning user gets the same facts and controls immediately,
keyboard access and no compulsory walkthrough. Avoid a redundant confirmation
dialog after the exact review. Disable pending controls during submission for
clarity; server transaction/replay checks enforce safety.

Keyboard proof must include visible focus and predictable Tab order, with
Enter/Space acting only on deliberately focused controls. Page load or a global
Enter handler must never approve a request.

## Alternatives and implementation proof

- A pending-only read page with generic unavailable recovery is possible today,
  but cannot satisfy complete approval/reload outcomes; do not present it as the
  finished feature.
- Do not widen the pending-only schema into an implicit terminal union, infer
  reasons from `VERSION_CONFLICT`, retain the private snapshot longer, or label
  every revocation as a human decline.
- A permanent “never ask again” policy, new guest cancellation, broad human
  receipt lookup, realtime monitoring and non-local operation require separate
  decisions. They are not hidden consequences of these choices.

After design acceptance, record the durable ADR and implement bounded pieces.
Preserve current unavailable routes until the separately reviewed synthetic
enablement gate is met. Do not change v1 or its four-tool manifest.

Required proof includes strict Node/Edge schemas and redaction; fresh Auth and
cross-principal/instance/epoch denial; real SQL status/retention and lock/race
tests; exact approve/revoke/retry and lost-response reconciliation; and mobile,
keyboard, accessibility and visual checks. Cover expiry during review, external
revocation, used/cancelled bookings, repeated clicks, reload and service errors.
Explicitly test an original standing booking consuming the shared budget before
exception approval, valid same-review supersession, a replacement still usable
after the older pending deadline, and same-review historical usage after
payload cleanup or credential revocation. Missing consumed-record linkage must
fail closed; an unused request must not require a commit receipt.

Rollback disables the new surface without restoring revoked permission,
deleting fences or recreating bookings. Independent user evaluation remains
separate from agent-run or synthetic evidence.
