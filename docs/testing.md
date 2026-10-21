# Testing and quality gates

## Layers

- **Contract/application/SDK suites** cover strict DTOs, operation metadata,
  authorization/scope enforcement, abuse checks, and HTTP normalization.
- **V2 contract foundation tests** cover strict mandate/booking DTOs, lossless
  microsecond normalization/order, local policy bounds, actor response privacy,
  separate artifacts/package export and unchanged v1 discovery/digest. These
  parsers do not prove live v2 identity, ownership, SQL or transport parity.
- **Vitest** covers pure scheduling/time rules, validation, browser services, and repository security tooling.
- **Local setup tests** cover prerequisite refusals, redaction, existing-data
  preservation and cross-checkout bootstrap locking without Docker. They run
  on Ubuntu, macOS and Windows; the fresh Docker bootstrap runs in Ubuntu CI.
- **Transport examples** compile the TypeScript client and exercise the actual
  HTTP/SDK/MCP examples against a strict mock HTTP server, including registry
  drift, shared inputs, no-hold checks, refusal and redacted failures. These run
  on all three OS install runners. A separate Ubuntu live-API check runs all
  three CLIs against the seeded Edge API; mocks are not database-authority proof.
- **MCP protocol tests** cover deterministic four-tool discovery, modern stdio
  envelopes, cancellation, schema/results, redacted text, and SDK-only transport.
- **Golden parity tests** drive one shared four-operation vector set through the
  application, SDK HTTP-serialization, and real MCP adapter seams. The HTTP
  transport is mocked here; live Edge and browser evidence remains separate.
- **pgTAP/Supabase tests** cover schema constraints, grants, functions, auth triggers, and the RLS role matrix.
- **Integration tests** use independent clients to prove atomic conflict behavior under races.
- **Playwright** covers public booking, the prepare/fragment-confirm/commit path,
  authentication boundaries, dashboard behavior, responsive layouts, keyboard interaction, and Axe accessibility checks.

No test may use a paid API, production project, or real personal data.

## Required release thresholds

- lint: 0 errors and 0 warnings;
- strict typecheck: 0 errors;
- high/critical npm advisories: 0 in production and full lockfile;
- unit coverage: at least 80% lines/functions/statements and 75% branches globally;
- scheduling/time/security modules: at least 95% lines/functions/statements and 90% branches;
- RLS: anonymous/owner/other coverage for every user-owned table;
- booking races: 50 isolated two-client attempts each produce exactly one success, one `SLOT_UNAVAILABLE` conflict, and one stored confirmed row;
- transport parity: the same four-operation valid/invalid vectors produce the
  same public data/problem semantics through application, HTTP, SDK/UI, and MCP;
- confirmation bypass: direct create, unknown authority fields, missing/expired/
  mismatched grants, reused tokens, stale authority, and legacy public RPC calls
  all fail without a booking;
- abuse boundary: all four operations and the browser preview/confirm support
  routes consume the gateway limiter, production requires an explicitly
  verified proxy-header boundary, and challenge failure cannot record a grant;
- Axe: 0 serious or critical findings on core states;
- responsive: no horizontal overflow at 320, 390, 768, 1024, and 1440 CSS pixels;
- Chromium, Firefox, and WebKit core flows pass.

The initial Vitest gate measures an explicit focused set: the repository scanner, public-booking DTO re-exports, and timezone/display helpers. It enforces 95% lines/functions/statements and 90% branches per included file. Contract-package tests exercise the schemas separately; the re-export file is not schema-wide coverage. The package and MCP tests are additive but are not yet proof of application-wide coverage. A supported Core release remains blocked until broader thresholds cover the scheduling, application, gateway, service, and UI modules they describe; honest public pre-alpha source may be published with this limitation stated explicitly.

## Local verification order

The [coverage expansion inventory](coverage-inventory.md) separates measured
modules from test presence and prioritizes the next boundary-level evidence.

