# Project S

[![Protected CI](https://github.com/EP2-Git/project-s/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/EP2-Git/project-s/actions/workflows/ci.yml)
[![Latest prerelease](https://img.shields.io/github/v/release/EP2-Git/project-s?include_prereleases&sort=semver&label=prerelease)](https://github.com/EP2-Git/project-s/releases)
[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-6558d9.svg)](LICENSE)
[![Node 22](https://img.shields.io/badge/Node.js-22-3c873a.svg)](.nvmrc)
[![GitHub Discussions](https://img.shields.io/badge/Discussions-join-8250df.svg)](https://github.com/EP2-Git/project-s/discussions)

**Open-source booking infrastructure for humans and agents.**

**People define authority. Agents act within it. Project S commits.**

Project S separates what a client can *ask to do* from what it is *authorized to
commit*. An agent can discover availability and prepare an exact request, but
preparation is not a reservation and is not permission. A person records
authority in the browser. PostgreSQL then rechecks current time, policy,
availability, confirmation, and authority under the host lock before creating at
most one durable booking for the idempotency identity.

> **Public pre-alpha:** Project S Core `0.1.0-prealpha` is for local evaluation
> and development under the [Apache License 2.0](LICENSE). It is not
> production-ready. There is no hosted Project S service, public signup, support
> guarantee, or compatibility guarantee today.

[See the authority proof](#authority-boundary-proof) ·
[Run locally](#local-quick-start) ·
[Browse the docs](docs/README.md) ·
[View the public roadmap](ROADMAP.md) ·
[Read the architecture](docs/architecture.md) ·
[Join Discussions](https://github.com/EP2-Git/project-s/discussions) ·
[Contribute](CONTRIBUTING.md)

## Authority Boundary proof

![Four-stage Project S authority boundary: an agent prepares a non-holding request; create is refused before approval; the browser records human authority without creating a booking; PostgreSQL commits one booking and exact replay returns it without duplication.](docs/assets/authority-boundary-overview.webp)

The visual is composed from the assertion-backed synthetic MCP, browser, and
PostgreSQL flow. The central result is the refusal: the client tries to create
immediately and receives `CONFIRMATION_REQUIRED`; no booking exists. After the
browser records authority, PostgreSQL performs the locked recheck. An exact
replay returns the original booking rather than inserting a duplicate.

[Run the real flow](#authority-boundary-demo) or read the
[Authority Boundary Demo guide](docs/authority-boundary-demo.md) for the exact
assertions, fixture boundary, and limits of the proof.

## Works today

- Human booking pages and authenticated host controls.
- One strict contract across the browser, HTTP API, TypeScript SDK, and local
  stdio MCP adapter.
- Agent discovery and non-holding preparation.
- Explicit per-booking browser authority.
- Database-authoritative commit with fresh checks under the host lock.
- Immutable exact replay that returns the committed result without duplication.
- Separate authenticated host cancellation.

## North star — future, not current capability

Project S is moving toward independently authorized host-side and guest-side
agents that can coordinate inside bounded, revocable mandates. Valid requests
could commit automatically only while the mandate remains in scope; requests
outside that authority would step up to a person. The deterministic Core remains
self-hostable, with an optional managed Cloud service as a future operating
model.

Standing mandates, delegation, bilateral agent negotiation, federation, remote
MCP, and a generally available Project S Cloud do **not** exist in this release.
See the [product north star](docs/product/project-s-north-star.md),
[feature-status matrix](docs/feature-status.md), and [public roadmap](ROADMAP.md).

## Preparation is not permission

Project S treats scheduling as an authority boundary, not a form submission:

1. A client discovers the host's current booking page and free slots.
2. It prepares an exact, expiring request. Preparation does not hold the time.
3. A commit attempt without approval is refused with `CONFIRMATION_REQUIRED`.
4. A person reviews the server-derived summary and records authority in the
   browser.
5. PostgreSQL locks the host, rechecks current policy and availability, and only
   then creates the booking.
6. An exact retry returns the original booking instead of creating a duplicate.

Host cancellation is deliberately outside the public and MCP boundary. It is an
authenticated host action through the private dashboard contract.

## What ships in Core

| Capability | Pre-alpha boundary |
| --- | --- |
| Self-hosted browser application | Included for local evaluation and development; no managed service is offered. |
| Public booking API | Exactly four current operations: page discovery, free-slot search, prepare, and create. `v1` names the wire contract; it does not promise stability. |
| TypeScript SDK | Included as a source workspace package; it is not published to npm. |
| MCP adapter | Client-launched, newline-delimited stdio with four tools; no remote MCP or OAuth transport. |
| Official MCP conformance | Not claimed. Local protocol and tool tests are evidence for this adapter, not third-party certification. |
| Human confirmation | Explicit per-booking browser review; preparation is non-holding and cannot authorize commit. |
| Authoritative commit and replay | PostgreSQL revalidates before the first write; an idempotency identity produces at most one durable booking and exact retry returns it. |
| Host cancellation | Included only as an authenticated host dashboard/database action, not as a public API or MCP tool. |
| Calendar, outbound notifications, AI interpretation, and guest changes | Excluded from this release boundary; no release date is promised. |
| Project S Cloud | Private, deny-all development only; no deployment, signup, billing, SLA, or production traffic. |

Project S Core is this repository: the deterministic authority kernel, browser
application, HTTP API, TypeScript SDK, and local MCP adapter. See the full
[feature-status matrix](docs/feature-status.md), the private
[Cloud Preview 0.1 plan](docs/cloud-preview-0.1.md), and the separate
[source-versus-service gates](docs/publication-readiness.md).

## Engineering evidence

| Scoped guarantee | Repository evidence |
| --- | --- |
| Shared strict contracts | Contract artifacts and the cross-transport parity suite reject schema and error-model drift. |
| Database authority | pgTAP and locked-RPC tests exercise policy, RLS, authority, expiry, overlap, and replay boundaries. |
| Duplicate prevention | A 50-round independent-client race harness expects one durable winner for one idempotency identity. |
| Browser behavior | Playwright exercises Chromium, Firefox, and WebKit; browser-specific skips remain explicit. |
| Accessibility | Playwright and Axe cover the joined public review and authenticated-host flow alongside keyboard and reflow checks. |
| History safety | Publication-candidate workflows run Gitleaks, TruffleHog, repository policy, dependency, and licence checks. |
| Reproducibility | Clean database resets, generated-type checks, clean-room CI, and publication-candidate verification are documented. |

These are scoped engineering checks, not performance results, production
guarantees, application-wide coverage claims, or third-party certification. See
[testing](docs/testing.md) and the
[current release evidence](docs/release-evidence-0.1.0-prealpha.md).

## Stack

- React 18, TypeScript, Vite, Tailwind CSS, and Radix UI
- Supabase Auth and PostgreSQL
- Vitest, pgTAP/Supabase database tests, Playwright, and Axe
- Node.js 22 and npm

## Local quick start

Prerequisites: Node.js 22.12 or newer, npm 10.9 or newer, Docker Desktop (or a compatible Docker engine), and Git.

```sh
git clone https://github.com/EP2-Git/project-s.git
cd project-s
npm ci
npm run db:start
npm run db:reset
npm run db:env
npm run dev
```

Open `http://127.0.0.1:8080`. `db:env` writes only the local public API URL and local publishable key to the ignored `.env.local` file. It never writes a service-role credential.

The default deployment audience is `self-hosted`, so `/` enters login or the
authenticated dashboard rather than showing Project S's hosted marketing site.
Only a future Project S-managed website should set
`VITE_PROJECT_S_DEPLOYMENT_AUDIENCE=hosted`; see
[self-hosting](docs/self-hosting.md#environment-separation).

The database and development scripts rebuild the workspace packages
defensively. Vite serves the browser and proxies same-origin `/api/v1/*`
requests to the local `api-v1` Edge Function.

## Authority Boundary Demo

After the local quick start, run the real MCP-to-browser authority demonstration:

```sh
npm run demo:authority
```

The command prepares a fictional booking through the stdio MCP server, visibly
proves that create is blocked with `CONFIRMATION_REQUIRED`, waits for explicit
browser approval, commits and exact-replays the request, verifies one stored
booking, then switches to the authenticated seeded-host contract to cancel it.
It does not add a cancellation MCP tool or bypass the confirmation route.

Use `npm run demo:authority:capture` for the assertion-backed desktop/mobile
capture path; it first resets the disposable local Supabase fixture. Generated
evidence stays under ignored `test-results`. See the
[Authority Boundary Demo guide](docs/authority-boundary-demo.md) for the exact
story, local challenge limitation, capture policy, and claims the demo does not
make.

The dated private-staging baseline includes 267 database tests, 50 of 50
two-client authority races with the expected single winner, and 41 passing
cross-browser tests with 4 intentional browser-specific skips. These are scoped
engineering results, not production guarantees; the final public-candidate rerun
is tracked in the [release evidence](docs/release-evidence-0.1.0-prealpha.md).

## Public booking boundary

Project S contract version 1 implements exactly four contract-versioned public application
operations:

| Operation | HTTP route | MCP tool |
| --- | --- | --- |
| Get booking page | `GET /api/v1/public/booking-pages/{username}` | `project_s_get_booking_page_v1` |
| List free slots | `POST /api/v1/public/free-slots/search` | `project_s_list_free_slots_v1` |
| Prepare booking | `POST /api/v1/public/bookings/prepare` | `project_s_prepare_booking_v1` |
| Create booking | `POST /api/v1/public/bookings` | `project_s_create_booking_v1` |

The [public booking boundary ADR](docs/adr/0001-agent-native-public-booking-boundary.md)
records the capability and database-grant decisions. Every deployment must still
prove its effective grants and gateway paths before internet traffic, as
described in [self-hosting](docs/self-hosting.md).

Prepare returns a short-lived, non-holding intent and a browser URL whose opaque
token is carried in the URL fragment. A human reviews the server-derived summary
and completes the configured challenge. Only then can create commit the prepared
intent with an idempotency key. See the [API v1 boundary](docs/api-v1.md) and
[confirmation flow](docs/agent-confirmation-flow.md).

To launch the local stdio MCP adapter after the HTTP API is running:

```sh
PROJECT_S_API_BASE_URL=http://127.0.0.1:8080 npm run mcp:stdio
```

In PowerShell, set the environment variable first with
`$env:PROJECT_S_API_BASE_URL = "http://127.0.0.1:8080"`, then run
`npm run mcp:stdio`.

For setup details and troubleshooting, read [local development](docs/local-development.md). For a self-hosted evaluation, read [self-hosting](docs/self-hosting.md).

## Quality commands

```sh
npm run check
npm run check:full
```

Database and browser commands require the local Supabase stack. `db:reset` includes a Postgres readiness wait so the next command does not race a restarting container. `npm run check` covers the checks that do not require Docker; `npm run check:full` adds the local database, 50-round concurrency, generated-type, and browser gates.

See [testing](docs/testing.md) for the individual commands, test boundaries, and
interpretation of skips and focused coverage.

## Architecture and security

- [Architecture](docs/architecture.md)
- [Public API v1](docs/api-v1.md)
- [Authority Boundary Demo](docs/authority-boundary-demo.md)
- [Security model](docs/security-model.md)
- [Self-hosting](docs/self-hosting.md)
- [Testing and release evidence](docs/testing.md)
- [Project provenance](PROVENANCE.md)

Please report vulnerabilities using [SECURITY.md](SECURITY.md), not a public issue.

## Contributing

Run the demo, inspect the contracts, and open a reproducible issue if you can
bypass refusal, locking, replay, privacy, or host ownership. Read
[CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md)
before proposing a change. Core scheduling behavior must remain usable without
optional integrations.

## License

Copyright 2025-2026 Ethan Patten and contributors. Project S Core is licensed
under the [Apache License 2.0](LICENSE). Package manifests remain `private` to
prevent accidental npm publication; that flag does not change the source license.
See the dated [license decision](docs/license-decision.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).
