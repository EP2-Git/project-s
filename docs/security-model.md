# Security model

## Protected assets

- guest identity, email, notes, responses, and booking times;
- host account and private schedule data;
- authentication sessions;
- calendar tokens and provider credentials if integrations are added later;
- deployment and database administrative credentials.

## Trust boundaries

The browser, anonymous HTTP/SDK/MCP requests, route parameters, generated model
output, challenge-provider responses, and proxy forwarding headers are untrusted.
The public `api-v1` Edge Function is the application boundary. PostgreSQL remains
the scheduling and persistence authority. The publishable Supabase key is public
by design; it provides no bypass around RLS. Service-role credentials, HMAC keys,
and challenge secrets are privileged and server-only.

## Core controls

- RLS on every user-owned table with explicit anonymous, owner, and other-user tests.
- No public `SELECT` on `bookings` and no direct anonymous booking insert.
- Exactly four strict, contract-versioned public application operations shared by
  UI, HTTP, SDK, and MCP. Inputs reject unknown fields.
- Per-operation scopes and a validated execution context carrying actor,
  transport, client, and hashed provenance—not caller-selected database authority.
- A persisted gateway rate-limit check on all four operations before scheduling
  authority is invoked, plus metering and audit on the browser-only preview and
  confirmation support routes before their database work.
- Gateway-only scheduling RPCs executable by `service_role`, with no service key
  in the browser, SDK, or MCP process.
- Database constraints for overlap/concurrency invariants.
- Fixed `search_path`, schema-qualified objects, minimal grants, and authorization in every `SECURITY DEFINER` function.
- Public Vite values contain only public URLs/keys and the Turnstile site key; no
  credentials in browser names or bundles.
- Synthetic seed/test data and redacted logs.
- Dependency, repository-identifier, and full-history secret scans before publication.

## Prepare, confirm, and commit authority

Prepare accepts the guest intent, derives the end time and public summary on the
server, and stores only an expiring, non-holding preparation. Its opaque token is
placed after `#preparation=` in the browser URL so it is not sent in the initial
HTTP request or ordinary referrer. The confirmation page removes the fragment,
loads the authoritative preview, and requires explicit approval plus a challenge.

The Edge Function validates Turnstile with the secret, expected
`project_s_booking_confirmation` action, and configured hostname before asking the
database to record a one-use grant. A conversation statement, `confirmed: true`,
MCP annotation, unapproved token, or page view is not confirmation. Create accepts
only `preparationToken` and `idempotencyKey`; the database locks the host,
re-reads current policy and clock, checks the bound grant and authority revision,
recomputes availability, inserts under the exclusion constraint, and consumes the
grant atomically. Preparation never reserves the time.

Tokens, confirmation links, guest fields, and raw challenge responses must not be
written to application/MCP logs, analytics, audit metadata, or support screenshots.
Provenance uses deployment-HMACed network/user-agent keys rather than raw values.

## Anonymous booking abuse boundary

Database validation prevents forged ownership, invalid slots, and overlapping
writes; Turnstile is a bot signal, not proof that a guest owns an email address.
The included rate limiter is a reference control whose thresholds and deployment
capacity still require preview load/abuse testing, monitoring, and tuning.

Production must explicitly set `PROJECT_S_ENVIRONMENT=production`, use a fresh
high-entropy rate-limit HMAC secret, exact CORS and Turnstile hostname allowlists,
HTTPS, and `PROJECT_S_TRUST_PROXY_HEADERS=true`. The worker refuses to boot without
those controls. Enable proxy trust only behind a verified proxy that strips
spoofed incoming forwarding headers; otherwise do not expose this reference
gateway. CORS does not protect non-browser clients.

The agent-native migration revokes legacy public booking RPC execution from
`anon`, `authenticated`, and `PUBLIC`. Any direct PostgREST path around the
gateway would bypass rate limiting, provenance, preparation, and human
confirmation, so deployment cutover tests must prove publishable-key RPC calls
fail and the service-role Edge adapter is the only scheduling path.

Expired uncommitted preparations and grants are purged on subsequent limiter
transactions; committed preparation rows are retained for exact replay only after
their duplicated guest fields are nulled. Low-traffic deployments still need a
monitored retention schedule and explicit booking/audit retention policy.

## Explicitly excluded attack surface

Google Calendar and outbound notification Edge Functions are removed from the v1 baseline. They must not be deployed merely because old code existed. Reintroduction requires authenticated caller binding, encrypted/token-safe storage, provider mocks, retry limits, log redaction, and contract tests.

## Release checks

`npm run security:scan` checks the candidate tree for forbidden files and identifiers without printing matched values. CI also fails on high/critical npm advisories. The resolved React Router 6 advisory exception remains documented as release history; the current candidate must still pass the configured audit threshold. The separate sanitized repository must additionally pass full-history Gitleaks and a second verified-secret scan.

The historic private repository is not safe to publish even if its current tree is clean.
