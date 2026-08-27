# Agent-native release evidence — 2026-08-19

> Update 2026-08-26: the React Router 6 advisory exception recorded below was
> closed by the separately tested Router 7 upgrade. Current publication evidence
> is recorded in `docs/release-evidence-0.1.0-prealpha.md`.

> Historical private-candidate evidence. Superseded by the Project S public-root
> verification record. This document is not certification of the public commit,
> Project S Cloud, a production deployment, or a supported release.

Status: the local agent-native implementation candidate is verified. It is not
approved for publication or production traffic until the explicit release gates
at the end of this report are closed.

Historical note: product prose in this report was normalized after the
2026-08-25 Project S rename. Test counts, dates, and release-gate
results remain the original evidence; obsolete pre-rename paths and branch names
are described rather than reproduced.

## Scope and provenance

- Source repository: the historic private pre-rename checkout on its legacy
  OSS-readiness branch.
- Reviewed upstream baseline: owner-retained private snapshot; its identifier is
  intentionally omitted from the public record.
- Sanitized candidate: a separate pre-rename publication-candidate checkout.
- The candidate is a separate one-root-commit repository with no configured
  remote. Its exact final SHA is recorded in the private continuation handoff;
  a commit cannot embed its own object ID.
- No push, deployment, production database write, paid API, or public repository
  creation was part of this work unit.

## Verification environment

- Microsoft Windows 11 Home 10.0.26200 build 26200
- Node.js 22.14.0
- npm 10.9.2
- Docker Desktop engine 28.0.4, Linux containers
- Supabase CLI 2.115.0

All runtime checks used synthetic data and the local Supabase stack.

## Application and contract evidence

| Command or suite | Result |
| --- | --- |
| `npm ci` | Passed from the committed lockfile. |
| `npm run lint` | Passed with zero warnings. |
| `npm run typecheck` | Passed, including strict application and workspace TypeScript. |
| Root Vitest | 48/48, including the exact-workspace license-policy regression. |
| Contract suite | 13/13. |
| Application-boundary suite | 7/7. |
| SDK suite | 8/8. |
| MCP protocol suite | 14/14. |
| `npm run test:parity` | 16/16 shared four-operation vectors through application, SDK HTTP serialization, and the real MCP adapter. The HTTP fetch is mocked in this suite. |
| `npm run test:coverage` | Focused set: 100% statements/functions/lines and 91.3% branches. This is not application-wide coverage. |
| `npm run build` | Passed with Vite 8.2.1. |
| `npm run audit` and `npm run audit:prod` | High/critical gates passed; two documented moderate React Router 6 advisories remain. |
| `npm run security:scan` | Current-tree forbidden-path and identifier scan passed. |
| `npm run licenses:check` | 511 third-party package entries passed; only the four exact private workspaces present at the time and their verified npm links were exempt as `UNLICENSED`. |
| `git diff --check` | Passed; Git emitted only Windows LF/CRLF conversion notices. |

## Database, gateway, agent, and browser evidence

| Command or boundary | Result |
| --- | --- |
| `npm run db:start && npm run db:reset` | Fresh migration and synthetic seed passed with Edge development configuration loaded. |
| `npm run db:lint` | Passed with zero schema warnings. |
| `npm run test:db` | 244/244 pgTAP assertions across four files. |
| `npm run test:concurrency` | 50/50 isolated two-client races: one success, one `SLOT_UNAVAILABLE`, and one stored confirmed row each. |
| `npm run types:check` | Checked-in generated Supabase types matched the rebuilt local schema. |
| Retired-RPC ACL matrix | `anon`, `authenticated`, and inherited `PUBLIC` execution are denied on the legacy public page, slot, and create RPCs; gateway authority RPCs remain service-role-only. |
| `npm run test:agent-flow` | Live stdio MCP discovery, all four tools, server-recorded confirmation, atomic create, and exact replay passed through the local Edge/DB authority. |
| `npm run test:e2e` | 28 passed, 2 intentional cross-browser project skips. Chromium, Firefox, and WebKit cover the core public flow; Chromium additionally covers fragment clearing and lost-confirm/lost-create retry behavior. |

The authority tests cover FORCE RLS, owner/other mutation matrices, immutable
ownership, schedule/profile serialization, post-lock revalidation, fresh clock,
DST/buffer/notice boundaries, conservative booker validation, preparation and
grant tampering, expiry, confirmation retry, idempotent replay, audit minimization,
retention cleanup, and booking-vs-booking and prepared-commit races.

## Candidate-history evidence

- The final candidate has one reachable root commit and no remotes or tags.
- Candidate-only amendment reflogs and unreachable objects were expired and
  pruned after the exact target repository was verified; `git fsck --full` and
  `git fsck --full --no-reflogs --unreachable` then reported no object errors or
  unreachable objects.
- `git log --all -- .env src/.env` is empty and the reachable object list contains
  no `.env`, `src/.env`, or `src/components/dashboard.zip` artifact.
- Digest-pinned Gitleaks and TruffleHog full-history scans passed against the
  finalized candidate with redacted output and no verified secret finding.
- Ignored local `.env.local`, dependencies, build output, coverage, browser
  reports, and Supabase temp state are not candidate commit objects and must not
  be distributed by copying the working directory wholesale.

## Gates as of the historical run

The license selection, retained-asset clearance, historical Google OAuth
retirement, and separately tested Router 7 upgrade were completed after this
run. The old private repository and its object database remain excluded from
publication.

The following service and supported-release gates remain outside the public
pre-alpha source gate:

1. Prove the production reverse proxy strips spoofed forwarding headers; provide
   production HTTPS/origin/HMAC/Turnstile configuration; run challenge-hostname,
   routing, load/abuse, monitoring, and retention-schedule evidence.
2. Run the shared golden vectors through the actual Edge HTTP router, the full
   DST/stale/idempotency parity matrix, and the documented 50-way UI/API/MCP
   cross-transport collision.
3. Meet application-wide coverage thresholds; current coverage is explicitly a
   focused boundary baseline.
4. Run the pinned official MCP conformance requirements for protocol
   `2026-07-28`.
5. Complete a final synthetic-data preview and obtain explicit owner approval
   before any publication or production cutover.

This dated evidence supports only its tested local implementation boundary. It
is not production or final-public-commit approval.
