# ADR 0002: Tailwind 4 build toolchain

- Status: Accepted for implementation; merge requires the complete CI pipeline.
- Date: 2026-10-15
- Decision owner: Ethan Patten
- Scope: development/build dependencies and browser styling compatibility

## Context

The retained Tailwind 3 toolchain pulls in `braces` with an unpatched high
severity denial-of-service advisory, plus vulnerable selector-parser versions.
Compatible lockfile patches reduce but cannot clear the full audit. Ethan
explicitly approved the toolchain migration, preserving app appearance and
behavior, with merging conditional on the full pipeline passing.

## Decision

Use Tailwind CSS 4.3.3 and its matching PostCSS integration. Move theme tokens,
animations, dark variant and container configuration into `src/index.css`.
Retain the existing animation plugin; remove the unregistered typography
dependency and redundant Autoprefixer integration. Use tailwind-merge 3 for the
new utility grammar. Translate utility names without changing React state,
authorization, scheduling, database schema or public contracts.

Preserve following-sibling form spacing for inline labels, the existing border
defaults, button cursor behavior, shadows, radii and focus outlines. Compare
before/after browser captures and run the existing responsive, keyboard,
accessibility and joined booking-flow checks. Keep full dependency audits and
all required checks enabled.

Tailwind 4's documented browser floor is Safari 16.4, Chrome 111 and Firefox 128.
This is a browser compatibility change, not a promise of support on older
browsers. The pre-alpha does not gain production readiness from this migration.

## Alternatives

- Remain on Tailwind 3: retains an unpatched dependency and failing audit gate.
- Force transitive replacements or suppress advisories: obscures or introduces
  compatibility risk and does not satisfy the existing security gate.
- Rewrite the UI without Tailwind: substantially larger scope with unnecessary
  visual and interaction risk.

## Rollback and verification

Revert the migration commit as a unit, including lockfile, CSS and utility
translations. That restores the old toolchain and its known audit failures;
rollback must not be represented as resolving the advisories. No database
migration or data rollback is needed.

Local visual comparisons are synthetic browser evidence, separate from hosted
CI's database/RLS, all-OS install smoke, concurrency and browser suites. Record
the exact candidate head and actual results in the PR before merging.

Production smoke testing also reproduced a blank-page module initialization
failure in the pre-migration build. Remove the manual vendor-size splitting
group so Rolldown preserves dependency initialization order. Keep lazy route
imports and hosted/self-hosted separation. Add a production-bundle smoke gate
in all three browser engines; development-server tests alone missed this fault.

References: [upgrade guide](https://tailwindcss.com/docs/upgrade-guide),
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
