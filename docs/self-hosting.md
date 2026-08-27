# Self-hosting

Project S's agent-native baseline consists of a static Vite application, the public
`api-v1` Supabase Edge Function, and a Supabase database reconstructed from this
repository's migrations. The browser, TypeScript SDK, and MCP adapter all call the
Edge gateway; they are not allowed to use scheduling RPCs directly.

## Requirements

- A supported Node version for building the frontend
- A Supabase project or self-hosted compatible stack
- A static host with single-page-application fallback to `index.html`
- A trusted reverse proxy or platform rewrite for the same-origin `/api/v1/*`
  route
- TLS for any internet-facing deployment

## Environment separation

Create separate Supabase projects for local development, preview/staging, and production. Set these build-time variables in the deployment platform:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_PROJECT_S_API_URL
VITE_PROJECT_S_TURNSTILE_SITE_KEY
VITE_PROJECT_S_DEPLOYMENT_AUDIENCE=self-hosted
```

These are public browser configuration. `VITE_PROJECT_S_API_URL` may be omitted when
the API is served at the browser origin; otherwise it is the trusted origin that
serves `/api/v1`. The Turnstile site key must match the server-side secret. Do not
set a service-role key, HMAC secret, Turnstile secret, OAuth secret, database
password, or private provider key under a `VITE_` name.

`VITE_PROJECT_S_DEPLOYMENT_AUDIENCE` controls presentation, not scheduling
authority. Its accepted values are `hosted` and `self-hosted`; missing, empty,
or invalid values resolve to `self-hosted`. In that safe default, `/` sends an
authenticated host to `/dashboard` and an anonymous visitor to `/login`.
Authentication, signup, `/demo`, `/book/:username`, `/booking/confirm`, and the
embed route remain available. Project S's marketing homepage, marketing-only
navigation, and design-review routes are not rendered. Production builds also
exclude the hosted-only page and marketing-chrome chunks when this value is
missing, invalid, or `self-hosted`.

Only Project S's own managed website should set this value to `hosted`. Setting it
does not enable a hosted service, pricing, integrations, or different booking
permissions; it only enables the hosted marketing surface. Self-hosters should
publish their own operator identity, terms, and privacy notices where required.

Configure these values only in the Edge Function's secret/environment store:

```text
PROJECT_S_ENVIRONMENT=production
PROJECT_S_PUBLIC_APP_URL=https://project-s.example
PROJECT_S_ALLOWED_ORIGINS=https://project-s.example
PROJECT_S_RATE_LIMIT_HMAC_SECRET=<high-entropy deployment secret>
PROJECT_S_TRUST_PROXY_HEADERS=true
PROJECT_S_CHALLENGE_PROVIDER=turnstile
PROJECT_S_TURNSTILE_SECRET_KEY=<matching secret key>
PROJECT_S_TURNSTILE_HOSTNAMES=project-s.example
```

Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into the Edge
runtime. The gateway needs them to call service-role-only RPCs, but they must not
be copied into the frontend, SDK, MCP environment, logs, or repository.

`PROJECT_S_PUBLIC_APP_URL` is required and must be HTTPS outside local development.
`PROJECT_S_ALLOWED_ORIGINS` is a comma-separated exact-origin allowlist; CORS is a
browser control, not caller authentication. Use a different high-entropy HMAC
secret per environment. Production must use `turnstile`, with a matching public
site key, server secret, expected action, and an explicit hostname allowlist.

Production intentionally refuses to boot unless `PROJECT_S_ENVIRONMENT=production`,
the app URL is HTTPS, the HMAC secret is set, and
`PROJECT_S_TRUST_PROXY_HEADERS=true`. Set the proxy flag only after every request
reaches the Edge Function through a proxy you control that removes caller-supplied
`CF-Connecting-IP`, `X-Real-IP`, and `X-Forwarded-For` values before writing its
own. If that boundary cannot be verified, do not expose this reference gateway;
an all-callers `unavailable` fallback would create a single globally exhaustible
create bucket. Trusting spoofable headers instead weakens rate-limit identity and
Turnstile remote-IP binding.

## API routing

The frontend and SDK generate paths beginning with `/api/v1`. In production,
preserve the path after that prefix and route:

```text
https://project-s.example/api/v1/<path>
  -> https://<project>.supabase.co/functions/v1/api-v1/<path>
