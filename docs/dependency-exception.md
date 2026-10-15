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

## 2026-10-15 audit remediation (pending complete resolution)

The full dependency audit reported eleven findings (seven high, four moderate).
Compatible lockfile updates move `brace-expansion` to patched versions
`1.1.21`, `2.1.7` and `5.0.12`, `source-map-js` to `1.2.2`, and `fast-glob`
to `3.3.3`. Direct dependency ranges and workflow permissions are unchanged.

The resulting full audit still reports nine findings (five high, four moderate)
through the retained Tailwind 3 development toolchain. In particular,
[the braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
has no patched release as of this review. The selector-parser advisory affects
older major versions used by the toolchain. A production-only audit reports zero
findings; that does not make the full dependency tree clean.

This is **not** an advisory exception. Keep the full audit gate and required
checks intact. Do not merge a candidate while they fail. Further remediation
needs a reviewed toolchain migration or an upstream compatible fix, rather than
an unsupported transitive override or `npm audit fix --force`. Tailwind 4 changes
browser requirements and CSS behavior, so its migration needs explicit
compatibility review and browser evidence.

## Non-advisory upgrade watchlist

- `glob@10.5.0` is an install-time transitive dependency of the retained Tailwind CSS 3 toolchain through Sucrase. npm prints a deprecation warning. The current full audit has the findings described above; the deprecation warning is separate. Do not force an unsupported transitive override; remove it through a reviewed upstream/Tailwind toolchain upgrade.
- Vite reports that `@vitejs/plugin-react` may be faster than the retained SWC plugin when no custom SWC plugins are configured. This is a performance-maintenance note, not a correctness or security exception.

The publication workflow runs Gitleaks 8.29.1 from an immutable container digest. Gitleaks 8.30.1 was not adopted because of an [open upstream default-rule regression](https://github.com/gitleaks/gitleaks/issues/2170). Re-evaluate the pin after that regression is resolved; TruffleHog remains the independent verified-secret scanner.

Review these watchlist items before a supported release and sooner if a relevant
advisory or upstream correction is published.
