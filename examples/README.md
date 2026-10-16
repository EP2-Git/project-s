# Runnable local transport examples

These three clients run the same synthetic discovery-to-prepare workflow through
raw HTTP, the TypeScript SDK, and the local stdio MCP adapter. They call the real
API; there is no offline success fallback, database access, automatic approval,
or cancellation tool. The source-workspace SDK is not published to npm.

## Run

Use Node/npm from the [local development prerequisites](../docs/local-development.md).
In a fresh, unlinked clone, from the repository root:

```sh
npm run bootstrap
npm run dev
```

Bootstrap refuses existing data. For an existing stack, follow the documented
verified reuse or manual workflow rather than resetting it for an example.
In another terminal, from the same repository root, choose a transport:

```sh
npm run examples:http
npm run examples:sdk
npm run examples:mcp
```

Each command builds the workspace packages first. The TypeScript example also
compiles to ignored `.cache/booking-examples`; no global compiler, runtime
transpiler, API token, or service-role credential is needed. The MCP example
starts and closes its own local stdio subprocess with the existing protocol
client. It checks discovery and the exact four-tool set before making calls;
this is not official MCP conformance certification or a remote MCP client.

The default target is `http://127.0.0.1:8080`. To use another local app origin:

```powershell
$env:PROJECT_S_API_BASE_URL = "http://127.0.0.1:8080"
npm run examples:http
```

```sh
PROJECT_S_API_BASE_URL=http://127.0.0.1:8080 npm run examples:http
```

Only loopback HTTP origins without credentials, paths, queries or fragments are
accepted. These examples are for the seeded `demo-host`, with fictional Casey
Example inputs from [fixture.mjs](fixture.mjs); do not substitute real guest data.

## What happens

The [shared workflow](shared.mjs) calls the same public-client methods through
[HTTP](http.mjs), [TypeScript SDK](sdk.ts), or [MCP](mcp.mjs):

1. Discover `demo-host` and select a returned meeting type.
2. Search up to 14 future UTC dates and select a server-listed slot. The client
   does not calculate availability or copy scheduling rules.
3. Prepare the synthetic intent and require `notHeld: true`.
4. Re-list the same date and verify the selected interval remains available.
5. Attempt create **before any browser approval** and require the canonical
   `CONFIRMATION_REQUIRED` problem, status `428`, retry action `confirm_in_browser`.
6. Stop. No browser confirmation route is called and no successful commit is
   requested after approval. Possession of the preparation token is not authority.

The relevant fields of the expected public problem are:

```json
{
  "status": 428,
  "code": "CONFIRMATION_REQUIRED",
  "retry": { "action": "confirm_in_browser" }
}
```

This is an excerpt; the clients validate the complete strict contract. HTTP
receives a direct problem, the SDK exposes `ProjectSApiError.problem`, and MCP
returns the versioned problem envelope with `isError: true`.

Successful output reports discovery, `notHeld=true`, the still-listed interval,
and the refused create. It omits guest details, preparation tokens and confirmation
URLs. A failure exits nonzero with diagnostics withheld. Check doctor, the running
app, synthetic fixture and API version locally; do not paste credential-bearing
diagnostics. If another client takes the slot, the no-hold check fails rather
than claiming a successful proof. Expiry, rate limiting, invalid responses and
unexpected create success also fail the example. Repeated runs create expiring
preparations and consume ordinary gateway limits; they do not bypass those limits.

For explicit browser approval, commit, exact replay, database verification and
authenticated host cancellation, use the separate
[Authority Boundary Demo](../docs/authority-boundary-demo.md).

## Verification boundaries

`npm run test:examples` compiles the TypeScript example and runs registry drift,
real SDK serialization, real MCP subprocess, shared-input, refusal, fail-closed
and output-redaction checks against a **mock HTTP server**. These checks run
without Docker on Ubuntu, macOS and Windows; they do not establish database authority.

`npm run test:examples:live` starts a temporary local Vite API proxy and runs all
three actual CLIs against the running Supabase Edge API and seeded fixture. It
requires an already prepared local stack, builds packages, and closes the proxy
afterward; it does not start/reset the database. This runs after the existing
database checks in the Ubuntu database CI job, using bootstrap's generated local
environment. Its ordinary rate-limit buckets stay separate from the browser
job's fresh stack. It is separate from
all-OS Docker-backed installation/demo evidence.
