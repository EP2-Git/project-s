# Authority Boundary Demo

The Authority Boundary Demo exercises Project S's real local contracts. It is not a
recording, a mocked tool call, or a second scheduling implementation.

The central result is a refusal: after an MCP client prepares a valid booking,
`project_s_create_booking_v1` still returns `CONFIRMATION_REQUIRED`. The MCP create
schema has no `confirmed` flag and the MCP process has no database or service-role
credential. A person must review the server-derived preparation in Project S's
browser flow before the same MCP request can commit.

## Run the guided demo

Prerequisites are Node.js 22.12 or newer, npm 10.9 or newer, Docker Desktop (or a
compatible Docker engine), and a browser that the operating system can open.
Both paths below run `db:reset` and replace data in the repository's local
Supabase stack. Use the disposable local fixture only; neither command targets a
linked or hosted database.

From a clean checkout:

```sh
npm ci
npm run db:start
npm run db:reset
npm run db:env
npm run demo:authority
```

`db:reset` is the deterministic fixture boundary. It rebuilds the migrations and
loads only the fictional `demo-host`, `demo@project-s.local`, the `Intro call`
meeting type, and synthetic dashboard data from `supabase/seed.sql`.

The guided command then:

1. starts a real local Project S HTTP proxy when one is not already running;
2. launches the real stdio MCP server and discovers its four tools;
3. gets the seeded booking page and searches current database-computed slots;
4. prepares a fictional booking and verifies that the preparation is not a hold;
5. calls create before approval and displays the real `CONFIRMATION_REQUIRED`
   result;
6. opens the opaque fragment confirmation URL without printing the capability
   token into the terminal transcript;
7. waits while a person reviews the exact host, meeting, time zones, and guest
   fields and explicitly approves them in the browser;
8. creates the booking through the same MCP tool and exact idempotency key;
9. replays that identical create and verifies the confirmation code is unchanged
   and only one booking exists; and
10. deliberately switches to the seeded host's authenticated authority and calls
    the same version-checked cancellation RPC used by the dashboard.

The cancellation step is not an MCP capability. It is included to make the
authority transition visible: the anonymous agent surface can prepare and commit
an approved public booking, while only the authenticated host contract can cancel
it.

## Capture portfolio evidence

The joined Playwright scenario can write representative desktop and mobile
captures beneath the ignored `test-results/authority-boundary-demo/` directory:

```sh
npm run demo:authority:capture
```

The capture path uses the real MCP subprocess, browser confirmation route,
database commit, exact replay, authenticated dashboard, and cancellation RPC.
It also checks Axe, horizontal overflow, browser console errors, and page errors.
The preparation fragment is removed before any screenshot is taken. Do not move
these generated files into Git without a separate provenance and privacy review.

## What this proves

- Human, browser, HTTP SDK, and MCP clients share one contract-versioned public
  booking boundary and one PostgreSQL scheduling authority.
- An agent may discover public choices and create a non-holding preparation.
- Possessing a preparation token or claiming that a user approved does not grant
  create authority.
- The first commit rechecks the durable confirmation grant, fresh clock, active
  policy, authority revision, summary, and availability under the host lock, then
  inserts under the database exclusion constraint.
- An identical retry returns the immutable committed result instead of inserting
  another booking.
- Cancellation requires a separate authenticated host authority and optimistic
  booking version.

This differs from simply exposing a scheduling API because transports do not get
to choose their own authority facts. They cannot supply the owner, duration, end
time, scopes, actor identity, or confirmation. The gateway derives context and
PostgreSQL makes the final transactional decision.

## What this does not prove

- The loopback development checkbox is a deterministic local challenge, not
  cryptographic proof of natural-person identity or production bot resistance.
  Production requires correctly configured Turnstile action, preparation
  binding, hostname allowlists, HTTPS, and proxy controls.
- Preparation does not reserve the slot. Another valid booking may win before
  commit.
- An exact replay does not rerun mutable scheduling checks; it returns the
  already-committed immutable result. Only the first commit performs the full
  locked revalidation.
- The demo does not prove email ownership, notification delivery, hosted
  deployment readiness, performance, production monitoring, or protection from a
  compromised service-role credential.
- No language model makes scheduling decisions in this flow. MCP is a transport
  adapter over deterministic contracts.
- Guest or agent cancellation is not supported in v1.

Source publication and asset/license decisions are outside what this demo proves.
Production deployment, credential handling, Cloud operations, and every
internet-traffic gate remain separate and are listed in
`docs/publication-readiness.md`.
