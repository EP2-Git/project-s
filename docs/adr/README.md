# Architecture decision records

Project S uses ADRs to preserve decisions whose reasoning must survive a pull
request. An RFC/design proposal is the public discussion surface; an accepted
ADR is the durable repository record.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-agent-native-public-booking-boundary.md) | Accepted | Agent-native public booking boundary and database authority. |
| [0002](0002-tailwind-4-build-toolchain.md) | Accepted for implementation | Tailwind 4 build toolchain and browser styling compatibility. |
| [0003](0003-authority-provider-bounded-mandates.md) | Accepted foundation; implementation gated | Authority providers and guest-side bounded mandates; D1-D5 and remaining implementation-design gates. |
| [0004](0004-bounded-mandate-implementation.md) | Accepted for implementation; proof and enablement gated | Concrete C1-C4 credential, step-up, synthetic retention and locking choices. |

The [public booking capability ledger](public-booking-capability-ledger.md)
tracks the current four-operation contract and is reviewed alongside ADR 0001.

## ADR required

Use an ADR/RFC for changes to:

- public contracts or versioning;
- database migrations, grants, RLS, or authority RPCs;
- confirmation, mandate, delegation, revocation, or step-up semantics;
- privacy, retention, or data disclosure boundaries;
- Core/Cloud responsibility;
- compatibility or migration policy; or
- a security assumption shared by multiple components.

A small implementation detail that does not create a durable constraint can be
explained in the Issue and pull request instead.

## Process

1. Open an RFC/design proposal describing the problem, authority and privacy
   impact, alternatives, migration, and rollback.
2. Discuss the contract before implementing consequential behavior.
3. Copy [the template](template.md) to the next numbered file using a concise
   kebab-case title.
4. Submit the ADR with, or before, the implementation pull request.
5. Record `Proposed`, `Accepted`, `Rejected`, `Superseded`, or `Deprecated` and
   link the Issue, Discussion, and replacement decision.

Accepted ADRs are not silently rewritten when a decision changes. Add a new ADR
that supersedes the old one and link both directions.
