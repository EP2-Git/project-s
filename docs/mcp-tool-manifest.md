# MCP v1 tool manifest

Project S exposes exactly four MCP v1 tools. The order below is deterministic and is also the user journey. Tool names are transport identifiers; the canonical application operation IDs remain in `@project-s/contracts`.

| Tool | Input | Purpose | Side effect |
| --- | --- | --- | --- |
| `project_s_get_booking_page_v1` | `username` | Return the public profile, active meeting types, and public scheduling policy. | None |
| `project_s_list_free_slots_v1` | `username`, `meetingTypeId`, `date`, `displayTimeZone` | Return presently available slots for one public meeting type and local date. | None |
| `project_s_prepare_booking_v1` | `username`, `meetingTypeId`, `startAt`, `guestTimeZone`, `booker` | Derive an exact booking preview and short-lived browser confirmation step. Does not hold the slot. | Records a preparation subject to server abuse controls. |
| `project_s_create_booking_v1` | `preparationToken`, `idempotencyKey` | Commit a previously prepared booking after server-recorded human approval. | Creates one booking, idempotently. |

`booker` contains `name`, `email`, and optional `notes`. It is accepted only by prepare. Create deliberately cannot accept the username, owner, meeting type, times, duration, buffers, guest identity, actor identity, scopes, or a confirmation boolean. Those values are bound to the prepared intent or derived by the server.

## Contract rules

- Every input object is strict (`additionalProperties: false`). Unknown fields fail before the SDK is called.
- Inputs and outputs come from the same contract registry used for HTTP/OpenAPI and the TypeScript SDK.
- Success is `{ contractVersion: 1, requestId, data }`.
- Failure is `{ contractVersion: 1, requestId, error }`, where `error` is the canonical Project S problem.
- MCP sets `isError: true` for application failures and reserves JSON-RPC errors for malformed protocol requests, unsupported versions, unknown methods, and invalid tool-call envelopes.
- Unstructured text contains only status, operation or stable error code, and request ID. The structured prepare preview repeats the submitted booker fields so the human can review the exact intent; no other result echoes guest PII.
- Tool annotations are copied from the contract registry. They are descriptive hints, never authorization or confirmation evidence.

## Canonical public problem codes

The shared problem registry covers validation, invalid time zones, missing or inactive meeting types, unavailable slots, booking-window limits, authentication/authorization/scope failures, confirmation requirements, expired/mismatched/stale preparations, idempotency conflicts, rate limits, version conflicts, and internal failures.

Public problem details and alternatives must not reveal a host's bookings, overrides, buffer rules, busy intervals, owner IDs, or provider state. A maximum of three public alternatives may be returned by the API contract.

## Deliberately absent tools

Version 1 does not expose owner schedule changes, owner booking lists, guest lookup, cancellation, rescheduling, arbitrary database access, prompts, resources, sampling, elicitation, tasks, MCP Apps, or administrative operations. Adding a fifth tool requires a new reviewed contract and release gate; it must not appear conditionally or as an undocumented experiment.

Reference: [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).
