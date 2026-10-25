# Local bootstrap and doctor

Use a fresh, unlinked clone with Git, Node.js 22.12+ (see `.nvmrc`), npm 10.9+,
and a running local Docker engine. Docker Desktop is suitable on Windows and
macOS. No hosted Supabase project, access token, or production credentials are
needed. The Supabase CLI comes from the repository lockfile.

From the repository root:

```sh
npm run bootstrap
npm run dev
```

Bootstrap checks prerequisites, installs with `npm ci`, builds shared packages,
generates development-only Edge configuration, starts Supabase, resets the
**newly created disposable local database** with `db reset --local`, waits for
readiness, and generates `.env.local`. Open `http://127.0.0.1:8080` after starting
the app. Bootstrap itself does not start the browser server, provision a hosted
project, or choose a production challenge/provider configuration.

The ignored Edge environment contains a newly generated local HMAC secret. The
ignored browser environment contains only the local API URL and public key.
Child command output is withheld by bootstrap because Supabase diagnostics can
include credentials. It reports each step and stops on the first failure.

## Inspect without changing anything

```sh
npm run doctor
npm run --silent doctor -- --json
```

Doctor exits nonzero on a failed check. Its versioned JSON report contains
status, a short explanation, and remediation; it never prints environment
values, Docker endpoints, container identities, or repository-origin URLs.
Warnings allow a fresh checkout to lack dependencies and generated environment.
Doctor reads configuration, inspects local Docker metadata, and briefly binds
loopback ports to test availability. It never installs, writes files, starts or
stops containers, links projects, or resets data.

It checks the repository root/origin, disposable project ID, hosted link markers,
Node/npm, repository Supabase CLI, local Docker context/daemon, configured ports,
and local-only development environment. Fork origins are a warning to inspect.
Remote/TCP Docker contexts, hosted URLs, privileged browser credentials,
production/challenge overrides, and a different local Supabase API port fail.
Docker must use a local Unix socket or Windows named pipe.

## Existing data and retries

Default bootstrap refuses any existing `project-s-local` containers or retained
data volumes, including a stopped or partially created stack. Removing a
container does not imply its database volume is disposable. Bootstrap never
removes containers or volumes.
After a successful bootstrap in this checkout, use:

```sh
npm run bootstrap -- --reuse
```

Reuse requires the ignored `.cache/local-bootstrap.json` marker to match this
checkout and the current database container, plus both generated environment
files. It builds packages and starts/waits for the same stack, preserving its
database and environment, including the HMAC secret. It never resets or rewrites
configuration. A recreated container, another checkout, an old manual stack, or
missing configuration fails this check. Do not fabricate or copy the marker.

All bootstraps share an exclusive `project-s-local-bootstrap.lock` in the system
temporary directory because checkouts share the same local project ID. The lock
is released on success or ordinary failure. If interrupted forcibly, inspect
local processes before removing a stale lock. Do not run manual stack-changing
commands concurrently with bootstrap.

If setup stops, run doctor and inspect the failed step with the corresponding
manual command below. Review terminal output locally; do not paste secrets into
issues. A partial stack is intentionally preserved for diagnosis. Do not reset
or stop an existing stack until you have decided its local data is disposable.
Use a separate environment if it contains data you need to retain.

| Refusal | Next action |
| --- | --- |
| Node/npm missing or too old | Select the Node version in `.nvmrc`; rerun doctor. |
| Docker unavailable | Start the local engine and wait for readiness. |
| Remote Docker context | Select a local socket/named-pipe context. |
| Port occupied | Identify the local service; stop it only if appropriate. Doctor never stops it. |
| Hosted link or unsafe environment | Preserve that checkout and use a fresh unlinked clone with local configuration. |
| Existing stack without a matching marker | Use the manual workflow after reviewing data ownership; bootstrap will not adopt/reset it. |
| Supabase CLI not ready | Run `npm ci`; inspect its installation error locally. |

## Manual workflow and CI

These commands remain available for deliberate local maintenance. In particular,
`db:reset` is destructive to the local database and `db:edge-env` replaces the
local HMAC secret; they do not inherit bootstrap's existing-data refusal.

```sh
npm ci
npm run build:packages
npm run db:edge-env
npm run db:start
npm run db:reset
npm run db:env
npm run dev
```

`npm run bootstrap -- --skip-install` is for CI after `npm ci`; it requires the
installed Supabase CLI. CI tests the fresh bootstrap on Ubuntu, followed by the
database/RLS, collision and generated-type gates. A CI-only synthetic database
probe checks default refusal and verified reuse against a sentinel row, and
compares both generated environment files byte-for-byte. Deterministic setup/refusal
tests run on Ubuntu, macOS and Windows with `npm run test:setup`. These tests
do not claim a Docker-backed bootstrap or authority demo was run on all three
operating systems; the broader [install verification](install-verification.md)
matrix remains separate.

## Local API and confirmation flow

### First account and booking setup

Open `/signup` on the local app and create a synthetic test identity. Follow any
verification required by the checked-in local Auth configuration; its local
mail inbox is `http://127.0.0.1:54324`. No external mail provider or hosted
account is needed. Do not disable verification to bypass a failed signup.

