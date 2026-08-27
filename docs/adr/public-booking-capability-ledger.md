# Public booking capability ledger

This ledger is the review surface for v1 human/API/agent parity. A capability is stable only when every required column is green against the same contract vector. Database RPCs are authority-adapter details and never count as a public client surface.

| Capability | Contract ID | Required scope | HTTP | SDK | MCP | Safety gate |
| --- | --- | --- | --- | --- | --- | --- |
| Discover booking page and meeting constraints | `project-s.public.get_booking_page.v1` | `booking_page:read` | `GET /api/v1/public/booking-pages/{username}` | `public.getBookingPage` | `project_s_get_booking_page_v1` | Strict public DTO; no owner or raw schedule state |
| Search current free slots | `project-s.public.list_free_slots.v1` | `slots:read` | `POST /api/v1/public/free-slots/search` | `public.listFreeSlots` | `project_s_list_free_slots_v1` | Fresh authority result; no busy interval disclosure |
| Validate and preview booking intent | `project-s.public.prepare_booking.v1` | `bookings:prepare` | `POST /api/v1/public/bookings/prepare` | `public.prepareBooking` | `project_s_prepare_booking_v1` | Short expiry; opaque token; no hold; browser confirmation URL |
| Commit a reviewed booking | `project-s.public.create_booking.v1` | `bookings:create` | `POST /api/v1/public/bookings` | `public.createBooking` | `project_s_create_booking_v1` | Server-recorded confirmation; locked revalidation; idempotency; audit; abuse controls |

## Contract foundation status

| Foundation item | Source of truth | Gate evidence |
| --- | --- | --- |
| Strict runtime and inferred TypeScript DTOs | `packages/contracts/src/operations.ts` | Contract and privacy-boundary tests |
| Canonical problems and reason codes | `packages/contracts/src/common.ts` | Strict parsing, bounded alternatives, no private/provider fields |
| Server-derived execution context and four public scopes | `packages/contracts/src/common.ts` | Unknown-field and duplicate-scope rejection |
| Operation/HTTP/MCP registry | `packages/contracts/src/registry.ts` | Exactly-four registry assertion |
| JSON Schema 2020-12, OpenAPI 3.1, MCP manifest | `packages/contracts/src/artifacts.ts` | Deterministic artifact drift digest |
| Typed HTTP client and problem normalization | `packages/sdk/src/client.ts` | Path/body/envelope/error/transport tests |

## Explicitly outside v1

The following have no v1 contract, route, SDK method, or MCP tool: owner booking list/get/cancel/reschedule, schedule reads/writes, guest lookup, arbitrary database access, remote MCP/OAuth, autonomous confirmation, slot holds, provider integrations, resources/prompts/sampling/tasks/apps, dynamic client registration, and hosted control-plane features.

Adding an item requires a separate threat analysis, scope, operation ID, strict DTOs, parity vectors, and release decision. It must not be smuggled into an existing v1 input as an optional authority field.
