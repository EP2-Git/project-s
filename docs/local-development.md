# Local development

## Prerequisites

- Git
- Node.js 22.12 or newer (`.nvmrc` records the project version)
- npm 10.9 or newer
- Docker Desktop or a compatible running Docker engine

The Supabase CLI is a pinned dev dependency; no global installation is required.

## Bootstrap

```sh
npm ci
npm run build:packages
npm run db:start
npm run db:reset
npm run db:env
npm run dev
```

Keep this order: install, build the shared contracts/application/SDK packages,
start Supabase, reset and seed the database, derive the browser environment, then
start Vite. The `db:start`, `db:reset`, and `dev` scripts each rebuild the shared
packages defensively because the Edge Function imports their compiled output.

`db:start` writes an ignored `supabase/functions/.env` with an explicit
`PROJECT_S_ENVIRONMENT=development` flag and random local HMAC secret, then
downloads/starts the local Supabase containers and Edge runtime.
`db:reset` rebuilds from migrations and applies `supabase/seed.sql`. `db:env`
reads the local CLI status and writes only `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` to ignored `.env.local`.

Local development therefore uses the safe `self-hosted` audience by default:
opening `/` enters the authenticated application or login flow. To review the
isolated hosted marketing concepts, set the audience only for that local Vite
process:

```powershell
$env:VITE_PROJECT_S_DEPLOYMENT_AUDIENCE = "hosted"
npm run dev
```

```sh
VITE_PROJECT_S_DEPLOYMENT_AUDIENCE=hosted npm run dev
```

The review routes remain noindex and do not claim a live `/` route.

Never copy a production key into local configuration. The browser does not require a service-role key.

## Local API and confirmation flow

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

## Clean verification

Before a release review, clone the candidate with `git clone --no-local` into an empty directory and repeat installation, reset, tests, and build. Success in an existing developer checkout is not sufficient evidence.