```

Do not rewrite it to `/functions/v1/api-v1/api/v1/<path>`. Preserve `OPTIONS`,
`GET`, and `POST`, reject unexpected request bodies at the proxy, and do not cache
booking or confirmation responses. The local Vite proxy implements this mapping
for development; a static production host does not do so automatically.

## Deployment outline

1. Create a new Supabase project dedicated to the environment.
2. Review and apply migrations using the Supabase CLI.
3. Confirm the gateway RPCs are executable only by `service_role`, and complete
   the legacy RPC cutover described below.
4. Create only synthetic demo data in previews; do not copy production bookings.
5. Configure Auth site URL and exact allowed redirects.
6. Install and build the shared packages and frontend with
   `npm ci && npm run build`. The Edge import map resolves the generated
   `packages/contracts/dist` and `packages/application/dist` outputs, so this
   build must finish before the function is bundled or deployed.
7. Add the server-only secrets above and deploy `api-v1` with JWT verification
   disabled for this intentionally anonymous boundary.
8. Configure and test the same-origin `/api/v1` reverse proxy.
9. Serve `dist/` with SPA fallback, HTTPS, and appropriate security/cache headers.
10. Exercise prepare, fragment confirmation, challenge verification, idempotent
    commit, stale-slot rejection, and rate-limit rejection in preview.
11. Run the browser smoke/a11y matrix before promotion.

## Public booking and legacy cutover

The gateway applies a persisted reference rate limit to all four operations
before scheduling authority is invoked. The browser-only preview and confirmation
support routes are also metered and audited before database work, using the
prepare and create operation policies respectively. Prepare creates an expiring
capability but does not reserve a slot. The browser receives that capability in a
URL fragment, re-displays the authoritative summary, validates Turnstile
server-side, and records a one-use confirmation grant. Create accepts only the
preparation token and an idempotency key, then revalidates authority and
availability inside the locked database commit.

This control plane is ineffective if callers can bypass it through the legacy
PostgREST RPC surface. The included migration performs the following cutover;
before internet traffic, verify the same effective grants in the target project:

- revoke `EXECUTE` from `anon`, `authenticated`, and `PUBLIC` on
  `get_public_booking_page_v1(text)`,
  `list_public_free_slots_v1(text, uuid, date, text)`, and
  `create_public_booking_v1(jsonb)`;
- retain service-role execution only where the Edge adapter still requires it;
- keep the new prepare/preview/confirm/commit, rate-limit, and gateway-page RPCs
  service-role-only; and
- prove with publishable-key requests that direct RPC calls fail while the four
  `/api/v1` operations still work through the gateway.

Expired, uncommitted preparations (including guest fields), unconsumed grants,
and expired rate buckets are deleted opportunistically by the separately
committed limiter transaction on subsequent gateway traffic. Committed replay
records retain no duplicated guest PII. Operators should still schedule and
monitor retention maintenance for low-traffic installations and define the
authoritative booking/audit retention period before production.

Do not treat a browser-only CAPTCHA, CORS policy, or hidden RPC name as a bypass
control. The included limiter and Turnstile integration are a reference boundary,
not evidence that a particular deployment is sized or tuned safely. Add platform
WAF/edge limits, monitoring, and host cancellation procedures appropriate to the
installation.

## Optional functionality

Google Calendar and email are not shipped in the default baseline. Do not deploy deleted/archived functions from the historic repository. Adding an integration requires its own server-side secrets, authorization review, provider contract tests, privacy disclosure, and failure-mode documentation.

## Operations checklist

- Enable backups appropriate to your use case and test restoration.
- Monitor authentication, database errors, and booking conflicts without logging PII.
- Establish retention and incident-response policies.
- Alert on unusual public booking volume and exercise the cancellation path.
- Update dependencies and rerun security gates regularly.
- Rotate any credential that may have appeared in a previous repository or environment.

Self-hosting instructions do not make a deployment production-ready. Public
source pre-alpha, supported Core, and internet-traffic gates are separate in
`docs/publication-readiness.md`. In particular, a self-hoster must independently
validate credential handling, HTTPS/proxy/origin/Turnstile configuration,
database grants, browser behavior, monitoring, retention, backups, restore, and
incident response before serving public traffic.
