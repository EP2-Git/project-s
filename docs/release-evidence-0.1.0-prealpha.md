# Project S Core 0.1.0-prealpha private-staging evidence

Date: 2026-08-26

Status: historical private-staging record frozen before public sanitation. This
record did not itself approve a public repository, production deployment,
hosted service, supported release, or stable API. The immutable GitHub
pre-release is authoritative for the sanitized commit and completed final gates.

## Candidate identity

- Committed staging `package-lock.json` blob SHA-256:
  `59e31ae62593c193a57648b8c76c082ff3cdf93d8c68961fbc87009a465b8ad1`
- Approved public maintainer identity: Ethan Patten,
  `188987293+EP2-Git@users.noreply.github.com`
- Sanitized public root: pending
- Exact pre-release commit and tag: pending

The staging repository is deliberately private because its reachable Git
history contains publication-inappropriate metadata. The final public history
will be recreated from the verified tree with coherent, reviewable commits; it
will not reuse or expose the staging repository's Git objects.

## Completed private-staging evidence

An isolated parentless source cut was validated on 2026-08-19 before the current
hardening work. That baseline established that the tracked project could be
installed and rebuilt without the legacy repository, ignored environment files,
private data, or generated demo evidence.

| Evidence | Private-staging result |
| --- | --- |
| Clean install and quick start | `npm ci`, package builds, local Supabase start/reset, ignored browser-environment generation, and a real HTTP `200` from the local application passed. |
| Application checks | Lint, typecheck, unit/contract/application/SDK/MCP/parity tests, focused coverage, build, repository scan, and license scan passed. |
| Database authority | Five pgTAP files and 267 tests passed; 50 of 50 isolated two-client races produced one success, one conflict, and one stored booking. |
| Joined authority flow | Four-tool discovery, non-holding preparation, pre-approval refusal, browser confirmation, database-authoritative create, exact replay, and authenticated host cancellation passed against synthetic local data. |
| Browser review | The cross-browser suite and the mobile authority-demo path passed, including the 390x844 review viewport. |
| Repository boundary | Full-history Gitleaks, an independent verified-secret scan, strict Git integrity checks, and a no-local clean clone passed for the isolated baseline. |
| GitHub staging CI | Quality/current-tree safety, reproducible database/RLS, and browser/accessibility jobs passed on the initial private cut. |

These are historical baseline results, not proof for the final public commit.
Detailed command counts and tool versions from that run remain in the
[dated private-candidate record](release-evidence-2026-08-19.md).

## Hardening completed on 2026-08-26

- React Router and React Router DOM were upgraded to `7.18.2` through a reviewed
  private-staging pull request.
- All three private-staging CI jobs passed on the rebased Router upgrade. Exact staging
  commit and run identifiers remain in the owner's private audit archive because
  those Git objects are not part of the public source history.
- `npm audit` reports zero known vulnerabilities. Dependabot alert status remains
  a final-sanitized-repository gate and cannot be claimed until that repository
  is created and verified.
- The historical Google OAuth client was deleted after the legacy product was
  unpublished and new signups were disabled. No Google OAuth client is used by
  Project S Core or the private Cloud plan.
- Public claims now describe the contract as pre-alpha, distinguish at-most-one
  durable creation from exact replay, identify the demo as deterministic, and
  keep unavailable Cloud, calendar, notification, and model features explicit.

The completed staging tree was then reinstalled with `npm ci`, confirming
`react-router` and `react-router-dom` `7.18.2` were the actual local runtime, and
rerun through the following private-staging matrix:

| Evidence | Hardened staging result |
| --- | --- |
| `npm run check` | Passed: lint, strict typecheck, 70 root tests, all contract/application/SDK/MCP/parity suites, focused coverage, production build, production audit, repository scan, and 520-entry license review. |
| Full dependency audit | Passed with zero known vulnerabilities. |
| Fresh database reconstruction | Local stack stop/start and repeated clean reset passed from committed migrations and synthetic seed. |
| Database and concurrency | Schema lint passed; five files and 267 pgTAP tests passed; 50 of 50 isolated two-client races produced the expected single winner and single stored booking. |
| Joined authority flow | MCP discovery, pre-approval refusal, browser authority, database-authoritative create, exact replay, and authenticated host cancellation passed after a clean reset. |
| Browser and accessibility | 41 tests passed with 4 intentional engine-specific skips across Chromium, Firefox, and WebKit. |
| Selected hosted review | 21 tests passed with 18 intentional renderer-specific skips; Chromium covered 390x844, 360x800, larger viewports, and 200/400 percent reflow equivalents. |
| Manual rendered review | The hosted source-facing page was inspected at 390x844 and 1440x900 for copy, hierarchy, overlap, clipping, and CTA truthfulness. |

One repeated joined-flow attempt correctly encountered the persisted local rate
limit after earlier test traffic. Resetting the disposable synthetic database
restored the isolated precondition and the rerun passed. This is test-state
isolation evidence, not a product failure or a claim about production thresholds.

## Final public-candidate gates

The following evidence must be produced again after history sanitation and on
the exact commit selected for `v0.1.0-prealpha`. It is intentionally recorded in
the immutable GitHub pre-release instead of retroactively rewriting this frozen
staging record:

- clean clone and README quick start;
- full `npm run check:full` matrix against a fresh local database;
- assertion-backed joined authority demo with synthetic data;
- current-tree repository scan and reviewed dependency-license scan;
- `npm run audit` and `npm run audit:prod`;
- full-history Gitleaks and independent verified-secret scans across every
  reachable public ref;
- search for private email addresses, workstation paths, legacy identifiers,
  environment files, archives, generated evidence, and private Git objects;
- strict Git integrity check with no unintended unreachable objects;
- protected GitHub CI and the manual publication-candidate workflow;
- repository metadata, branch protection, Actions restrictions, Dependabot,
  security reporting, and anonymous-clone verification;
- owner approval bound to the exact final commit and release notes.

The exact commit SHA and workflow links belong in the immutable GitHub
pre-release record once those gates pass. This document intentionally does not
pretend that a commit can contain its own final SHA.

## Explicitly unclaimed

Official MCP conformance, a public Cloud environment, external traffic,
backup/restore, monitoring, load testing, hosted legal/operator review,
production deployment, an SLA, and API compatibility are not claimed.
