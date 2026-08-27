# Human, API, SDK, and MCP parity contract

Project S defines parity at the application-operation boundary, not as identical transport syntax. The React UI, HTTP API, TypeScript SDK, and MCP tools all invoke the same use cases and receive the same contract-versioned success or problem semantics. PostgreSQL remains authoritative for availability and booking integrity.

| Application operation | HTTP | SDK | MCP |
| --- | --- | --- | --- |
| Get public booking page | `GET /api/v1/public/booking-pages/{username}` | `public.getBookingPage` | `project_s_get_booking_page_v1` |
| List free slots | `POST /api/v1/public/free-slots/search` | `public.listFreeSlots` | `project_s_list_free_slots_v1` |
| Prepare booking | `POST /api/v1/public/bookings/prepare` | `public.prepareBooking` | `project_s_prepare_booking_v1` |
| Create booking | `POST /api/v1/public/bookings` | `public.createBooking` | `project_s_create_booking_v1` |

The current database RPC names are private adapter details, not an ecosystem ABI. Stable UI code and MCP code must not import Supabase or call RPCs directly.

## Single-source contracts

`@project-s/contracts` owns operation IDs, v1 Zod validation, JSON Schema 2020-12, HTTP metadata, MCP metadata, the problem registry, and generated OpenAPI/MCP artifacts. The SDK retains the full `{ contractVersion, requestId, data }` envelope. MCP error results wrap the same canonical problem in `{ contractVersion, requestId, error }` and set `isError: true`.

Contract drift is a release failure. Generated artifacts must be deterministic and CI must reject changes that are not reviewed as versioned compatibility changes.

## Semantic parity requirements

- Identical validation rules and unknown-field rejection.
- Identical normalization for username, date, instant, time zone, UUID, and booker fields.
- Identical public success data, problem codes, retry guidance, and bounded alternatives.
- One idempotency and confirmation domain across transports.
- One rate-limit/abuse operation identity across transports.
- One authority path for locking, fresh-state re-read, availability recomputation, and insertion.
- No transport-only capability or undocumented bypass.

## Current automated baseline

`npm run test:parity` runs one shared four-operation vector set through the
application handler, SDK HTTP serialization, and the real MCP adapter. It
proves normalized valid inputs and outputs, strict unknown-field rejection,
canonical success/problem envelopes, HTTP method/path/body/media metadata, and
PII-safe MCP text. The SDK HTTP leg uses a deterministic mocked `fetch`; it does
not claim to exercise the deployed Edge router.

Live evidence is intentionally separate: `npm run test:agent-flow` exercises
the stdio MCP client through the real local Edge/DB authority, Playwright covers
the browser through that authority, and pgTAP/concurrency tests cover the
database's locking and replay behavior.

## Remaining release parity evidence

Before release, the shared golden vectors must also run through the actual Edge
HTTP router. Normalize only transport mechanics such as headers and MCP text;
request IDs may be replaced with a sentinel for comparison.

The complete release matrix must cover:

- Every operation's valid and invalid shapes, including unknown keys.
- Time zones, DST gaps/folds, notice/horizon limits, and stale availability.
- Prepare tampering, expiry, missing approval, replay, every authority-changing field, and browser binding.
- Idempotency replay and mismatched-key reuse across transport combinations.
- A 50-way cross-transport UI/API/MCP collision yielding exactly one booking
  and one stored row, with every response in the documented success/conflict
  set.
- Actor/scope/delegation matrices and abuse-control failure behavior.
- PII absence in logs, audit-forbidden fields, MCP text, and public problems.
- Official MCP conformance requirements set `2026-07-28` with no unexplained baseline.

The existing golden baseline, unit, pgTAP, race, live agent-flow, and Playwright
suites must remain green while this evidence is added. Focused MCP tests are
additive and do not replace official conformance.
