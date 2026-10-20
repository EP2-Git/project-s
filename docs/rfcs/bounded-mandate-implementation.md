# RFC supplement: bounded-mandate implementation contract

- Status: **C1-C4 accepted for implementation; proof and enablement gated**
- Date: 2026-10-20
- Owner: Ethan Patten, lead maintainer
- Foundation: [ADR 0003](../adr/0003-authority-provider-bounded-mandates.md),
  accepted through [PR #41](https://github.com/EP2-Git/project-s/pull/41)
- Related: closed foundation [#16](https://github.com/EP2-Git/project-s/issues/16),
  future adversarial proof [#17](https://github.com/EP2-Git/project-s/issues/17)
- Source baseline: `d81042e3a05bea57a546d31734e6df18de582d7a`

D1-D5 are accepted and are not being reopened. This supplement supplies the
credential, wire, lifetime, storage and transaction choices deliberately absent
from the foundation. Ethan accepted C1-C4 on 2026-10-20 against recommendation
revision `5e162afa0facf59c0c4a13eb0e242b6c42cc3cd7`; see
[ADR 0004](../adr/0004-bounded-mandate-implementation.md). The technical proposal
below is retained as reviewed; implementation and SQL correctness remain unproven.
No type, endpoint, RPC, migration, credential or delegated write exists because
it is named here. Green existing-software CI cannot approve these choices.

## Decision brief

Recommend the following packet for the first **synthetic local** vertical slice:

| Review item | Recommended implementation choice | Cost / alternative |
| --- | --- | --- |
| C1. Identity and key lifecycle | Verify existing local account tokens through Supabase Auth; register one opaque agent credential per actor, valid at most seven days. Replacement revokes the old actor credential and requires new mandates; no overlapping keys or receipt transfer. | Simple revocation and original-caller semantics. An uncertain old result needs reconciliation before issuing another booking authority. In-place rotation with migrated receipts would need a different binding design. |
| C2. Step-up and cancelled receipts | An exact principal approval atomically replaces an active unused mandate with one five-minute one-use grant and a new preparation. Already-used/revoked mandates cannot be upgraded. Return an existing receipt only while its booking is still confirmed; cancellation returns `SLOT_UNAVAILABLE`, never a new booking. | Keeps one booking budget across the step-up chain and v1's cancellation refusal. Approval expiry does not restore the old mandate. |
| C3. Synthetic retention | Seven-day credentials/reviewed profiles, ten-minute preparations, five-minute review/step-up records, 24-hour committed-receipt access, seven-day minimal audit, and expiry-based tombstone cleanup as specified below. Non-synthetic enablement requires its own operator-reviewed retention configuration. | Bounded replay and private diagnostic history rather than indefinite receipt access. These are proposed test-instance policy values, not legal retention guidance or public-service defaults. |
| C4. Kernel isolation and contention | Serialize v2 authority changes per issuing principal; keep v2 rows separate from v1; use nonblocking acquisition at shared legacy row/owner boundaries, revalidate time after locks, and return a bounded retry on contention. | Trades throughput for a small inspectable first slice. No claim of a completed lock proof: SQL, FK/trigger effects and explicit wait/race tests remain release gates. |

Acceptance is recorded in ADR 0004 against the reviewed commit with no requested
C1-C4 revisions. It permits implementation with delegated writes disabled, not
production deployment or automatic enablement. The recommendation-review gate is
resolved; full pipeline and implementation/enablement gates remain binding.

## Identity, audience and control authority

Use the instance's existing Supabase Auth account as issuer/principal/subject;
the initial slice cannot delegate for another subject. The gateway verifies the
supplied account JWT with `auth.getUser(jwt)` against the configured local Auth
server, checks a registered non-anonymous account and derives its user ID. Do
not authorize from `getSession()` data, user metadata, email or payload IDs.
GetUser's network verification is documented by
[Supabase](https://supabase.com/docs/reference/javascript/auth-getuser); a valid
account still needs object authorization and the database checks below. A valid
JWT is not proof of physical human presence or email ownership. Auth failure or
outage fails closed before privileged calls; no network call occurs in SQL.

Persist a random instance UUID and a monotonic authority epoch in private Core
configuration. The operator binds that UUID to one configured API/review origin;
never derive the authority audience from an untrusted Host header. Every new
record/context carries the exact instance UUID, epoch and protocol version.
Moving origins or restoring a snapshot requires explicit invalidation/reissue,
not accepting two audiences silently. Existing public v1 audience is unchanged.

Issuer UI uses its existing account authentication, explicit review and same-
origin controls. New `/authority` routes remain unavailable when the feature is
disabled. Agent credentials are never issuer-session credentials. Account sign-
out does not silently revoke an issued mandate; a separate principal-authorized
revoke operation does. A missing Auth account or disabled Core principal denies
new delegated writes and actor receipt access even if credential records remain
for cleanup. An upstream Auth-admin suspension is not assumed to revoke actor
authority: the operator must disable Core authority first. That controlled
procedure needs proof before non-synthetic use. Never rely on an Auth deletion
cascade for this.

### Registered actor credential

Recommend `psa2.<credentialId>.<secret>`: a server-generated random UUID lookup
ID and an independent 32-byte cryptographically random base64url secret, without
padding. Save only its SHA-256 verifier, actor/principal binding, instance/epoch,
revision, state and fixed expiry. Compare a supplied verifier in constant time;
the ID alone authenticates nothing. High-entropy one-way verifier storage follows
[OWASP's guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#server-side-session-token-storage).
This is our proposed agent protocol, not an OWASP standard or an OAuth service.

Return the raw credential once to the authenticated issuer with `no-store`;
never persist it in authority rows, logs, URLs, issue examples or browser storage.
The issuer transfers it through an operator-approved secret channel to the
trusted local agent host. Local MCP reads it from a dedicated process environment
or OS secret facility, never command-line arguments or tool inputs. MCP stdout
is protocol-only, stderr allowlisted. HTTPS is mandatory except loopback testing.
A stolen active credential can spend its actual grant until revocation; hashing
does not protect a compromised agent or a database writer.

Registration fixes `expiresAt <= issuedAt + 7 days`. Do not refresh it. Revoke
under the principal fence below, append private audit and acknowledge only after
commit. Re-registering creates a different actor/credential identity. Old
mandates/preparations/receipts are never rebound to that replacement. Issuers may
inspect their own mandate's consumed state, but this is not an agent receipt
lookup or permission to create a compensating booking after a lost response.

### Reviewed booker profile and policy issuance

An authenticated principal explicitly reviews an immutable normalized profile
`{ name, email, guestTimeZone }`, using existing name/email/time-zone validation.
No notes are accepted; insert null/empty notes internally as appropriate to the
existing booking constraints. The profile gets a random private ID, revision,
review time and seven-day validity ceiling. Changes create a new reviewed
profile and new policy, never mutate a preparation. Profile deletion revokes
its outstanding policies under the same principal fence before removing PII.

Mandate issuance is two-phase: create a five-minute review showing the exact
normalized policy/profile and its server-computed digest, then explicitly approve
that revision/digest through the issuer-only route. Re-read the profile,
credential and current public host/type on approval; stale review requires a new
review. No checkbox or client `confirmed` value is an authority field. The
authenticated principal's exact submission is the recorded approval, not a claim
that software can prove a person's comprehension.

Policy fields are one actor, reviewed profile revision, resolved host/type,
`meetingWindowStart`, `meetingWindowEnd`, `maxDurationMinutes`, `notBefore` and
`expiresAt`. Only booking creation is permitted. The entire derived meeting
must fit the inclusive outer bounds; real duration is derived by the kernel and
must not exceed the policy maximum. Use `issuedAt <= notBefore < expiresAt <=
issuedAt + 24 hours`, also bounded by credential/profile expiry. No wildcard,
multi-use, recurring schedule, new subject, cancellation or re-delegation input.
Review/issuance do not hold a slot or guarantee future availability.

## Proposed strict v2 wire boundary

Use a separate `/api/v2` router and `application/vnd.project-s.v2+json` success
media type. Errors remain `application/problem+json` with a strict version-2
envelope. Reject unknown fields and versions at every nesting level. Do not add
these paths, codes or fields to v1 schemas/artifact digests. All new names below
are proposed contracts, not available operations.

Common scalar rules: IDs/idempotency keys are UUIDs; revisions positive integers;
digests 64 lowercase hex characters; instants canonical UTC ISO strings parsed
and normalized before hashing; time zones/usernames and booker fields use the
existing validators. `maxDurationMinutes` is an integer 5..1440. Labels are trimmed
1..80 characters, never authentication. Every request has a server request ID.
All objects are strict; no raw body, identity fields or policy secrets in logs.

### Principal-only controls

Each operation verifies the account JWT and object ownership; actor credentials
are refused. Path IDs are object references, not possession-based capabilities.

| Method/path under `/api/v2` | Exact body | Success data |
| --- | --- | --- |
| POST `/authority/actors` | `{label}` | `{actorId,credentialId,credential,expiresAt,audience,revision}`; raw credential returned once |
| POST `/authority/actors/{actorId}/revoke` | `{expectedRevision}` | `{actorId,revision,state:'revoked',revokedAt}` |
| POST `/authority/booker-profiles` | `{name,email,guestTimeZone}` | `{profileId,revision,reviewedAt,expiresAt}` |
| POST `/authority/booker-profiles/{profileId}/delete` | `{expectedRevision}` | `{profileId,state:'deleted',deletedAt}`; outstanding policy invalidation atomic |
| POST `/authority/mandate-reviews` | `{actorId,profileId,profileRevision,username,meetingTypeId,meetingWindowStart,meetingWindowEnd,maxDurationMinutes,notBefore,expiresAt}` | `{reviewId,revision,summaryDigest,expiresAt,policySummary}` |
| POST `/authority/mandate-reviews/{reviewId}/approve` | `{expectedRevision,summaryDigest}` | `{mandateId,revision,state:'active',issuedAt,expiresAt}` |
| GET `/authority/mandates/{mandateId}` | no body | `{mandateId,revision,state,issuedAt,expiresAt,remainingUses}`; owner only, no arbitrary booking lookup |
| POST `/authority/mandates/{mandateId}/revoke` | `{expectedRevision}` | `{mandateId,revision,state:'revoked',revokedAt}` |
| GET `/authority/step-ups/{reviewId}` | no body | `{reviewId,revision,state,summaryDigest,expiresAt,exactSummary,differences}` |
| POST `/authority/step-ups/{reviewId}/approve` | `{expectedRevision,summaryDigest}` | `{reviewId,state:'approved',preparationId,expiresAt}` |
| POST `/authority/step-ups/{reviewId}/revoke` | `{expectedRevision}` | `{reviewId,state:'revoked',revision,revokedAt}` |

`policySummary` contains exactly the normalized issuance fields above plus the
reviewed profile's three fields and resolved host/type display names; no owner
UUID or raw credential. `exactSummary` contains username, hostDisplayName,
meetingTypeId/title, startAt/endAt, host/guestTimeZone and reviewed name/email;
no notes. `differences` is an allowlisted array of field codes
`host`, `meeting_type`, `meeting_window`, `duration` with proposed/reviewed display
values, shown only to the principal. Stale revision is a refusal, never last-write-
wins. Repeated exact approve/revoke requests return their existing outcome to
the same verified principal; they never mint another credential/grant/mandate.
`revision` is a compare-and-swap state version. The issued policy's separate
internal `policyRevision` and digest are immutable; state changes cannot widen
them or make an eligible committed receipt fail a first-write version check.
Reusing an old revision with different approve data is `VERSION_CONFLICT`.

### Actor operations and responses

Use `Authorization: Bearer psa2...`, not a tool argument or a second fallback
JWT parser. Derive principal, actor, credential revision, audience and epoch from
verified state. Reject account JWTs on actor routes, and actor tokens on controls.
Public v1 discovery/slots remain usable as public data and convey no authority.

| Method/path under `/api/v2` | Exact body | Success data |
| --- | --- | --- |
| POST `/delegated/bookings/prepare` | `{mandateId,username,meetingTypeId,startAt}` | `{preparationId,expiresAt,notHeld:true,summaryDigest,summary}` |
| GET `/delegated/step-ups/{reviewId}` | no body | `{reviewId,state,expiresAt}` plus `preparationId` only when approved |
| POST `/delegated/bookings` | `{preparationId,idempotencyKey}` | `{receiptId,receiptExpiresAt,booking}` |
| GET `/delegated/receipts/{receiptId}` | no body | same receipt data; original caller only |

Actor `summary` is exactly username, hostDisplayName, meetingTypeId/title,
startAt/endAt, host/guestTimeZone; it omits reviewed name/email and policy bounds.
`booking` is exactly confirmationCode, status:'confirmed', username,
meetingTypeId/title, startAt/endAt, host/guestTimeZone. IDs for private authority
objects are not host/booking UUIDs and cannot be used as authentication. A
preparation ID is an authenticated reference, not a transferable bearer token.
This avoids storing raw preparation capabilities for repeat delivery in v2.

Common success envelope is exactly `{contractVersion:2,requestId,data}`. Problem
envelope is exactly `{contractVersion:2,requestId,error}`; `error` contains the v1
problem field shapes (`code,status,type,title,detail,requestId`, optional
`retry,fieldErrors,alternatives`) with a distinct v2 code enum, plus optional
`stepUp:{reviewId,reviewUrl,expiresAt}` only for the outcome below. Alternative
slots, if returned, use the current public maximum of three. No diagnostic,
credential existence, principal ID or other actor's policy in public messages.

Use existing applicable v1 code meanings in this *new* enum, plus:

| Condition | HTTP / v2 code / retry |
| --- | --- |
| Invalid/expired/revoked credential, missing principal or wrong instance/epoch | 401 `AUTHENTICATION_REQUIRED`; no identity detail |
| Unknown/not-owned/revoked/exhausted mandate or another caller's receipt | 403 `FORBIDDEN`; uniform bounded message |
| Active owned mandate, valid caller, but requested host/type/window/duration outside policy | 428 `STEP_UP_REQUIRED`; opaque `stepUp` reference, no automatic write/fallback |
| Expired active mandate | 410 `MANDATE_EXPIRED`; new principal-issued policy required, not automatic step-up |
| Active policy before its permission not-before instant | 403 `FORBIDDEN`; no automatic step-up |
| Retained original caller's receipt after access deadline, or booking removed | 410 `RECEIPT_UNAVAILABLE`; do not create again |
| Booking cancelled before replay/receipt read | 409 `SLOT_UNAVAILABLE`; no receipt claiming a live confirmed booking |
| Shared lock busy or exhausted bounded serialization retry | 503 `AUTHORITY_BUSY`, `retry:{action:'retry_after',afterSeconds:1}`; same identity/preparation/key |

Malformed requests, stale preparations, host changes, conflicts and idempotency
mismatch retain their existing semantic refusals through v2 codes. Redact
upstream failures as `INTERNAL_ERROR`. Provider denial/outage never selects the
browser v1 provider. HTTP, typed SDK and a separately configured authenticated
local-MCP process must share generated schemas and golden vectors. Existing
v1 four-tool discovery remains unchanged; the authenticated MCP manifest exposes
only prepare/create/step-up-status/receipt, never issuer controls or arbitrary
RPCs. No remote MCP or OAuth negotiation is proposed.

## Exact step-up and replay state transitions

An out-of-scope request can create one bounded, five-minute pending review only
after live credential/owned active mandate validation. Rate-limit creation and
deduplicate the same caller/mandate/intent digest while that review is pending;
cap outstanding preparations/reviews per actor (proposed 20). Anonymous and
hard-denied requests get no review. `reviewUrl` uses the configured same-origin
`/authority/review#review=<opaque-id>`; it grants no access without principal
authentication. Only the principal sees profile PII and exact differences.
Both review creation and approval require a currently usable original
permission (`notBefore <= fresh time < expiresAt`), live profile/credential and
remaining budget. An `active` state label alone is insufficient.

Approval revalidates the active credential/profile/unused original policy and
current host facts, revokes that policy for step-up, and creates one new exact
preparation and one five-minute one-use grant in the same transaction. The
original policy cannot also commit. If it was consumed/revoked or review/intent
changed, approval refuses. A new preparation is required; approval does not
retroactively bless an old one. Expired approval does not reactivate the old
policy. Current public challenge/limiter protections remain unchanged; the new
authenticated UI needs origin/CSRF, action-binding and accessibility tests.
Revoking the approved step-up invalidates its unused grant/preparation.
Revoking the original mandate also revokes any unused replacement grant under
the same principal fence, even if the policy was already marked revoked for
step-up. Stale state revisions refuse; an acknowledgement cannot leave a linked
grant able to make a subsequently serialized first write.

For first writes, require `notBefore <= freshLockTime < expiresAt` and validate
the whole meeting, profile, credential, epoch, immutable summary, host revision
and budget. For exact committed retries, authenticate current credential first,
then resolve the original caller/instance/preparation/key/intent receipt before
first-write mandate expiry/revocation/consumption checks. After credential
revocation/expiry, deny even that read. No credential replacement transfers it.
Cancellation or removal never resurrects a confirmed booking. Replays consume
no use and append no second authoritative success event.

## Proposed private data and kernel algorithm

Add separate private v2 tables: principal fence/state, actor credentials,
reviewed profiles, issuance/step-up reviews, immutable mandates, preparations,
exact step-up grants, commit receipts/idempotency bindings and audit. All default
deny; no anon/authenticated table grants. Gateway-only narrow RPCs revalidate
object binding before elevated execution, with fixed search paths/revoked PUBLIC
execute. The server service role remains a trusted boundary, not a client key.

Internal contexts are strict server inputs, never accepted from public bodies:
principal context contains requestId, principalId, subjectId equal to principal,
instanceId, epoch, verifiedAt and transport (`ui` or `http`); actor context adds
actorId, credentialId, credentialRevision and the verified credential fingerprint,
with transport `http` or `stdio_mcp`. Verification never accepts arbitrary
context overrides. SQL re-reads current binding/revision/state rather than
treating `verifiedAt` or a fingerprint as cached permission.

Provider output is a discriminated internal result: `denied`, `step_up_required`
with a bound review reference, or `evidence` with provider/version, preparationId,
summaryDigest and immutable policy/grant reference. Only the server selects
`local_mandate` or `principal_step_up`, version 1, from stored preparation state.
Unknown shapes/versions and `allowed:true` are invalid. The kernel validates the
reference and current identity; evidence resolution itself cannot commit.

Keep legacy tables from acquiring new authority rows via cascades/triggers:
do not add a foreign key from public bookings or auth/profiles into v2 state.
New private records use logical references to legacy principal/booking IDs;
the kernel checks live rows, and removed legacy rows yield refusal, not success.
Constraints within the new private domain enforce bindings and one-use state.
Composite principal/parent keys prevent references crossing principal fences;
object ownership is checked before acquiring a referenced row or inserting an
FK. Initial fence creation is issuer-only, idempotent by principal/epoch; an
agent cannot bootstrap a missing principal record.
This deliberately requires explicit orphan cleanup and transactional tests;
it is not a claim that an ORM or RLS can repair dangling authority.

Keep the existing public booking row shape: v2 uses an internally generated
random booking idempotency UUID and null v1 `preparation_id`; its private receipt
links the new preparation and booking. Unique private idempotency identity is
`(instance,epoch,principal,actor,credentialId,clientKey)` bound to exact intent.
The raw client key is not logged or copied into audit; use a domain-separated
keyed digest for the binding, with one fixed key per authority epoch retained
through its live references/tombstones. A key change requires epoch invalidation,
not silently losing existing idempotency bindings. Do not treat the client's
UUID as a global v1 key.
Commit creates that binding, booking, usage and audit atomically; exclusion and
legacy uniqueness constraints remain active. Never call the retired direct
public create RPC or fabricate a v1 browser grant to reuse its commit path.

### Lock order and old-path compatibility

Use short READ COMMITTED transactions and one private principal fence first,
then new rows in this order: credential, reviewed profile, mandate, review,
preparation/grant, idempotency/receipt. Missing rows are not negative locks;
unique keys plus the principal fence cover concurrent creation. No transaction
owns two principal fences. Issuance, revoke, profile deletion, prepare, step-up,
commit, receipt access and per-principal cleanup all follow this order.
Propose per-RPC one-second lock timeout and five-second statement timeout, not
global database settings. A timeout aborts the whole attempt and maps to the
bounded busy result; deadline checks still run after every successful wait.

At a shared legacy boundary, acquire required row locks **without waiting**:
`FOR KEY SHARE NOWAIT` for issuer Auth user, host profile and composite host/type
key, in fixed table/UUID order. Acquire any existing booking used for replay
with `FOR SHARE NOWAIT`. Before first insertion, try the existing owner advisory
transaction lock using the same owner-key derivation as v1; on false, roll back
and return `AUTHORITY_BUSY`. Do not hold new authority rows while waiting on an
old owner lock, or hold an owner lock while waiting for a mutable legacy row.
The earlier key-share locks cover insertion's FK dependencies; plain schedule
reads after owner acquisition do not take new mutable-row locks.

| Existing/new path | Required treatment in the implementation proof |
| --- | --- |
| v1 first commit | Existing preparation/booking probe/grant then owner lock remains untouched; v2 never locks those v1 private rows. |
| v1 exact replay | Existing preparation then booking-row lock can return before owner acquisition; v2 receipt/booking read uses NOWAIT and never requests an owner lock afterward. |
| Host cancellation | Existing owner then booking lock; v2 never waits on its booking row and does not add a callback into new authority rows. |
| Meeting/profile CRUD | Current row triggers acquire owner locks and inserts/checks may acquire implicit FK locks. Pre-acquire required key-share rows without waiting; a busy owner causes whole-v2 rollback. Do not claim a simple appended row-lock order covers triggers. |
| Weekly schedule/availability/revision writes | Use existing owner fence and fresh plain reads; no new row-lock acquisition on those rows from v2 after owner acquisition. |
| Existing grant/preparation/rate cleanup | Its SKIP LOCKED retention works only on v1 rows. Do not attach new references that make those deletes enter v2 state. |
| v2 credential/mandate revoke | Same principal fence as commit; acknowledgement after durable state/audit commit. No owner lock required, no cascade across principals. |
| v2 cleanup/recovery | Per-principal fence first; ordered new rows, no legacy booking mutation. Recovery is offline/disabled as below. |

After *all* potentially blocking locks, re-read durable credential/epoch/policy,
usage and intent and take `clock_timestamp()` for permission/preparation/step-up
expiry and scheduling notice. Recompute current host duration, end time,
availability/buffers and revision under the owner fence. Atomically insert under
the exclusion constraint, consume one evidence use, redact preparation PII,
store minimal receipt and append success audit. Audit failure rolls all of it
back; a gateway audit sink cannot substitute for this transaction. Conflicts,
timeouts and rollbacks consume nothing.
Assign a monotonic per-principal event sequence to durable commit/revoke audit
under the fence so race results can be compared to serialization order. Gateway
request events are distinct. Refusal audit is a separate minimal transaction
after rollback; audit failure must not expose diagnostics or replace the
canonical denial, and can never be used as evidence of a successful commit.

The proposed nonblocking boundary prevents adding an old-owner wait edge while
new authority locks are held; it is an argument to test, not an exhaustive SQL
proof. Enumerate actual FK/index/trigger locks and account/host deletion paths
in the migration review. Any newly discovered blocking legacy acquisition must
be moved before the boundary, made nonblocking, or keep enablement blocked.
On 40P01/40001, allow at most one automatic whole-transaction retry with unchanged
identity/preparation/key, fresh authentication/epoch checks and no held locks
between attempts; otherwise return the bounded busy problem. Do not retry a
permanent denial or silently choose another key. PostgreSQL documents the
[lock interactions and consistent-order requirement](https://www.postgresql.org/docs/15/explicit-locking.html)
and the distinction between transaction time and
[actual wall-clock time](https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

## Retention, deletion and recovery proposal

These values apply only to the proposed synthetic local proof. This RFC does
not change existing booking/host retention or impose a legal retention period.
Non-synthetic operation must remain disabled without a separately reviewed,
explicit operator policy. Reads enforce deadlines even if a cleanup worker is
late; expiry is not dependent on a successful purge.

| Data | Access / proposed deadline | Deletion and safety condition |
| --- | --- | --- |
| Raw agent secret | Issuer once; agent process only | Never stored in DB/audit/backups by this protocol; issuer must not recover it through a get endpoint. |
| Credential verifier/binding | Maximum seven days from issue; revoked/expired denies writes and receipts | Keep minimal tombstone until original expiry plus seven days, then purge under fence if no live dependent authority; never extend expiry. |
| Reviewed profile PII | Issuer only, at most seven days; actor responses omit it | Explicit delete invalidates active dependents atomically; purge expired unreferenced PII. Keep only keyed references where necessary. |
| Pending review/preparation/step-up | Review five minutes, normal preparation ten minutes, approved step-up at most five minutes, each also bounded by live supporting credentials/profile/permission | Purge uncommitted sensitive data after expiry; no slot or budget is held. |
| Committed preparation | No booker PII after successful commit | Keep minimal immutable intent/caller/evidence binding only while needed for receipt or usage fences; never copy profile PII into audit. |
| Committed receipt | Original active credential only, at most 24 hours after commit and while booking confirmed | After deadline return RECEIPT_UNAVAILABLE; retain only minimal consumption/idempotency tombstone until supporting authority can no longer authorize, then purge. No automatic second create. |
| Mandate/revocation/consumption tombstone | Private issuer/actor ownership checks, no general list | Keep until maximum original supporting credential/policy expiry plus seven days and no live references; policy PII is already separate. |
| Minimal success/revoke/refusal audit | Access-controlled operator evidence, seven days | Keyed refs, version/action/reason/order/time only; no secrets/raw keys/prompts/request bodies or booker fields. Digest linkage remains sensitive. |
| Existing booking and operator backups | Existing host/operator policy, outside these synthetic defaults | Receipt/profile purge does not delete a booking or claim backup erasure. Snapshot invalidation must prevent authority revival. |

Account deletion or a retention request must first disable/revoke live authority
under its principal fence. Where an out-of-band Auth delete bypasses that path,
the kernel's live-account lookup still denies use; cleanup later removes PII and
keeps only required expiry fences. Do not add a cascade that silently destroys
usage evidence while credentials can still work.

Restoration starts with delegated routes disabled. An operator must supply a
fresh externally recorded instance epoch (or a fresh instance UUID), invalidate
every restored credential/mandate/step-up and stop old workers before any
re-enable. The control value must not come solely from the restored snapshot.
Drain or terminate in-flight delegated transactions before acknowledging the
recovery boundary; disabling HTTP admission alone does not fence an existing
commit. Prove that old workers cannot reconnect with the restored epoch.
Reissue explicit authority; old receipts are unavailable to invalidated old
credentials. Preserve booking history and test restore/revoke ordering with
synthetic data. No production backup/infrastructure action is authorized here.

## Implementation and proof sequence after review

1. Record the accepted supplement/ADR and exact C1-C4 decisions. Add separate
   strict v2 schemas/generated artifacts and pure model vectors with fixed seeds;
   keep v1 artifact digest unchanged. No delegated availability claim.
2. Add forward private state, fences, verifier and narrow control/commit RPCs with
   routes disabled. Test grants, direct-RPC denial, orphan/deletion and rollback;
   generate types. No broad table grants or service-role browser credentials.
3. Add synthetic issuer review/revoke/step-up UI and actor HTTP/SDK/local-MCP
   adapters. Preserve existing app chrome/flows and v1 manifest. Test origin,
   CSRF, inaccessible review IDs, token redaction, keyboard/Axe and state changes.
4. Under #17, prove wrong caller/resource/audience/epoch, bounds, every expiry
   wait, profile/credential/mandate revoke races, one-use budget including step-up,
   repeated/different-key cross-transport commits, cancelled/expired receipts,
   unavailable provider, atomic audit rollback, cleanup and snapshot invalidation.
   Minimize/preserve failing seeds. Include simultaneous v1/v2 conflict and
   shared-host CRUD/cancellation/FK-contention cases; mocks do not prove them.
5. Require the full exact-candidate pipeline and explicit synthetic enablement
   review. The independent two-principal #18 proof is still separate; published
   host policy is not an authorized host agent. No release/deployment/customer
   data, calendar/notifications or guest cancellation/rescheduling is added.

If implementation needs a material change to accepted semantics, record and
review that change before implementing it. Reconcile remaining blockers once on
each run and advance eligible work; do not repeatedly request C1-C4 approval,
rewrite this packet without new evidence or treat green CI as proof of delegation.
