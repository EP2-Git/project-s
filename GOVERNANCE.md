# Project S governance

Project S is an open-source public pre-alpha. Governance is intentionally simple
while one lead maintainer carries the release and security responsibility.

## Current decision authority

Ethan Patten (`@EP2-Git`) is the current lead maintainer. The lead maintainer has
final say over:

- product direction and release readiness;
- security and privacy policy;
- scheduling and authority semantics;
- database schema and RLS boundaries;
- public contracts and compatibility decisions;
- project naming, trademarks, and licence changes; and
- what may be represented as shipped, supported, or production-ready.

This authority is a maintenance responsibility, not permission to bypass the
reviewed database or application boundaries.

## How work moves

Project S uses different public objects for different commitments:

| Object | Purpose |
| --- | --- |
| Discussions | Questions, evaluation reports, and ideas that have not been accepted as work. |
| Issues | Actionable work with an owner-independent problem and acceptance criteria. |
| GitHub Project | Execution state, priority, area, and effort for accepted work. |
| Milestones | Outcome and release grouping; not arbitrary deadlines. |
| Pull requests | Reviewed implementation and its evidence. |
| Releases | Shipped source or artifacts with explicit boundaries. |
| ADRs/RFCs | Durable technical decisions and rejected alternatives. |
| README | First impression and navigation, not the full specification. |
| Changelog | User-visible changes after they ship. |

Concrete implementation should happen through Issues and pull requests. A
Discussion can become an Issue after the problem and outcome are accepted.

## Changes that require an RFC or ADR

Open an RFC/design proposal before implementation when a change affects:

- public contracts or versioning;
- PostgreSQL authority, migrations, grants, or RLS;
- confirmation, delegation, mandate, or revocation semantics;
- privacy, retention, or a data boundary;
- Core/Cloud separation;
- compatibility or migration policy; or
- a security assumption relied on by more than one component.

The [ADR index and template](docs/adr/README.md) define the durable record. An
urgent vulnerability can be fixed privately first, but the non-sensitive design
decision should be recorded after disclosure is safe.

## Maintainers and review

Outside maintainer responsibility is earned through sustained, technically
sound contributions, careful review, and reliable handling of security and
community responsibilities. The lead maintainer may delegate an area without
delegating final release or security accountability.

`CODEOWNERS` documents who should review sensitive areas. Mandatory Code Owner
approval is deliberately not enabled while Ethan is the only trusted maintainer;
requiring the sole owner to approve their own pull request would add ceremony
without independent review. Revisit that setting when at least two trusted
maintainers can provide meaningful separation of duties.

## Core and Cloud

Scheduling correctness, authority enforcement, public contracts, and
self-hostability belong in Project S Core. They must not be moved into or made
dependent on proprietary Cloud-only logic. A future managed service may operate
Core and add separate operational capabilities, but it may not bypass Core's
authority boundary.

## Changing governance

Governance changes require a public Issue, a pull request, and an explanation of
the effect on contributor rights and maintainer accountability. Licence changes
require explicit lead-maintainer approval and must respect all existing licence
obligations.