The dashboard's **Booking setup** card checks saved profile/timezone, an active
meeting type and saved weekly hours or an available date on/after today in the
host's saved timezone. Its actions open the corresponding settings. Save edits
there, then return to Overview or use **Check setup again**. The initial signup
trigger supplies weekday hours; review them before sharing the link.

Copy, share, preview and embed remain available as soon as a valid saved username
is read, including for a brand-new account. A blocked clipboard has manual copy
instructions. A failed setup read shows retry guidance instead of completed
steps. Only the signed-in owner's existing RLS reads supply this checklist;
no progress flag or agent permission is written.

**Your setup is saved** means those settings exist, not that a meeting fits a
particular window or a slot is currently free. Preview `/book/<username>` to
inspect guest times. Public preparation/confirmation and the database still
recheck current scheduling and authority. Use a separate browser context for
the guest walkthrough; the host can manage the resulting booking in Bookings.

### API routing

The browser calls the Project S HTTP boundary at its own origin. During
`npm run dev`, Vite rewrites:

```text
http://127.0.0.1:8080/api/v1/<path>
  -> http://127.0.0.1:54321/functions/v1/api-v1/<path>
```

Leave `VITE_PROJECT_S_API_URL` empty for this same-origin setup. The local Edge
runtime supplies its own Supabase URL and service-role credential; those values
must never be added to `.env.local` or any `VITE_*` variable. Local-only safe
configuration covers the app URL, allowed loopback origins, HMAC key, and
development confirmation challenge. The visible local confirmation checkbox
produces a fixed token accepted only under that explicit development mode, whose
public app URL is required to be loopback. Production defaults closed; it never
infers development mode from an internal Supabase/Kong hostname.

The generated development allowlist covers the normal app (`8080`), the browser
suite (`4173`), and the isolated selected-homepage review (`4184`) on both
`127.0.0.1` and `localhost`. A different origin fails closed with a visible site
configuration error. After changing the local Edge configuration, restart the
local Supabase stack so the Edge runtime reloads it.

The booking sequence is:

1. Read the booking page and list a meeting type's free slots.
2. Prepare the exact guest intent. Preparation validates current authority but
   does not hold or reserve the slot.
3. Open `/booking/confirm#preparation=<opaque-token>`. The page immediately
   removes the fragment from browser history, fetches the server-derived preview,
   and requires explicit human approval.
4. Commit with the preparation token and a UUID idempotency key. The database
   revalidates current availability and the confirmation grant before inserting.

The two browser-only preview/confirm support routes are not additional public
application operations. Agents and SDK callers use the four operations documented
in [api-v1.md](api-v1.md).

## Local MCP

Start the web/API stack first, then launch the stdio subprocess from another
terminal:

```powershell
$env:PROJECT_S_API_BASE_URL = "http://127.0.0.1:8080"
npm run mcp:stdio
```

The MCP process calls only `/api/v1`; it does not connect to Supabase or receive a
service-role key. See [mcp-local-stdio.md](mcp-local-stdio.md).

## Useful commands

```sh
npm run db:status
npm run db:stop
npm run test
npm run test:mcp
npm run test:db
npm run test:concurrency
npm run db:lint
npm run types:check
npm run test:agent-flow
npm run test:e2e
```

`test:concurrency` defaults to the release gate of 50 isolated two-client races. For a shorter local diagnostic only, set `PROJECT_S_CONCURRENCY_ROUNDS` to an integer from 1 to 50; CI does not override the 50-round default.

If `db:start` cannot connect, start the Docker engine and retry. On Windows, confirm Docker Desktop is using Linux containers. Port conflicts are reported by the Supabase CLI; stop the conflicting stack or deliberately change the local ports in `supabase/config.toml`.

## Schema workflow

1. Add an ordered migration; do not configure the hosted dashboard as schema authority.
2. Reset the local database from scratch.
3. Add/update pgTAP and concurrency coverage.
4. Regenerate `src/integrations/supabase/types.ts` from the local schema.
5. Run `npm run types:check`.

The legacy public booking RPCs are database adapter/rollback artifacts, not a
browser API. The agent-native migration removes `anon`, `authenticated`, and
`PUBLIC` `EXECUTE` from `get_public_booking_page_v1`,
`list_public_free_slots_v1`, and `create_public_booking_v1`, while retaining only
the narrowly required service-role slot adapter access. Verify the effective
grants in every target project before pointing traffic at `/api/v1`.


## Cross-platform install smoke

Every pull request runs a Docker-free install smoke on Ubuntu, macOS, and
Windows runners. Locally:

```sh
npm ci
npm run test:install-smoke
```

See [install-verification.md](install-verification.md) for the full clean-clone
checklist (database start/reset, env generation, app start, Authority Boundary
Demo) and how to record platform-specific gaps.

## Clean verification

Before a release review, clone the candidate with `git clone --no-local` into an empty directory and repeat installation, reset, tests, and build. Success in an existing developer checkout is not sufficient evidence.
