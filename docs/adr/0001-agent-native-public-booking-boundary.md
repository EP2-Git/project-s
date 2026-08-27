# ADR 0001: Agent-native public booking boundary

- Status: Accepted
- Date: 2026-08-19
- Decision owners: Project S maintainers
- Applies to: public booking UI, HTTP API, TypeScript SDK, and MCP server

Pre-release namespace note: on 2026-08-25 the unpublished local candidate reset
its technical names to Project S before any supported public release. The
operation count, schemas, authority boundary, confirmation requirement, locked
commit, replay semantics, and cancellation permissions did not change. The v1
compatibility commitment below begins only with a future maintainer-approved
supported release, not the public pre-alpha.

## Context

Project S's first public booking flow called versioned Postgres RPCs directly from the browser. PostgreSQL correctly remained the scheduling authority, but RPC names and database-shaped DTOs would become an accidental public ABI if each new client integrated with them independently. That would also let a transport bypass confirmation, authorization, abuse controls, provenance, or error normalization implemented by another transport.

Project S needs human, API, SDK, and agent clients to express the same booking intent and receive the same result without duplicating scheduling authority. Agent access adds one non-negotiable condition: a model assertion such as `confirmed: true` cannot represent human approval.

## Decision

Project S contract version 1 has exactly four versioned public-booking operations:

1. `project-s.public.get_booking_page.v1`
2. `project-s.public.list_free_slots.v1`
3. `project-s.public.prepare_booking.v1`
4. `project-s.public.create_booking.v1`

Their canonical schemas, operation IDs, scopes, HTTP routes, MCP tool names, reason codes, and generated artifacts live in `packages/contracts`. UI, HTTP, SDK, and MCP adapters must call the same application use cases. Only the authority adapter may call private/versioned database RPCs.

The current transport mapping is:

| Operation | HTTP | SDK | MCP tool |
| --- | --- | --- | --- |
| Get booking page | `GET /api/v1/public/booking-pages/{username}` | `public.getBookingPage` | `project_s_get_booking_page_v1` |
| List free slots | `POST /api/v1/public/free-slots/search` | `public.listFreeSlots` | `project_s_list_free_slots_v1` |
| Prepare booking | `POST /api/v1/public/bookings/prepare` | `public.prepareBooking` | `project_s_prepare_booking_v1` |
| Create booking | `POST /api/v1/public/bookings` | `public.createBooking` | `project_s_create_booking_v1` |

Every success is `{ contractVersion: 1, requestId, data }`. Every application failure is the canonical, versioned `ProjectSProblemEnvelope`; HTTP renders it as `application/problem+json`, the SDK throws `ProjectSApiError`, and MCP returns the same structured problem with `isError: true`. Malformed JSON-RPC remains an MCP protocol error.

Inputs and outputs are strict objects. Callers cannot supply owner IDs, actor identity, subjects, delegation, scopes, `onBehalfOf`, end times, duration, buffers, or a confirmation boolean. Public responses do not expose booking/owner UUIDs, busy intervals, raw availability rules, provider state, or database details.

The gateway derives an `ExecutionContext` containing actor kind, transport, verified principal/subject, scopes, limited provenance, and an optional server-verified confirmation grant. It is an internal application input and is never accepted from a public request body.

`prepare_booking` validates and derives an exact summary, but it does not reserve the slot. `create_booking` accepts only an opaque preparation token and an idempotency key. It succeeds only after the server has recorded human confirmation and the authority has revalidated the prepared intent under the owner scheduling lock. A client boolean, MCP annotation, model message, or token possession alone is not confirmation.

PostgreSQL remains authoritative for fresh-clock checks, owner-scoped locking, schedule/type re-reads, exclusion constraints, and idempotent insertion. Current database RPC names are implementation details, not ecosystem contracts.

## Versioning policy

Version 1 rejects unknown fields in inputs, outputs, envelopes, problems, and authority context. Any field addition or removal, semantic change, or reason-code change requires a new contract version and a migration window; old strict SDKs must never be told that a response addition is compatible. Non-schema documentation can be clarified within v1. Generated JSON Schema, OpenAPI, and MCP artifacts are deterministic and protected by an intentional drift digest.

## Release gates

- Contracts and parity vectors must exist before a transport ships.
- The create tool cannot ship until server-recorded confirmation, locked revalidation/commit, one-use grants, audit, and abuse controls are in place.
- Anonymous direct database create execution must be revoked only after the gateway path is verified end to end.
- One golden vector suite must pass through application, HTTP, SDK/UI, and MCP adapters.
- Official MCP conformance for revision `2026-07-28` is a supported-release gate;
  it is not claimed by the public pre-alpha.

## Consequences

The boundary adds an application gateway and buildable workspace packages. In exchange, the UI ceases to define a privileged path, MCP never receives database credentials, errors become stable and privacy-bounded, and future owner/delegated operations can use the same authorization model without widening v1.

Remote Streamable HTTP MCP and OAuth are deferred. Local stdio is the v1 transport. Owner/admin/schedule tools, guest lookup/cancel/reschedule, arbitrary CRUD/SQL, autonomous confirmation, holds, LLM parsing, hosted control planes, and optional MCP features are not part of this decision.
