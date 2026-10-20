# ADR 0004: Bounded-mandate implementation choices

- **Status:** Accepted for implementation; delegated writes and enablement gated
- **Date:** 2026-10-20
- **Owner:** Ethan Patten, lead maintainer
- **Issue / RFC:** [#17](https://github.com/EP2-Git/project-s/issues/17),
  [PR #43](https://github.com/EP2-Git/project-s/pull/43),
  [implementation supplement](../rfcs/bounded-mandate-implementation.md)
- **Reviewed recommendation revision:** `5e162afa0facf59c0c4a13eb0e242b6c42cc3cd7`
- **Supersedes:** None. Complements [ADR 0003](0003-authority-provider-bounded-mandates.md);
  [ADR 0001](0001-agent-native-public-booking-boundary.md) still defines public v1.

## Context and decision authority

ADR 0003 accepted the foundation and D1-D5 but required concrete credential,
contract, privacy and locking recommendations before implementation. PR #43
provided that supplement. After its C1-C4 recommendations were explained in
plain English, Ethan explicitly instructed: "I approve all recommendations."
This user-triggered instruction accepts C1-C4 at the revision identified above.
It resolves that recommendation-review gate; do not ask for the same approval
again merely because implementation has not started.

This records maintainer product/design approval, not a GitHub approval review,
independent security assessment, completed SQL proof or claim that Ethan wrote
the code or ran tests. Material changes beyond these accepted recommendations
still require review through the existing ADR process.

## Decision

| Item | Accepted implementation choice |
| --- | --- |
| C1: Identity and key lifecycle | Verify the existing local account with Supabase Auth. Give each registered agent its own opaque credential, valid at most seven days, and separate bounded booking permission. Replacement revokes the old credential and requires fresh mandates; no overlapping keys or receipt transfer. Reconcile an uncertain previous result before authorizing another booking. |
| C2: Extra approval and retry | Exact principal approval replaces an active unused mandate with one five-minute one-use grant and a new preparation, atomically. The original and replacement cannot both book. Approval does not reserve the slot. Exact eligible retries return the original result; cancellation refuses rather than recreates the booking. Expired approval does not restore the original permission. |
| C3: Synthetic local retention | Use the supplement's bounded synthetic defaults: seven-day credentials/reviewed profiles, ten-minute preparations, five-minute pending review/step-up, 24-hour committed-receipt access and seven-day minimal security audit. Keep minimal expiry/usage/revocation fences until safe to purge. These deadlines do not delete the booking; real-user/Cloud retention requires a separate reviewed operator policy. |
| C4: Ordering and contention | Serialize authority changes per issuing principal, keep new private authority state separate from v1, acquire shared legacy row/owner boundaries without waiting, and use bounded same-identity retry on contention. Recheck live permission, time and availability after locks; commit booking, consumption and authoritative audit together. Prefer correctness over initial throughput. |

The supplement supplies the concrete proposed v2 boundary, state/retention
matrix, recovery invalidation and lock algorithm for implementing these choices.
Preserve its original reviewed semantics; do not widen v1 or treat model claims,
client booleans or possession of an object ID as authority.

## Security, privacy and database impact

Implementation must keep identity, object ownership, permission scope, expiry,
revocation and usage enforceable inside Core. Unknown providers and unavailable
verification fail closed. New private state is default-deny with narrow RPCs;
actor monitoring and issuer controls cannot obtain general table access.
Secrets, prompts and booker PII stay out of minimal audit/public responses.
Restoration invalidates old authority and fences in-flight/old workers before
re-enable; it must not revive revoked authority or erase booking history.

The accepted lock approach is a design to implement and prove, not an exhaustive
proof of PostgreSQL/FK/index/trigger interactions. Preserve live SQL review,
fresh post-wait time checks, direct-RPC denial, rollback, revoke/commit ordering
and mixed v1/v2 concurrency tests. A discovered unsafe wait edge must be repaired
within the accepted semantics or keep enablement blocked; a material semantic
change requires a new decision.

## Compatibility, implementation and verification

Existing v1 schemas, artifact digest, browser confirmation, four MCP tools,
host cancellation and appearance/behavior are unchanged by this documentation.
Implement incrementally on the separate authenticated v2 boundary with delegated
writes disabled. Require strict schemas/parity, identity/scope/expiry/revocation/
step-up/replay/privacy vectors, real database race and rollback evidence,
reviewed forward migrations/grants/types, and affected browser/accessibility
checks. Existing-software CI cannot prove an unimplemented mandate.

The full pipeline must pass on the latest candidate against current main before
merge. Approval does not waive the current dependency audit failure or skipped
browser gate. Explicit reviewed synthetic enablement remains separate after the
implementation proof. Bilateral #18, real-user/Cloud policy, deployment, hosted
infrastructure, calendar/notification integrations and guest lifecycle remain
outside this decision. The new UI/UX direction does not enlarge these permissions.

## Alternatives, consequences and rollback

Overlapping replacement keys and transferred receipts complicate caller binding;
independent old/new step-up budgets risk two bookings; indefinite diagnostic
retention exposes unnecessary data; shared blocking lock acquisition needs a
larger wait-graph proof. The accepted first slice trades convenience and
throughput for bounded authority and an inspectable implementation.

Follow the supplement's staged implementation/proof sequence and ADR 0003's
rollback: disable new writes/issuance, revoke authority, fence old workers and
preserve bookings and required replay/usage records. Do not destructively remove
fences while old code can commit. A code revert cannot undo a booking.