Build the shared packages before starting Supabase because the Edge Function
imports their compiled output:

```sh
npm ci
npm run build:packages
npm run lint
npm run typecheck
npm run test
npm run test:parity
npm run test:coverage
npm run build
npm run audit
npm run audit:prod
npm run security:scan
npm run licenses:check
npm run db:start
npm run db:reset
npm run db:lint
npm run test:db
npm run test:concurrency
npm run types:check
npm run test:agent-flow
npm run test:e2e
npm run demo:authority:capture
```

`npm run test` includes the contract, application, SDK, MCP, and golden parity
suites; the standalone `test:parity` command is useful for focused diagnosis. The
database/browser portion requires Docker and the local stack. `npm run check`
covers non-Docker gates; `npm run check:full` adds database, 50-round
concurrency, type drift, the live stdio-MCP confirmation/create/replay flow, and
Playwright. The Authority Boundary capture command resets the fictional fixture,
runs the canonical joined Chromium MCP/browser/host-cancellation scenario, and
writes only ignored local images beneath `test-results`. Record commands
individually for release evidence so a later failure cannot be hidden by an
aggregate command.

Before promotion, also test the production-style reverse proxy, server-only
environment validation, Turnstile hostname/action rejection, and publishable-key
denial of every retired direct public booking RPC. The dependency-free MCP tests
do not replace the pinned official MCP conformance set for protocol `2026-07-28`.
The release parity gate additionally requires the shared golden vectors through
the actual Edge router and the documented DST, stale-state, idempotency, and
50-way cross-transport collision matrix.

## CI jobs

`npm run test:built-app` builds the self-hosted production bundle with synthetic
configuration and opens login, signup, demo and confirmation in Chromium,
Firefox and WebKit. It catches production module initialization failures that
development-server tests cannot detect. It never authenticates or creates data.

- `quality`: install, lint, typecheck, contract/application/SDK/MCP and unit
  coverage, build, audit, current-tree scan, licenses;
- `install-smoke`: `npm ci` plus Docker-free build/typecheck smoke on Ubuntu,
  macOS, and Windows (see [install-verification.md](install-verification.md));
- `database`: fresh local stack, two readiness-checked resets, lint, directory-scoped pgTAP, 50 isolated collision pairs, and generated-type drift;
- `e2e`: seeded local stack, live stdio-MCP parity flow, and all browser projects;
- publication workflow: full-history secret scan and clean-room checks.

Local Docker results and hosted CI results are recorded separately; neither should be inferred when it was not run.

## Pull-request dependency review

Every pull request also runs `Dependency vulnerability review` from
`.github/workflows/dependency-review.yml`, including pull requests without
lockfile changes. The SHA-pinned GitHub-owned dependency-review action compares
the pull request's base and head through GitHub's dependency graph. It fails on
introduced high or critical advisories across runtime, development and unknown
scopes, matching the full-lockfile audit threshold above. It is not configured
to warn instead of failing or to allow individual advisories.

The workflow token has only `contents: read`, checkout does not persist
credentials, and results appear in the job logs and summary rather than PR
comments. No package installation, build or pull-request script is executed by
this job. Dependency review complements the existing full-lockfile and
production npm audits and installed-package license allowlist; it does not
replace them. The current main ruleset and existing required check names are
unchanged. Maintainers must check this additional job before merging; adding it
to hosted required-check settings is a separate repository-policy change.

This workflow does not enable CodeQL. The remaining CodeQL portion of
[issue #11](https://github.com/EP2-Git/project-s/issues/11) needs a decision on
reporting: GitHub's standard CodeQL upload requires `security-events: write`,
while the issue requires read-only workflow tokens. An artifact-only analysis
can preserve read-only tokens, but would need its own findings gate and would
not populate code-scanning alerts. Do not add write permissions or treat the
dependency review as static analysis. CodeQL language coverage and any
generated-code exclusions must be documented when that work is implemented.
