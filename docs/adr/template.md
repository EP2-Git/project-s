# ADR NNNN: Decision title

- **Status:** Proposed
- **Date:** YYYY-MM-DD
- **Owners:** Maintainer or working group
- **Issue/Discussion:** Link
- **Supersedes:** None

## Context

What problem or constraint requires a durable decision? State current behavior
and why an Issue or pull-request explanation is not enough.

## Decision

Describe the chosen contract and the authority that may make each consequential
decision. Separate deterministic validation from client, model, UI, transport,
or managed-service behavior.

## Authority and security impact

- What new capability exists?
- Who can exercise it, and how is that identity established?
- What is refused before authority exists?
- How do scope, expiry, revocation, replay, audit, and step-up work?
- Which threat-model assumptions change?

## Privacy and data impact

Describe new data, disclosure, retention, deletion, logging, and synthetic-test
requirements. Identify information that must never cross the public boundary.

## Database and RLS impact

Describe migrations, grants, RLS, locks, constraints, transactions, and rollback.
Explain how the database remains authoritative for scheduling truth.

## Public contracts and compatibility

List affected operation IDs, schemas, HTTP routes, SDK methods, MCP tools, error
codes, versioning, and migration expectations. State explicit non-goals.

## Alternatives considered

Record credible alternatives and why they were rejected. Include the option to
make no change.

## Migration and rollback

Explain rollout order, mixed-version behavior, data migration, failure recovery,
and how the decision can be reversed safely.

## Verification

List unit, contract, parity, database, concurrency, browser, accessibility,
security, and manual evidence appropriate to the decision. Do not turn test
counts into production guarantees.

## Consequences

Record benefits, costs, operational burden, unresolved risks, and follow-up
work.
