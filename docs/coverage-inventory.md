# Coverage expansion inventory

This is the first bounded unit for issue #12, not completion of application-wide
coverage. The focused numeric thresholds remain unchanged and now apply per file. Test presence and
measured coverage are different evidence.

## Local baseline (2026-10-14)

Windows, base `ac7f7b0`, with the confirmation-support tests in this change:
`npm run check` passed. The focused report contains 64 lines, 73 statements,
16 functions and 23 branches: 100% lines/statements/functions and 91.30%
branches. `time.ts` alone has 5/7 branches covered (71.42%); the aggregate
passes because scanner branches contribute to the same threshold. This is a
reason to evaluate per-module floors after filling the gaps, not to claim
every scheduling module meets 90% branches. `publicBooking.ts` contributes only
four re-export statements; contract-package behavior needs its own coverage
instrumentation. The new service tests are outside the measured include.

Docker was unavailable for that local baseline. Hosted validation of subsequent
candidates is recorded separately in their PRs.

## Expanded focused gate (2026-10-15)

Invalid/missing timezone inputs and browsers without `Intl.supportedValuesOf`
now have regression cases. The focused report covers all 23 branches, including
7/7 in `time.ts`; lines/statements/functions also measure 100%. The existing
95% lines/functions/statements and 90% branch floors now apply to each included
file, so scanner branches cannot compensate for a time-helper gap.

The root suite has 83 passing tests. Confirmation support also rejects non-JSON
successes and malformed upstream failures without exposing diagnostics in public
messages. These service tests remain outside the measured include; contract
re-exports remain distinct from instrumented contract-package behavior. There
is no application-wide coverage claim or threshold reduction.

| Boundary | Existing evidence | Unmeasured risk and next useful layer |
| --- | --- | --- |
| Time and public DTOs | Root Vitest coverage includes `src/lib/time.ts` and `src/types/publicBooking.ts` | Keep DST and unknown-field vectors; these totals do not measure scheduling SQL. |
| Repository scanner | Root Vitest coverage includes `scripts/scan-repository.mjs` | Tooling coverage must not stand in for application coverage. |
| Application authority | `packages/application/tests/application.test.ts`; independent package Vitest configuration without a coverage gate | Measure scope, confirmation, expiry, stale state and replay branches before proposing a package threshold. |
| Browser confirmation support | `tests/unit/public-booking-support.test.ts` exercises strict server-grant responses, malformed upstream redaction, token validation and credential omission | Service code is outside the focused coverage include. Expand the problem-envelope matrix and preview response vectors next. These mocks do not prove server grant creation. |
| Gateway and authority adapter | `supabase/functions/api-v1/index.ts`, `_shared/supabaseAuthority.ts`; live stack evidence is separate | Inventory origin, proxy trust, limiter, challenge and database error paths at the Edge layer; a Node mock cannot establish Deno or database enforcement. |
| PostgreSQL scheduling/RLS | pgTAP and independent-client concurrency gates | Preserve fresh-clock, owner locking, exclusion, revocation and replay tests. JavaScript coverage does not measure SQL/RLS. |
| Browser state and privacy | Confirmation/review/error unit tests and Playwright flows | Expand expired review, stale response, retry and token-cleanup state transitions. Unit mocks do not prove browser/Edge parity or accessibility. |
| SDK/MCP/parity | Package, protocol and golden-vector suites | Instrument each runtime separately before combining reports; retain live HTTP and official conformance gaps explicitly. |

Prioritize denial and state-transition paths above a larger aggregate percentage.
First collect per-boundary baselines, review uncovered branches, then propose
maintainable module-specific floors. Do not lower the existing 95/90 focused gate
or claim the release-wide 80/75 target is enforced by it.
