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
tree. `npm audit` now reports zero known vulnerabilities and GitHub reports no
open Dependabot alerts for the candidate.

The original exception remains documented here as release history; it is not an
active risk acceptance.

## Non-advisory upgrade watchlist

- `glob@10.5.0` is an install-time transitive dependency of the retained Tailwind CSS 3 toolchain through Sucrase. npm prints a deprecation warning, but the final full and production audits contain no high/critical finding for it. Do not force an unsupported transitive override; remove it through a reviewed upstream/Tailwind toolchain upgrade.
- Vite reports that `@vitejs/plugin-react` may be faster than the retained SWC plugin when no custom SWC plugins are configured. This is a performance-maintenance note, not a correctness or security exception.

The publication workflow runs Gitleaks 8.29.1 from an immutable container digest. Gitleaks 8.30.1 was not adopted because of an [open upstream default-rule regression](https://github.com/gitleaks/gitleaks/issues/2170). Re-evaluate the pin after that regression is resolved; TruffleHog remains the independent verified-secret scanner.

Review these watchlist items before a supported release and sooner if a relevant
advisory or upstream correction is published.
