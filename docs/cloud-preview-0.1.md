# Project S Cloud Preview 0.1

Status: planned private staging milestone. It is not deployed, open for signup,
generally available, or production-ready.

## Purpose

Cloud Preview 0.1 will prove that Project S Core can be operated as a managed
service without changing who has authority to schedule. It must deploy an exact,
recorded Core commit. The hosted layer may supply deployment, upgrades,
monitoring, backups, and operational convenience; it may not introduce a second
scheduler or a privileged path around Core.

## Boundary

- **Core:** deterministic intent contracts, authority evidence, scheduling rules,
  lock-time availability and policy checks, database commit, immutable exact
  replay, authenticated host controls, and the UI/API/SDK/MCP adapters in this
  repository.
- **Cloud:** isolated infrastructure and operations for that same Core. Any fix
  to authority or scheduling correctness lands in Core first.

The authority model is unchanged: preparation is not permission to commit; a
supported authority provider must record approval; the database rechecks current
policy and availability under the owner-scoped lock; an exact retry returns the
same booking; cancellation is an authenticated host action.

## Preview acceptance gates

Cloud Preview 0.1 is complete only when one isolated, non-customer staging
environment proves all of the following against its recorded Core SHA:

1. Separate staging Supabase and web environments contain synthetic data only.
2. HTTPS, exact origin/hostname allowlists, same-origin `/api/v1` proxying, and
   trusted proxy-header handling are verified from outside the platform.
3. Fresh staging HMAC and Turnstile credentials are stored server-side; direct
   publishable-key calls to protected RPCs fail.
4. The real joined MCP/browser/dashboard scenario proves discovery, preparation,
   pre-approval refusal, browser review, recorded human authority, locked commit,
   exact replay without a duplicate, and authenticated host cancellation.
5. Persisted rate limits and an outer platform limit are load-tested without
   leaking booking data or making availability claims the deployment cannot meet.
6. Monitoring detects gateway, database, authentication, and conflict failures
   without logging guest names, emails, notes, tokens, or raw request bodies.
7. Backup restoration and rollback to the recorded Core SHA are exercised.
8. Retention, deletion, incident response, access control, privacy, terms,
   support ownership, and operator contact paths are reviewed for this deployment.

## Explicit exclusions

Preview 0.1 has no billing, public signup, customer data, SLA, uptime claim,
production traffic, public Cloud console, or support commitment. A passing private
preview would be evidence for a later service-readiness decision; it would not
silently promote itself to production.

Purchasing a Project S domain and completing provider OAuth verification are
deferred and are not Preview 0.1 acceptance gates. Preview 0.1 does not use a
legacy Google OAuth client for identity, onboarding, or Calendar access. Any
future customer-facing provider integration requires separately approved domain,
identity, authorization, token-handling, privacy, and release gates.
