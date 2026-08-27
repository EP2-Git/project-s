# Public API v1 boundary

Project S defines four public booking application operations. The React UI,
TypeScript SDK, and MCP adapter use these same contracts; none may call Supabase
scheduling RPCs directly.

| Operation ID | Scope | HTTP | SDK | MCP |
| --- | --- | --- | --- | --- |
| `project-s.public.get_booking_page.v1` | `booking_page:read` | `GET /api/v1/public/booking-pages/{username}` | `public.getBookingPage` | `project_s_get_booking_page_v1` |
| `project-s.public.list_free_slots.v1` | `slots:read` | `POST /api/v1/public/free-slots/search` | `public.listFreeSlots` | `project_s_list_free_slots_v1` |
| `project-s.public.prepare_booking.v1` | `bookings:prepare` | `POST /api/v1/public/bookings/prepare` | `public.prepareBooking` | `project_s_prepare_booking_v1` |
| `project-s.public.create_booking.v1` | `bookings:create` | `POST /api/v1/public/bookings` | `public.createBooking` | `project_s_create_booking_v1` |

All input objects are strict. List takes `username`, `meetingTypeId`, local
`date`, and `displayTimeZone`. Prepare takes `username`, `meetingTypeId`,
`startAt`, `guestTimeZone`, and `booker` (`name`, `email`, optional `notes`).
Create deliberately takes only the opaque `preparationToken` and a UUID
`idempotencyKey`. It cannot accept owner IDs, an end time, duration, policy,
guest identity, scopes, actor identity, or a confirmation boolean.

Successful HTTP responses use
`application/vnd.project-s.v1+json` and the envelope:

```json
{ "contractVersion": 1, "requestId": "<uuid>", "data": {} }
```

HTTP failures use a direct RFC problem document with
`application/problem+json`, stable Project S code, request ID, and only safe retry
guidance/alternatives. HTTP create returns `201`; the other three operations
return `200`. Responses are `Cache-Control: no-store`.

## Confirmation support routes

The Project S browser uses two narrow gateway routes:

- `POST /api/v1/public/booking-preparations/preview`
- `POST /api/v1/public/booking-preparations/confirm`

They let a human open the fragment-carried preparation, review the exact
server-derived summary, complete the configured challenge, and record a one-use
grant. They are not fifth/sixth application operations, SDK methods, or MCP tools.
Prepare does not reserve a slot. Create always rechecks the grant, current
scheduling authority, and availability at commit.

Both support routes are strict, rate-limited, and gateway-audited before body or
database work. Preview uses the prepare operation's policy and scope; confirmation
uses the create operation's policy and scope. This keeps them outside the public
four-operation ecosystem contract without creating an unmetered browser bypass.

## Gateway invariants

- The Edge Function validates a scoped execution context and HMACed provenance.
- A persisted rate-limit decision runs before scheduling authority for every
  public operation and both browser confirmation support routes.
- The public gateway is anonymous by design (`verify_jwt = false`); authority
  comes from strict operation scope, server-side controls, confirmation, and the
  database—not from trusting caller metadata.
- Gateway/prepare/confirm/commit RPCs are service-role-only. Browser, SDK, and MCP
  processes never receive that credential.
- The agent-native migration retires anonymous/authenticated execution of the
  legacy public booking RPCs; each deployment must verify those effective grants
  or callers can bypass the gateway.
- The MCP adapter calls this HTTP API through `@project-s/sdk`; it does not import
  Supabase or connect to PostgreSQL.

For deployment routing and secrets, see [self-hosting.md](self-hosting.md). For
the state transition and token handling, see
[agent-confirmation-flow.md](agent-confirmation-flow.md).
