# Repository operations evidence — 0.1.1-prealpha

- **Recorded:** 2026-08-27
- **Status:** Public draft; not merged or released
- **Base:** `5144937b8b2070fb1b683ccfb0dd5face0b915a8`
- **Branch:** `codex/public-repo-ux-build-in-public`
- **Draft pull request:** [#24](https://github.com/EP2-Git/project-s/pull/24)
- **Milestone:** [0.1.1-prealpha — Public development foundation](https://github.com/EP2-Git/project-s/milestone/2)

This record makes the public repository operating model reproducible. Mutable
execution status remains in GitHub; this document records the objects created,
their intended contract, and the validation boundary for the draft milestone.

## Repository changes in the draft

The branch is additive from the exact reviewed public base. Its focused commits
before this evidence record are:

1. `8e0ecb1` — lead with the real Authority Boundary proof;
2. `471166c` — add documentation, governance, maintainer, support, and ADR paths;
3. `6c2aec8` — add CODEOWNERS, structured issue forms, and repository checks;
4. `050db54` — publish the evaluation roadmap and unreleased changelog entry; and
5. `da88e2b` — keep the deterministic asset renderer lint-clean.

No migration, RLS, RPC, scheduling, confirmation, idempotency, cancellation,
HTTP, SDK, MCP, or application-runtime file changed.

## Public metadata

- Description: `Open-source authority-bounded booking for humans and agents.
  Browser, HTTP, TypeScript SDK, and local MCP.`
- Homepage URL: intentionally empty; there is no public hosted service.
- Projects: repository feature enabled; the user-owned Project still requires a
  separate interactive OAuth scope and is not represented as complete.
- Topics: `agents`, `booking-api`, `developer-tools`, `human-in-the-loop`,
  `idempotency`, `mcp`, `open-source`, `postgresql`, `scheduling`, `self-hosted`,
  `supabase`, and `typescript`.

## Label taxonomy

Every accepted Issue has exactly one type, at least one area, exactly one
priority, one outcome milestone, and Project fields once the board is live.

**Type:** `type: bug`, `type: feature`, `type: docs`, `type: rfc`, `type: test`,
`type: chore`, `type: feedback`, `type: research`.

**Area:** `area: authority`, `area: scheduling`, `area: database`, `area: api`,
`area: sdk`, `area: mcp`, `area: web`, `area: accessibility`, `area: dx`,
`area: security`, `area: docs`, `area: release`, `area: community`.

**Priority:** `priority: p0`, `priority: p1`, `priority: p2`, `priority: p3`.

**Special:** `good first issue`, `help wanted`, `blocked`, `needs decision`,
`needs reproduction`, `breaking change`, `security sensitive`, `dependencies`.

Thirty missing labels were added. Eight legacy labels remain temporarily because
the issue forms on current `main` still reference `bug` and `enhancement` and
existing automation may rely on the defaults. Remove redundant labels only
after the draft merges and the new forms are active.

## Outcome milestones

No milestone has an invented due date.

| Milestone | Goal | Initial Issues |
| --- | --- | ---: |
| [0.1.1-prealpha — Public development foundation](https://github.com/EP2-Git/project-s/milestone/2) | Project S development is understandable and actionable in public: outsiders can inspect the proof, run the system, follow accepted work and durable decisions, contribute through explicit paths, and report reproducible feedback without private explanation. | 14 |
| [0.2.0-prealpha — Delegated authority foundation](https://github.com/EP2-Git/project-s/milestone/3) | Define and prove bounded, revocable authority beyond one per-booking browser approval. | 2 |
| [0.3.0-prealpha — Bilateral agent proof](https://github.com/EP2-Git/project-s/milestone/4) | Independently authorized guest-side and host-side agents coordinate one valid booking with human step-up outside mandate. | 1 |

## Seeded actionable Issues

| Issue | Milestone |
| --- | --- |
| [#2 Improve the first 60 seconds of the README](https://github.com/EP2-Git/project-s/issues/2) | 0.1.1 |
| [#3 Add a public Authority Boundary overview image](https://github.com/EP2-Git/project-s/issues/3) | 0.1.1 |
| [#4 Create the Project S public roadmap and issue taxonomy](https://github.com/EP2-Git/project-s/issues/4) | 0.1.1 |
| [#5 Add a documentation index and contributor navigation](https://github.com/EP2-Git/project-s/issues/5) | 0.1.1 |
| [#6 Add governance, maintainer ownership, and support routing](https://github.com/EP2-Git/project-s/issues/6) | 0.1.1 |
| [#7 Expand structured issue forms for evaluation, docs, RFCs, and accessibility](https://github.com/EP2-Git/project-s/issues/7) | 0.1.1 |
| [#8 Create a one-command local bootstrap and diagnostic doctor](https://github.com/EP2-Git/project-s/issues/8) | 0.1.1 |
| [#9 Verify clean installation on Windows, macOS, and Linux](https://github.com/EP2-Git/project-s/issues/9) | 0.1.1 |
| [#10 Add runnable HTTP, TypeScript SDK, and MCP examples](https://github.com/EP2-Git/project-s/issues/10) | 0.1.1 |
| [#11 Add CodeQL and pull-request dependency review](https://github.com/EP2-Git/project-s/issues/11) | 0.1.1 |
| [#12 Expand coverage beyond the current focused module set](https://github.com/EP2-Git/project-s/issues/12) | 0.1.1 |
| [#13 Publish a design-partner evaluation guide](https://github.com/EP2-Git/project-s/issues/13) | 0.1.1 |
| [#14 Produce a 25–40 second public Authority Boundary proof clip](https://github.com/EP2-Git/project-s/issues/14) | 0.1.1 |
| [#15 Refresh repository social preview and public metadata](https://github.com/EP2-Git/project-s/issues/15) | 0.1.1 |
| [#16 RFC: authority-provider interface and bounded mandate model](https://github.com/EP2-Git/project-s/issues/16) | 0.2.0 |
| [#17 Property-based adversarial tests for delegated authority](https://github.com/EP2-Git/project-s/issues/17) | 0.2.0 |
| [#18 Epic: independently authorized guest-agent and host-agent booking proof](https://github.com/EP2-Git/project-s/issues/18) | 0.3.0 |

Issue metadata was read back after creation: all 17 have exactly one `type:*`,
exactly one `priority:*`, at least one `area:*`, and one milestone. Project
Status, Area, Priority, and Effort remain a declared follow-up until Project OAuth
is approved and the public board exists.

## Public Discussions

- [#19 What Project S Core proves today](https://github.com/EP2-Git/project-s/discussions/19)
- [#20 Where Project S is going: secure agent-to-agent booking](https://github.com/EP2-Git/project-s/discussions/20)
- [#21 How to evaluate 0.1.0-prealpha](https://github.com/EP2-Git/project-s/discussions/21)
- [#22 Public roadmap and how work moves from idea to issue](https://github.com/EP2-Git/project-s/discussions/22)
- [#23 Security reporting rules](https://github.com/EP2-Git/project-s/discussions/23)

The current API could create posts in existing categories. Creating `Design
partners` and `RFC discussion` categories and pinning selected posts require
GitHub UI work and remain explicit review-gated follow-up.

## Validation evidence

- Real synthetic Authority Boundary capture: 1 joined Chromium scenario passed.
- `npm run docs:check`: 50 Markdown files and 6 issue forms passed.
- All 7 issue-template YAML files parsed successfully.
- `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` passed.
- Test totals: 70 root, 13 contracts, 7 application, 8 SDK, 14 MCP, and 16
  parity tests.
- `npm run audit:prod`: 0 vulnerabilities.
- `npm run security:scan`: no forbidden path or identifier.
- `npm run licenses:check`: 520 installed package entries reviewed.
- `git diff --check`: passed.
- The Authority Boundary overview was inspected at its 780×2727 full resolution
  and at a 390×1364 mobile render. Its state labels, explanatory captions, and
  footer remain readable without clipping, and its alt text describes all four
  states.

## Review gates not crossed

- The draft pull request is not merged.
- `v0.1.0-prealpha` and its tag/release assets are unchanged.
- Protected `main` rules, required checks, Actions policy, visibility, and
  security controls are unchanged.
- The social-preview candidate is tracked for review but not uploaded.
- The user-owned GitHub Project, custom views, workflow automation, missing
  Discussion categories, and pins are not complete.
- No hosted deployment, Cloud change, public signup, npm publication, provider
  integration, or product-core feature was created.
