# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Cross-platform clean-install smoke (`npm run test:install-smoke`) and a CI
  matrix on Ubuntu, macOS, and Windows, plus an install-verification checklist
  for full Docker-backed local runs.
- A repository-level Authority Boundary overview generated from the real
  synthetic MCP/browser/PostgreSQL capture path.
- Documentation navigation, public roadmap, governance, maintainer, support,
  ADR, and structured evaluation-feedback surfaces.

### Changed

- Reordered the README around a sixty-second product explanation, current versus
  future capability, local evaluation paths, and scoped engineering evidence.
- Documented the public work-object contract for Discussions, Issues, Projects,
  milestones, pull requests, releases, ADRs, the README, and this changelog.

## 0.1.0-prealpha - 2026-08-26

Public source pre-alpha. This is not a production-ready or supported release.

### Security

- Rechecking preparation and confirmation expiry after waiting on the
  authoritative host lock.
- Replacing public booking-row reads with a safe free-slot boundary.
- Replacing client-only conflict checks with an atomic database booking operation.
- Starting the public repository from a clean, parentless history that excludes
  private environment configuration and production identifiers.
- Removing unaudited Google Calendar and notification Edge Functions from the v1 baseline.

### Added

- A reproducible Authority Boundary Demo joining real MCP preparation, explicit
  browser approval, locked commit, idempotent replay, and authenticated host
  cancellation.
- Reproducible local Supabase schema, seed, and database test plan.
- Node, unit, browser, accessibility, dependency, and publication-safety gates.
- Apache-2.0 licensing, contributor, security, architecture, self-hosting,
  provenance, and Core/Cloud boundary documentation.
- A bounded Project S Cloud Preview 0.1 private-staging plan.

### Changed

- Standardized the project on Node 22 and npm.
- Upgraded the Vite/Supabase toolchain while retaining React 18, Tailwind 3, and
  Zod 3, then moved to React Router 7 after the full release-candidate CI matrix
  passed.

### Removed

- Private-history artifacts, ignored environments, credentials, generated demo
  evidence, and retired build-provider integrations from the clean public root.
