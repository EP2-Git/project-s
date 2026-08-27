# Publication and operating readiness

This reusable checklist separates an honest public source pre-alpha from a
supported Core release and from operating Project S Cloud. A passing source
gate does not open either of the later gates. For a published cut, the immutable
GitHub pre-release records which exact-SHA checks passed; unchecked final items
below remain repeatable gates, not a live repository-status dashboard.

## Gate A: public source pre-alpha

The tracked source passed private-staging validation before its public cut, but
every item marked "final" must be repeated after sanitation on the exact public
candidate. The matching pre-release is authoritative for completion.

### Ownership, provenance, and repository boundary

- [x] owner selected Apache-2.0 and the official `LICENSE` is present
- [x] retained asset inventory is owner-cleared in `ASSET_PROVENANCE.md`
- [x] owner authorized creation of a public Project S source repository
- [x] historical Google OAuth access was retired; Project S ships no shared
  provider client
- [ ] final public history contains only coherent sanitized Project S commits
- [ ] final history contains no personal email, workstation path, legacy secret,
  private fixture, production identifier, archive, or generated demo evidence
- [ ] maintainer identity, description, topics, links, and social preview are
  correct on the final repository
- [ ] owner attestation is stored privately and bound to the exact release commit

### Exact candidate verification

- [ ] clean-clone `npm ci` and README quick start
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`, including contracts, application, SDK, MCP, parity, and
  public-claim regression tests
- [ ] `npm run test:coverage`
- [ ] `npm run build`
- [ ] `npm run audit` and `npm run audit:prod`
- [ ] `npm run security:scan`
- [ ] `npm run licenses:check`
- [ ] fresh `npm run db:start` and repeated `npm run db:reset`
- [ ] `npm run db:lint`
- [ ] `npm run test:db`
- [ ] `npm run test:concurrency`
- [ ] `npm run types:check`
- [ ] `npm run test:agent-flow`
- [ ] `npm run test:e2e` in Chromium, Firefox, and WebKit
- [ ] joined Authority Boundary Demo passes against synthetic local data
- [ ] full-history Gitleaks and independent verified-secret scans
- [ ] strict Git integrity check finds no unintended public objects
- [ ] protected CI and the manual publication-candidate workflow pass
- [ ] anonymous clone resolves the exact intended default branch and source tree
- [ ] immutable pre-release evidence records the exact SHA, lockfile digest,
  workflow links, tool versions, command results, and remaining limitations

Passing Gate A permits public source development. It does not mean the software
is production-ready, supported, API-stable, or available as a hosted service.

## Gate B: Core maturity and a supported release

These items are intentionally deferred beyond the first public pre-alpha:

- [ ] official MCP conformance requirements for protocol `2026-07-28`
- [ ] shared golden vectors pass through the deployed Edge router
- [ ] broader DST, stale-state, idempotency, and cross-interface collision matrix
- [x] React Router advisory exception retired by the tested Router 7 upgrade
- [ ] compatibility policy and supported-version table approved
- [ ] stable release, migration, maintenance, and support ownership approved

## Gate C: Cloud Preview and internet traffic

These remain closed and do not block honest public source development:

- [ ] local, preview, and production environments isolated
- [ ] private preview contains synthetic data only and has no public signup or
  billing
- [ ] same-origin API proxying, SPA fallback, HTTPS, and no-cache booking
  responses verified from outside the hosting platform
- [ ] exact CORS and Turnstile hostname allowlists set with fresh HMAC and
  challenge secrets
- [ ] proxy-header trust reviewed and spoofed forwarding headers stripped
- [ ] direct publishable-key calls to private scheduling RPCs fail while the four
  supported gateway operations work
- [ ] persisted and outer-platform rate limits exercised under representative
  load without logging personal data
- [ ] real browser confirmation uses server-verified Turnstile; preparation stays
  non-holding; commit revalidates authority and availability
- [ ] joined MCP/browser/dashboard flow, exact replay, and authenticated host
  cancellation pass in the exact private staging environment
- [ ] monitoring, alerting, retention, deletion, and incident response owned
- [ ] backup restoration and rollback to a recorded Core SHA exercised
- [ ] Cloud terms, privacy notice, operator identity, access control, support
  expectations, and disclosure path approved
- [ ] final mobile/desktop accessibility and responsive review recorded
- [ ] owner explicitly approves the exact environment for its stated audience

See [Cloud Preview 0.1](cloud-preview-0.1.md) for the bounded private milestone.
No unchecked Gate C item may be implied by a passing local test or public source
repository.

## Evidence policy

Evidence must record the commit SHA externally, operating-system and tool
versions, each command and result, dependency exceptions, asset decisions, and
remaining manual actions. Never claim an unrun Docker, browser, credential,
hosted, load, restore, or rollback check.
