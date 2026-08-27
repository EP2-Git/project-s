# Project S public roadmap

The roadmap groups work by verifiable outcomes, not arbitrary dates. It does not
promise release timing or turn future direction into current capability.

## Now — 0.1.1-prealpha: Evaluation-ready repository

**Goal:** a technically competent stranger can understand Project S, clone it,
run the real synthetic authority flow, find contribution and support paths, and
report useful feedback without private explanation from the maintainer.

Current outcome areas:

- a clear first 60 seconds in the README;
- truthful static Authority Boundary proof;
- documentation, governance, ADR, support, and maintainer navigation;
- one-command setup diagnostics and cross-platform clean-install evidence;
- runnable HTTP, TypeScript SDK, and MCP examples;
- a design-partner evaluation guide;
- public labels, milestones, issues, Discussions, and execution views; and
- scoped security, dependency-review, coverage, and public proof follow-up.

The live source of execution truth is the
[0.1.1 milestone](https://github.com/EP2-Git/project-s/milestone/2) and its linked
Issues. Items merged before the milestone closes will be recorded in the
[changelog](CHANGELOG.md).

## Next — 0.2.0-prealpha: Delegated authority foundation

**Goal:** define and prove bounded, revocable authority beyond one per-booking
browser approval.

This phase begins with an RFC for an authority-provider interface and mandate
model. It must cover scope, expiry, revocation, step-up, audit, privacy,
database/RLS impact, compatibility, and explicit non-goals before product-core
implementation. Property-based adversarial tests follow an approved design.

Standing mandates and automatic delegated commit are future work, not features
in `0.1.x`. Track the decision boundary in the
[0.2.0 milestone](https://github.com/EP2-Git/project-s/milestone/3).

## Later — 0.3.0-prealpha: Bilateral agent proof

**Goal:** independently authorized guest-side and host-side agents coordinate one
valid booking through deterministic commit, with human step-up outside mandate.

This remains one epic until the delegated-authority foundation is approved. The
roadmap deliberately does not invent detailed federation or negotiation work in
advance. Track the single epic in the
[0.3.0 milestone](https://github.com/EP2-Git/project-s/milestone/4).

## Managed Cloud boundary

A generally available Project S Cloud, public signup, billing, production
traffic, provider integrations, notifications, and remote MCP are not part of
these Core milestones. Cloud milestones stay in the private Cloud repository.
Core correctness and self-hostability cannot become Cloud-only features.

## How to participate

- Ask questions or test an uncommitted idea in
  [Discussions](https://github.com/EP2-Git/project-s/discussions).
- Work from an accepted [Issue](https://github.com/EP2-Git/project-s/issues) or
  propose a focused change.
- Read [governance](GOVERNANCE.md), [contributing](CONTRIBUTING.md), and the
  [ADR process](docs/adr/README.md) before changing authority or contracts.

Project status answers *where work is*. Milestones answer *which outcome it
serves*. Neither is a production-readiness claim.
