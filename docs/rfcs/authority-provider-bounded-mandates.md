# RFC: Authority providers and bounded mandates

- Status: **Foundational direction and D1-D5 accepted; not implemented**
- Date: 2026-10-18
- Maintainer decision: 2026-10-19; [ADR 0003](../adr/0003-authority-provider-bounded-mandates.md)
- Decision owner: Ethan Patten, lead maintainer
- Tracking issue: [#16](https://github.com/EP2-Git/project-s/issues/16)
- Scope: Core 0.2 authority foundation, subject to the implementation gates below
- Supersedes: none; [ADR 0001](../adr/0001-agent-native-public-booking-boundary.md)
  remains the current contract

Ethan reviewed PR #41 and explicitly approved its recommended path on
2026-10-19, against RFC revision `543e38a61c07f77f8454af0355222bf2ac00c177`.
[ADR 0003](../adr/0003-authority-provider-bounded-mandates.md) records the accepted
foundation and D1-D5. This decision comes from maintainer review, not green CI.
It permits the next implementation-design work; it does not supply the concrete
credential lifecycle, retention matrix, authenticated wire contracts or complete
SQL lock plan that this RFC deliberately leaves for review. Delegated writes
remain unavailable. The proof obligations for
[#17](https://github.com/EP2-Git/project-s/issues/17) and the separate bilateral
epic [#18](https://github.com/EP2-Git/project-s/issues/18) are not completed by this
acceptance or by tests of the current v1 software.

## Decision brief

Recommend a Core-owned authority-provider boundary with two evidence kinds:
existing exact per-booking browser grants, and a future authenticated-principal
mandate held and revalidated in the same database as scheduling. Providers
identify evidence; they cannot authorize a write by returning a boolean. The
database must validate the evidence and current scheduling facts atomically.

The first proposed delegated slice is **guest-side, one successful booking,
one host and meeting type, one finite meeting window, one registered actor**.
Published host availability remains the host's existing invitation policy; it
is not an independently authorized host agent. Full bilateral proof remains
the separate, blocked #18 epic.

The following recommended decisions were accepted by Ethan on 2026-10-19:

| Decision | Accepted recommendation | Alternative / consequence |
| --- | --- | --- |
| D1. First slice | Guest-side bounded mandate against an already-public host meeting type; at most one successful commit per mandate. | Keep per-booking only, or require independently issued mandates on both sides first; the latter expands the initial identity and policy scope. |
| D2. Identity and issuer | Authenticated local principal explicitly issues to one independently revocable, registered agent credential. Verify the credential-to-principal mapping server-side. | External identity/portable credentials require a separate trust and revocation design; do not derive identity from guest email, an MCP client name or a request header. |
| D3. Scope and lifetime | One exact host and meeting type, a fixed UTC meeting window, maximum duration, mandatory finite permission expiry, and one commit. The initial permission-lifetime ceiling is 24 hours. | Broader scopes, recurring wall-clock rules, multiple uses or a different ceiling need explicit semantics and tests; no unlimited default. |
| D4. Step-up and replay | Out-of-scope requests need a new, exact approval from the relevant verified principal. Mandate revocation prevents new writes; an authenticated original actor may still resolve its own eligible committed retry. | Denying receipt access on mandate revocation was the alternative, not the selected path; credential revocation still denies it. Existing anonymous v1 approval cannot prove a delegated principal's identity. |
| D5. Enabling the new boundary | Separate versioned authenticated contract/context and additive database changes; preserve v1 unchanged and disabled-by-default delegation. | A deliberate breaking replacement needs its own migration decision; adding optional authority fields to strict v1 is incompatible. |

These accepted decisions constrain the next design and implementation; they do
not fill in missing specifications. Before implementing new delegated paths,
review the identity/credential lifecycle, retention/deletion matrix, strict
authenticated contracts and complete lock plan required below. No identity
adapter, retention duration or wire schema is implied by acceptance of D1-D5.

## Current behavior and constraint

The current [four-operation ledger](../adr/public-booking-capability-ledger.md)
supports discovery, slot search, non-holding preparation and create. Anonymous
create requires server-recorded browser confirmation. The gateway derives
context; a client cannot supply authoritative identity, scope or approval.
The browser's local challenge does not prove a natural person's identity or
email ownership. See [confirmation](../agent-confirmation-flow.md).

Existing types contain `delegated_agent`, principal/subject/delegation fields
and shape checks. That is not a mandate issuer, credential verifier or durable
delegation policy. The public gateway currently derives anonymous context for
public operations; self-reported client metadata is not authentication.
The existing `AuthorizationPort` scope check is not a substitute for lock-time
authority. Introducing a provider must not turn those reserved shapes into
automatic permission.

Source anchors for review:

- [ExecutionContext](../../packages/contracts/src/common.ts), including its
  strict schema and current browser-confirmation grant methods;
- [application authorization](../../packages/application/src/application.ts)
  and [ports](../../packages/application/src/ports.ts);
- [gateway](../../supabase/functions/api-v1/index.ts) and
  [database adapter](../../supabase/functions/_shared/supabaseAuthority.ts);
- [prepared-authority baseline](../../supabase/migrations/20260819010000_agent_native_booking.sql)
  and [fresh post-lock checks](../../supabase/migrations/20260824000000_recheck_prepared_authority_after_lock.sql).

The proposal preserves deterministic time, buffers, notice, horizon, overlap,
owner locking, policy revisions and host cancellation. Providers cannot supply
duration, end time, availability or a conflicting scheduling implementation.

## Proposed authority-provider boundary

One internal application boundary should describe both evidence kinds without
changing the four public v1 operations. These are conceptual responsibilities,
not new exported TypeScript types, RPC names, routes, tools or wire fields:

| Responsibility | Input and output | Authority limit |
| --- | --- | --- |
| Verify caller | Transport credential to server-verified principal, actor, audience and credential revision. | Metadata, model text and possession of a preparation token are insufficient. Current anonymous v1 remains anonymous. |
| Resolve provider evidence | Verified caller plus exact prepared intent to a typed browser-grant reference, mandate reference, step-up requirement or denial. | A reference is a candidate to validate, not an allow decision. Provider selection is server-controlled and bound to the preparation. |
| Validate and commit | Evidence reference plus immutable intent and verified context to a stored result or canonical refusal, in the scheduling transaction. | Re-read durable evidence/revisions and all scheduling facts after required locks. Never trust a gateway preflight as the final decision. |
| Consume/revoke | Atomic evidence usage or principal-authorized revocation. | Commit and revoke serialize on the same authority state; providers cannot acknowledge revocation using only a cache. |

Unknown providers, unsupported evidence versions, unavailable verification,
missing identity or ambiguous ownership fail closed. Do not automatically try a
weaker provider after a denial. Provider errors must not become permission or
fall through into a service-role write. External network verification cannot
hold a database transaction open; any future external provider must explain how
its current revocation state becomes authoritative for the final transaction.
Portable/offline evidence is outside this first proposal.

Browser evidence remains an exact, expiring, one-use preparation/summary-bound
grant. Mandate evidence references an authenticated principal's durable policy
and current revision. Both must bind the action, actor, audience, preparation
and summary; neither authorizes arbitrary scheduling writes. A provider may be
replaced without removing database enforcement or making correctness Cloud-only.

## Proposed bounded mandate model

The proposed mandate is private Core authority data, not a public client-supplied
policy object. An authenticated principal reviews a human-readable policy and
explicitly issues or revokes it through an authenticated, object-authorized
control path. The exact control contract and actor-credential registration,
issuance, rotation and revocation must be part of the accepted design. Reusing
the anonymous review checkbox would not establish that principal's authority.

Here the issuer/principal is the authenticated account granting guest-side
authority; the actor is the separately registered agent executing it; the
booking subject is that principal whose reviewed booker data is used. The first
slice does not let a principal issue on behalf of a different subject. Define
these roles explicitly in the new context; do not infer their mapping from the
reserved UUID fields of v1.

Minimum conceptual fields and constraints:

| Element | Required meaning |
| --- | --- |
| Issuer/principal | Stable operator-local authenticated identity entitled to delegate this guest-side action. Does not assert real-world identity or email ownership. |
| Actor/subject binding | One registered agent identity and verified credential binding to the issuing principal/booking subject, distinct from display metadata. Credential revocation must also block subsequent delegated writes. No transferable bearer mandate. |
| Audience and provider | Exact instance/trust domain and supported provider/version. A reference from another instance or provider is refused. |
| Resource and action | Exact resolved host and active meeting type; booking creation only. No wildcard owners, cancellation, rescheduling, schedule editing or re-delegation. Guest fields cannot impersonate another issuing principal. |
| Guest intent binding | Reference a principal-owned, explicitly reviewed booker-profile revision rather than accepting arbitrary agent-selected guest details. Initial delegated notes are empty. This binding does not prove email ownership; changed profile data requires a newly reviewed policy and preparation. |
| Meeting bounds | Explicit UTC interval within which the whole derived meeting must fit; maximum derived duration. Existing host rules further restrict the result. No recurring/DST mandate language in the first slice. |
| Permission bounds | Finite not-before and expiry instants, separate from the allowed meeting interval. Valid at `notBefore <= lockTime < expiresAt`; D3 accepts an initial 24-hour lifetime ceiling. |
| Usage | One successful first commit. Preparations, refused attempts and exact retries do not consume it; distinct requests cannot multiply its budget. |
| Revision/state | Immutable issued policy at a revision, active/revoked/exhausted state, timestamps and private audit linkage. Changing scope requires a newly reviewed policy/revision; it never silently widens an existing preparation. |

Mandate issuance does not hold a slot or guarantee availability. Keep issuance
and preparation separate: one bounded policy may authorize selecting a valid
slot, while each preparation still binds one exact intent and current host
revision. A changed actor, resource, guest intent, policy or summary requires
re-preparation; a newly issued mandate cannot retroactively approve an old
preparation. Explicit bound semantics must be shared by all new transports.

## Expiry, revocation, races and replay

For a first commit, check live credential state, mandate revision/state, usage,
scope, exact intent and fresh clock **after all potentially blocking authority
and owner locks**, then atomically insert, consume the permitted use and append
the authoritative success audit. A rollback or conflict consumes nothing.
Only the commit transaction may declare success.

Revocation and first commit must share a serialization fence. If revocation wins,
the first write is refused. If a commit wins and becomes durable first,
revocation does not undo that booking. A principal's revoke acknowledgement
means no subsequently serialized first commit can use the revoked revision;
it cannot promise that a booking already committed before revocation disappears.
Revocation is not cancellation. The authenticated host cancellation contract
and optimistic version check remain separate.

The new SQL lock plan must be reviewed against existing v1 preparation, grant,
booking, owner, schedule-write and cleanup paths. Declare a complete ordering
for credential bindings, mandate records, preparations, idempotency identity
and owner locks, including mutation/revocation paths. An acceptable algorithm
must show that no old path acquires these locks in the opposite order; do not
just prepend a mandate lock to the current function. Review cross-principal
and cross-owner cases before expanding the one-host proposal. Never hold locks
across a human prompt or a remote-provider call. Deadlock/serialization retries
retain the original identity and idempotency key and have bounded retry behavior.

Use a fresh database wall clock after lock waits for permission/preparation
expiry and scheduling notice. The configured database major is PostgreSQL 15;
its [clock documentation](https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)
distinguishes actual time from transaction-start time. Its
[locking guidance](https://www.postgresql.org/docs/15/explicit-locking.html#LOCKING-DEADLOCKS)
requires consistent lock ordering to avoid deadlocks. Those primitives support
the proposed requirements; they do not prove this unimplemented lock plan.

Separate **first write** from **eligible committed retry**:

- Bind the idempotency identity to the exact preparation, intent fingerprint,
  original verified actor/principal, audience and provider evidence. Changed
  input or context is a refusal, not a new lookup or automatic key rotation.
- An exact retry must not create a second booking, consume another mandate use
  or append another successful commit event. All transports share the same
  authority/idempotency domain and concurrent-request behavior.
- Accepted D4 requires that revocation/expiry of the mandate cannot erase an already
  committed result. Receipt access still requires the original verified caller
  binding and an active credential; revoking authentication itself denies that
  access. This is a receipt-access policy, not permission to retry new writes.
  Authenticate first, then let the kernel distinguish a bound committed retry
  from a first write before applying first-write mandate expiry/usage checks.
  An exhausted/revoked-mandate preflight cannot replace that distinction or
  become a receipt lookup oracle for a different caller.
- Preserve v1 behavior, including its existing refusal after cancellation.
  Do not present an old confirmed result as a current-status lookup or resurrect
  a cancelled booking. The new version's precise replay/cancellation behavior
  must be approved and covered by parity vectors before enabling it.

## Refusal and human step-up

Provider decisions are conceptually evidence available, step-up required or
denied. They are not new v1 problem codes. The authenticated version must define
strict, privacy-bounded problems and retry guidance before implementation:

| Condition | Proposed outcome |
| --- | --- |
| Missing/unknown provider, wrong actor/subject/audience, forged evidence or revoked credential | Deny; do not disclose whether another principal's mandate exists. |
| Expired/revoked/exhausted mandate or wrong resource/scope | No delegated write. A principal may separately approve a new exact request or issue a new mandate; never refresh the old authority automatically. |
| Valid identity but desired action exceeds reviewed bounds | Step up only to the principal whose authority is missing, with exact human-readable differences. No silent broadening or approval by a counterparty. |
| Stale preparation, changed policy, unavailable slot or elapsed notice | Refuse/re-prepare using live facts. Human approval cannot override scheduling constraints. |
| Provider outage, unsupported version or unverified revocation freshness | Fail closed; no cache-based allow or anonymous downgrade. |

For authenticated delegation, step-up must preserve principal/actor/audience
bindings and produce new action-bound evidence. The current anonymous v1
browser flow remains available for its own independent requests; it cannot
repair a different authenticated principal's failed mandate by relabeling the
same preparation. No hard-denied request may pass solely because the client
chooses the browser provider. Rate limits and challenge policy remain required
at their reviewed boundaries; this RFC does not remove production challenges.

## Database, RLS and audit impact

Future migrations would add private mandate/credential-binding state and
preparation-to-evidence/revision bindings, consumption and revocation events.
Exact SQL/table/operation names are deliberately not implementation commitments.
Required controls for an accepted implementation:

- Default-deny tables and narrowly granted RPCs. Neither anonymous clients nor
  an ordinary authenticated user may set principal, actor, scope, usage,
  revision, grant or provider validation state with arbitrary table writes.
- Principals may manage only their own mandates through the reviewed control
  path. Agents may exercise only their bound action, not issue/edit mandates or
  gain host privileges. Check anonymous, issuer, bound actor, other principal
  and host roles, with object authorization before privileged adapter calls.
- The server-only adapter credential remains a privileged trust boundary, not
  a client capability. Restrict RPC grants/search paths and generated types;
  do not imply RLS protects against a compromised service-role credential.
- Atomic first commit, evidence consumption and success audit; separate minimal
  refusal audit without committing partial authority state. Handle audit failure
  explicitly: no unaudited success through a fallback sink. Do not duplicate
  the gateway request event and the authoritative commit event semantically.
- No owner/busy-interval/raw-policy/credential disclosure in ordinary booking
  responses, logs or MCP text. Anonymous v1 direct database creation stays denied.
- Pure Core must include verification, revocation, privacy and deterministic
  commit. No proprietary Cloud service or network callback is required.

## Privacy, retention and recovery

Mandates introduce a relationship between a principal, actor, resource and
policy. Treat those links and any owner-only inspection UI as private. Avoid
storing guest PII in the mandate; exact booker fields stay in the preparation
boundary and must not be copied into mandate audit events. Guest name/email
are not authentication evidence. Preserve the current
[privacy/provenance restrictions](../agent-privacy-provenance.md).

Authoritative audit should identify provider/version, private evidence revision,
action/request, bounded outcome/reason, timestamps and consumption/revocation
ordering. Use access-controlled references and domain-separated keyed digests
for principal/actor/evidence identifiers where correlation is needed. A digest
is still sensitive linkable data, not anonymization. Never record credentials,
capability URLs, raw idempotency keys, request bodies, prompts or guest fields.

Define an operator-reviewed retention/deletion matrix for mandate policy,
revocation tombstones, credential bindings, audit and minimal replay records
before enablement; do not invent a universal legal retention period here.
Expired unused preparations must remain purgeable; deletion must not erase
revocation fences or usage accounting while stale evidence could still authorize
a write. Retain only the minimum data needed for authorized replay, with access
and expiry rules. A legal notice checkbox is not proof of durable legal consent.

Backup restoration must not reactivate credentials or mandates revoked since
the snapshot. Keep delegated writes disabled during recovery until the reviewed
invalidation/rotation procedure has invalidated prior authority and issued
fresh evidence. Preserve committed booking history; demonstrate recovery with
synthetic data before any service-readiness claim.

## Compatibility, migration and rollback

No v1 input, output, error code, grant method, strict `ExecutionContext` shape,
registry or artifact digest changes in this RFC. A separate authenticated
version must define its contract, context and HTTP/SDK/MCP parity explicitly;
do not label new semantics an optional v1 field. Existing v1 clients retain the
same per-booking requirement and four-tool discovery.

Rollout under the accepted foundation (not yet implemented):

1. Record the accepted ADR and exact decisions. Complete and review the
   issuer/credential lifecycle, privacy matrix, strict public/internal contracts
   and SQL lock plan before implementing new delegated paths. ADR 0003 records
   which decisions are accepted and which specifications remain outstanding.
2. Add forward migrations, role/grant tests, generated types and a compatible
   verifier with delegated writes disabled. Do not infer feature availability
   from the presence of tables or type names.
3. Prove anonymous v1 regression behavior and the adversarial new contract on
   fresh databases; prove old/new version coexistence and unknown-version denial.
4. Enable only the reviewed synthetic local single-mandate slice after the full
   exact-candidate pipeline and explicit design/enablement review. Public
   release, deployment and production/customer data need their own approval.

Rollback disables new delegated first writes, revokes outstanding mandates and
blocks issuance before removing any path. Preserve committed bookings, minimal
authorized replay and audit evidence, and existing host cancellation. Do not
delete authority tables while old workers can still write; incompatible workers
must fail closed or be stopped. Prefer a tested forward repair over destructive
downgrade. Reverting a code commit cannot undo a booking or restore revoked
authority. Restoring v1 does not relabel delegated requests as anonymous.

## Alternatives and tradeoffs

| Alternative | Benefit | Why not the first recommendation |
| --- | --- | --- |
| Keep exact browser grants only | Smallest attack surface; works today. | Does not enable bounded no-click booking; remains a valid choice if D1 is rejected. |
| Client `confirmed`/scope/identity assertions | Superficially simple integration. | No trustworthy authority, revocation or principal binding; contradicts ADR 0001. |
| Offline signed transferable mandates | Portable verification and fewer lookups. | Signature/expiry alone do not prove current revocation or budget; a separate issuer/key/disclosure design is needed. |
| Remote authority service or Cloud-only policy | Centralized operations. | Adds freshness/outage/trust problems and can undermine self-hostable correctness. |
| Both principals' independent mandates in the first slice | Direct route to the long-term proof. | Larger initial identity, review and interaction surface; choose explicitly rather than claiming a guest mandate proves it. |
| Core-owned records with lock-time validation | Durable revocation, bounded consumption and one scheduling authority. | Recommended, with new identity lifecycle, locking, privacy and recovery costs; still requires review and adversarial proof. |

## Residual risks and costs

A stolen valid actor credential can exercise the authority actually granted
until revocation; registration is not proof that a process is uncompromised.
The narrow budget, resource/window bounds and durable revocation limit exposure
but do not prove natural-person identity, email ownership or user understanding.
The issuance and step-up UI must present exact effects accessibly; a misleading
review can still produce an intentionally recorded but unwanted policy.

Credential lifecycle, extra lock contention, private policy records, deletion
and recovery add operator responsibilities. Compromised server credentials or
an untrusted local MCP host remain privileged threats. These are reasons to
keep the initial slice narrow and obtain design review, not evidence that this
proposal is production-ready. No expiry limit substitutes for revocation tests.

## Evidence required after acceptance

The following remain planned proof obligations, not implemented tests or
completed results. The foundation is accepted; define the concrete reviewed
model before implementing #17's generators and preserve failing seeds. Do not
invent mandate behavior from the test issue.

| Boundary | Required observation |
| --- | --- |
| Scope and identity | Wrong owner/type/action/actor/subject/audience, unknown fields and forged metadata never produce a booking or leak policy. |
| Expiry | Refuse before not-before and at/after expiry, including expiry while waiting on each blocking lock. Scheduling notice uses fresh lock-time time. |
| Revocation | Explicitly race commit against mandate and credential revocation; result matches the durable serialization order and acknowledged revocation fence. |
| Usage and retries | One mandate with different keys/intents/transports has at most one first commit; identical eligible retries return the original result without consuming again. |
| Stale state | Scope/revision/summary/schedule changes require new review/preparation; browser approval never overrides a conflict or revocation. |
| Step-up | Correct principal, exact differences and action binding; missing/failed/other-principal approval cannot commit. Test refusal rather than only successful UI. |
| RLS and failures | Anonymous/issuer/actor/other/host role matrix, direct RPC denial, atomic audit/usage rollback, timeouts, unavailable provider and safe retry behavior. |
| Privacy and lifecycle | Allowlisted output/audit, redaction, retention/deletion and recovery invalidation; no raw credentials, prompts or guest fields in logs. |
| Compatibility | Existing v1 contract digest, four-tool discovery, browser flow, cancellation and all regressions remain valid; new version has shared parity vectors. |

Use lowest-level unit/property tests for policies; pgTAP and independent-client
transactions for authority/roles/races; contract/parity tests across every new
adapter; browser/Axe checks for issuance, revocation and step-up. Full CI remains
mandatory at each candidate head. None of those results is production readiness.

#18 remains one epic until the accepted authority foundation is implemented
and proven. A future proof needs genuinely independent host and guest authority;
this RFC neither designs a negotiation/federation protocol nor creates its
implementation subtasks. Calendar, notifications, guest cancellation/rescheduling,
remote MCP, arbitrary CRUD, recursive delegation, AI interpretation, pricing,
Cloud deployment and customer traffic are explicit non-goals of this RFC.
