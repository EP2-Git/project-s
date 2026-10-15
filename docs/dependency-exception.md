# Dependency security review

## Resolved React Router 6 moderate advisories

Recorded: 2026-08-19

Resolved: 2026-08-26

Owner: Project S maintainer

The publication candidate initially retained React Router 6 under a dated,
medium-severity advisory exception because the available remediation required a
major upgrade.

That exception is closed. React Router and React Router DOM were upgraded to
`7.18.2` through a reviewed private-staging change after the quality,
reproducible database/RLS, and browser/accessibility jobs passed on the rebased
tree. At that time, `npm audit` reported zero known vulnerabilities and GitHub
reported no open Dependabot alerts. See the current review below.

The original exception remains documented here as release history; it is not an
active risk acceptance.

## 2026-10-15 Tailwind toolchain migration

The full dependency audit initially reported eleven findings (seven high, four
moderate). Compatible lockfile patches reduced that to nine. The remaining
Tailwind 3 chain included unpatched `braces` and older selector-parser versions.

Ethan approved migrating the toolchain while preserving the app's appearance
and behavior, with merging conditional on the complete pipeline passing.
[ADR 0002](adr/0002-tailwind-4-build-toolchain.md) records the scope, browser
compatibility floor and rollback.

Tailwind 4 and its PostCSS integration replace the affected build chain.
The unused, unregistered typography package is removed; tailwind-merge 3
understands the migrated utility grammar. The full and production-only audits
both report zero findings on the migration candidate. No advisory exception,
audit suppression, forced transitive override or required-check relaxation is
included. Audits are dated evidence and must continue to run on every candidate.

## Non-advisory upgrade watchlist

- Vite reports that `@vitejs/plugin-react` may be faster than the retained SWC plugin when no custom SWC plugins are configured. This is a performance-maintenance note, not a correctness or security exception.

The publication workflow runs Gitleaks 8.29.1 from an immutable container digest. Gitleaks 8.30.1 was not adopted because of an [open upstream default-rule regression](https://github.com/gitleaks/gitleaks/issues/2170). Re-evaluate the pin after that regression is resolved; TruffleHog remains the independent verified-secret scanner.

Review these watchlist items before a supported release and sooner if a relevant
advisory or upstream correction is published.
