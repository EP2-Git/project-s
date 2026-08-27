# Project S product direction and public-claims contract

Status: maintainer-approved direction for the public Core pre-alpha and selected
hosted-homepage candidate. This document separates repository-backed behavior
from future product direction; it is not a deployment or Cloud availability
announcement.

## North star

**People define authority. Agents act within it. Project S commits.**

Project S is open-source under Apache-2.0. Its long-term product goal is an
authority-bounded agent-to-agent booking
platform with an optional managed Project S Cloud. A person's software agent should
be able to coordinate with another person's host-side agent, but neither agent
becomes the scheduling authority. Project S independently verifies the intersecting
intent, policy, availability, and authority before committing at most one durable
result for an idempotency identity.

The primary user is a developer building an agent or agent-enabled product that
needs authority-bounded real-world scheduling. Their core job is to let independently
authorized human or software clients coordinate a booking without trusting a
model, transport, or counterparty to decide what is allowed.

## Current promise

Core `0.1.0-prealpha` provides human booking and host controls plus one typed
public-booking contract used by the web UI, HTTP API, TypeScript SDK, and local
stdio MCP server. An agent can discover availability and prepare an exact booking
intent. It cannot turn an assertion such as `approved: true` into authority. A
person reviews the prepared intent in the browser and explicitly confirms it.
Project S then rechecks fresh time, policy, availability, preparation, confirmation,
and relevant revisions under the authoritative owner-scoped database lock before
it commits. Exact retries return the immutable original result rather than a
duplicate, and the authenticated host can cancel through the implemented contract.

The synthetic local [Authority Boundary Demo](../authority-boundary-demo.md)
proves that flow. It does not prove production deployment security, natural-person
identity, email ownership, provider integrations, or autonomous agent authority.

## Long-term promise

The intended platform adds bilateral host and guest agents, principal-issued
standing or time-limited mandates, remote MCP, and eventually Project S-to-Project S
federation. Within the intersection of both principals' valid mandates and live
scheduling policy, a booking may complete without a per-booking click. Outside
that intersection, Project S requires human step-up or refuses the action.

These are future directions, not current contracts or generally available
features. The existing browser confirmation remains the first authority provider,
the default for today's anonymous public flow, and a permanent step-up path. It
may be replaced for a particular action only by another verifiable authority
provider—not by a client boolean, model statement, opaque-token possession alone,
or unprotected public mutation.

## Permanent kernel and removable adapters

The following properties remain part of Project S's deterministic scheduling and
authority kernel regardless of interface or deployment model:

- typed intent and versioned contracts;
- verifiable, action-bound authority evidence;
- fresh lock-time checks of authority, policy, availability, conflicts, and
  relevant versions;
- timezone, scheduling-window, duration, buffer, notice, horizon, and overlap
  enforcement;
- duplicate-safe idempotent creation with at-most-one durable booking and
  immutable exact replay;
- explicit conflict/version handling; and
- a privacy-bounded audit receipt.

The web UI, host dashboard, browser confirmation provider, HTTP adapter,
TypeScript SDK, MCP transport, notification providers, model-assisted
negotiation, and eventual federation transport are adapters. Operators may add,
replace, or omit adapters without bypassing the kernel.

## Authority policy

1. A principal defines what may be delegated and for how long.
2. A client presents a typed intent and authority evidence; it does not declare
   itself authorized.
3. Project S validates evidence against the exact action, actor, scope, context,
   expiry, policy, and current revisions.
4. Project S rechecks the scheduling facts and authority under the database lock.
5. Project S commits at most one valid result and returns an immutable replay for an
   exact retry.
6. Missing, stale, mismatched, consumed, or insufficient authority causes refusal
   or human step-up.

Agent capability and agent authority are deliberately different: a client may be
capable of discovering, preparing, or proposing an action while remaining unable
to commit it.

## Public claims ledger

| Claim | Public status | Evidence or constraint |
| --- | --- | --- |
| Human booking and authenticated host controls | Core pre-alpha | Application routes and RLS-protected host data. |
| UI, HTTP, TypeScript SDK, and MCP share one typed public-booking contract | Core pre-alpha | [ADR 0001](../adr/0001-agent-native-public-booking-boundary.md) and parity tests. |
| Agents can discover slots and prepare a booking | Core pre-alpha | Four-operation v1 wire contract; no stability guarantee. |
| A booking is blocked until valid human confirmation exists | Core pre-alpha | Browser confirmation and Authority Boundary Demo. |
| Locked deterministic commit, exact replay, and host cancellation | Core pre-alpha | Database/application tests and demo evidence. |
| Apache-2.0 Project S Core source | Public pre-alpha | `LICENSE`, package metadata, provenance, and publication evidence. Not a supported release. |
| Bilateral guest and host agents | Future direction | No current bilateral-agent contract or demo. |
| Standing or time-limited mandates and no-click execution inside a mandate | Future direction | No current delegation/mandate authority provider. |
| Remote MCP and Project S-to-Project S federation | Future direction | Current MCP transport is local stdio only. |
| Managed Project S Cloud | Planned operating model | Not represented as generally available; no pricing or signup claim. |

## Operating choices

The product direction supports two operating choices backed by the same kernel:

- **Self-hosted Project S:** inspect and operate the complete scheduling system
  yourself under Apache-2.0, while accepting the pre-alpha support and maturity
  limits.
- **Managed Project S Cloud:** Project S operates that system as a convenience when the
  service becomes available.

Cloud may sell operations, upgrades, monitoring, and convenience. Correctness and
authority guarantees must not depend on proprietary cloud-only logic.

Project S Core runs at an operator-chosen origin. It does not require a
Project S-owned domain, a shared Google OAuth client, or any other
Project S-operated provider credential. Any legacy Google OAuth surface is
outside Core and must not be presented as Project S Cloud identity, onboarding,
or Calendar infrastructure. Calling that surface test/demo-only does not itself
restrict access; a future Cloud release must enforce its own operating boundary.

## Anti-goals

Project S is not pursuing generic AI spectacle, model-controlled writes, a broad
feature-parity race, or an all-in-one payments, CRM, video, team-routing, and
provider-marketplace bundle. Calendar sync, outbound notifications, AI booking
chat, remote MCP, federation, mandates, pricing, uptime, and hosted-service
availability must not be implied unless their own implementation and release
gates have been met.

## Claim gates

### “First” gate

Do not publish “first,” “only,” or equivalent category-leadership claims until a
maintainer records dated prior-art research, scope, sources, and approval. The
selected homepage must contain no such claim.

### Cloud gate

Cloud Preview 0.1 is the active private staging milestone described in
[`docs/cloud-preview-0.1.md`](../cloud-preview-0.1.md). Until a maintainer has
approved service readiness, legal terms, privacy terms,
security evidence, operating ownership, support expectations, and an actual
availability state, public copy may say only that managed Project S Cloud is a
planned operating model or will be available in the future. It must not offer
pricing, signup, a waitlist, uptime, production readiness, or an active service.

### Current-versus-future gate

Every future capability must be labeled where it appears, not only in a footnote.
Current proof and future direction must remain understandable with motion disabled
and without relying on color alone. Calls to action must resolve to real local
routes or repository documents; the candidate must not invent a repository URL,
remote-agent demo, Cloud console, signup, or waitlist.
