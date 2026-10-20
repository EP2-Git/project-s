# ADR 0003: Authority providers and bounded mandates

- **Status:** Accepted foundation and D1-D5; implementation and enablement gated
- **Date:** 2026-10-19
- **Owner:** Ethan Patten, lead maintainer
- **Issue / RFC:** [#16](https://github.com/EP2-Git/project-s/issues/16),
  [PR #41](https://github.com/EP2-Git/project-s/pull/41),
  [authority-provider RFC](../rfcs/authority-provider-bounded-mandates.md)
- **Reviewed revision:** `543e38a61c07f77f8454af0355222bf2ac00c177`
- **Supersedes:** None. [ADR 0001](0001-agent-native-public-booking-boundary.md)
  continues to define the unchanged public v1 contract.

## Context and decision authority

Current v1 creates a booking only after exact server-recorded browser approval
and locked PostgreSQL revalidation. Reserved delegated-agent fields are not an
issuer, a credential verifier or a mandate policy. The next capability needs
bounded, revocable authority without moving scheduling truth out of Core.

On 2026-10-19 Ethan explicitly stated that he had reviewed authority design
PR #41 and instructed Codex to follow its recommended path. This accepts the
reviewed RFC's foundation and recommendations D1-D5. It is maintainer review
recorded from that user-triggered instruction, not a GitHub approval review,
independent security assessment or inference from passing CI. No claim is made
that Ethan personally ran the tests.

The RFC deliberately does not define concrete credential/control contracts,
retention periods or SQL operations. Those missing specifications are not
silently accepted by this decision; the gates below remain binding.

## Decision

| Decision | Accepted path |
| --- | --- |
| D1: First slice | Guest-side authority for at most one successful booking against one already-public host meeting type. The host's published policy remains its invitation policy; this is not independent host-agent authorization. |
| D2: Identity and issuer | A verified operator-local principal explicitly issues authority to one separately registered, independently revocable agent credential. Verify the credential-to-principal/subject binding server-side. Guest email, headers and model/client names are not identity evidence. |
| D3: Scope and lifetime | Bind one exact host/type, a fixed UTC interval containing the whole derived meeting, a maximum derived duration and one successful first commit. Use finite permission not-before/expiry distinct from meeting bounds, with an initial 24-hour permission-lifetime ceiling. Bind a principal-owned reviewed booker-profile revision; initial delegated notes are empty. |
| D4: Step-up and replay | Outside bounds, require new exact approval by the relevant verified principal. Mandate revocation/expiry denies new writes but does not erase an eligible original caller's committed receipt. Receipt access requires original verified caller/audience binding and an active credential; credential revocation denies it. Preserve v1 cancellation/replay behavior. |
| D5: Compatibility and rollout | Use a separate strict authenticated contract/context and additive migrations. Keep v1 inputs, outputs, codes, context, four-tool discovery and browser flow unchanged. Delegation starts disabled; enabling it needs the reviewed implementation and full pipeline. |

A Core authority provider resolves typed evidence references, step-up or denial.
It cannot grant a booking by returning a boolean. Unknown providers, unsupported
versions, unavailable verification and ambiguous identity fail closed, without
weaker-provider fallback. Evidence, intent, caller and current scheduling facts
must be revalidated in the same authoritative transaction.

## Authority, database and privacy constraints

PostgreSQL keeps deterministic scheduling, fresh time checks after blocking
locks, scope/revision/credential validation, revocation fencing, at-most-one
first commit, evidence consumption and authoritative success audit atomic.
Refusals/conflicts/rollbacks consume no use. Do not add a mandate lock ahead of
the current function without reviewing the complete old/new lock graph.
No human prompt or remote authority callback may hold a scheduling transaction.

Exact eligible retry and a first write are distinct. A revoked/exhausted-policy
preflight must not prevent the kernel from identifying an authorized original
committed retry or reveal another caller's receipt. The new contract's precise
cancelled-booking/replay behavior still needs specification and parity vectors.

New tables are private and default-deny. Principals may control only their own
mandates; actors may exercise only the bound action, without issuer or host
privilege. Service-role credentials remain a server trust boundary. No raw
credential, capability URL, idempotency key, prompt, request body or booker PII
may enter authority audit/logs. Access-controlled references and keyed digests
remain sensitive linked data, not anonymization.

Retention/deletion must preserve revocation/usage fences while stale evidence
can still authorize a write and retain only minimum authorized replay data.
No retention duration or legal-consent claim is established here. Recovery must
not revive revoked authority; keep delegated writes disabled until the reviewed
invalidation/rotation procedure has run. Preserve committed booking history.

## Required implementation design before new delegated paths

The next coherent unit is a concrete implementation-design supplement, not an
attempt to enable every reserved delegated field. It must specify and review:

1. Local principal authentication and object authorization; registered actor
   credential issuance, storage, verification, rotation and revocation; exact
   instance/audience binding and the reviewed booker-profile lifecycle.
2. Strict authenticated operation/context/evidence schemas and HTTP/SDK/MCP
   parity; issuer/actor/subject roles; denial/step-up problems; eligible retry,
   credential revocation and cancelled-booking receipt semantics. Do not widen v1.
3. A complete lock order across existing preparation/grant/booking/owner/schedule
   and cleanup paths and new credential/mandate/idempotency state. Show fresh
   post-lock checks, commit-versus-revoke ordering, usage/audit rollback and
   bounded same-identity retries. Document role/grant and generated-type impact.
4. An operator-reviewed retention/deletion matrix for policies, revocation
   tombstones, credential bindings, audit and replay; recovery invalidation and
   synthetic rehearsal; minimum private output/audit fields.

The supplement may turn these requirements into reviewable recommendations.
It must not represent unspecified contracts or privacy policy as approved by
this ADR. Existing maintenance permission to push and merge is not an exception
to those design gates.

## Migration, verification and rollback

After that review, add forward migrations and a compatible verifier with
delegated writes disabled. Prove anonymous/issuer/actor/other/host grants,
direct-RPC denial, scope/identity/expiry/revocation/step-up/refusal/privacy,
at-most-one commit, stale state, audit rollback and transport parity. Include
expiry during each blocking wait and explicit credential/mandate revoke races;
preserve minimized failing property-test seeds under #17.

The complete exact-candidate pipeline must pass, including existing v1 browser,
contract digest, four-tool discovery, cancellation and concurrency regressions.
Only then may an explicitly reviewed enablement expose the narrow synthetic
local slice. Design acceptance and existing-software CI are not tests of an
unimplemented mandate. No deployment, release, production data or support
commitment is approved here.

Rollback disables delegated first writes and issuance, revokes outstanding
authority and preserves bookings/minimum replay/audit. Stop incompatible workers
or fail them closed before removing a path; do not destructively remove fences
while old workers can write. Prefer forward repair. Reverting code cannot undo
bookings or restore revoked authority. Preserve v1 and host cancellation.

## Alternatives and consequences

Per-booking-only authority remains the safe current behavior but cannot deliver
delegation. Model assertions, token possession or transferable offline evidence
cannot establish live principal binding/revocation/budget. Cloud-only policy
would undermine Core self-hostability. Starting with both principals' mandates
adds unnecessary scope before the guest-side foundation is proven.

Core-owned records and lock-time validation are the accepted direction, with
credential, privacy, recovery and contention costs. A stolen active credential
can exercise its actual bounded grant until revocation; this is not proof of
natural-person identity, email ownership or user comprehension. #18 remains a
separate bilateral proof after implementation. Calendar, notifications, guest
cancellation/rescheduling, remote MCP, federation, recursive delegation, AI
interpretation and Cloud deployment are outside this decision.
