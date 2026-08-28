# Project S documentation

This is the front door to Project S Core documentation. Start with the path that
matches what you are trying to do. Documents distinguish current pre-alpha
behavior from future direction; a roadmap item is not a shipped capability.

## I want to understand Project S

- [Product north star and current claims](product/project-s-north-star.md) — the
  long-term direction and the language the current implementation can support.
- [Authority Boundary Demo](authority-boundary-demo.md) — the joined MCP,
  browser, PostgreSQL, replay, and authenticated-host proof.
- [Architecture](architecture.md) — components, trust boundaries, and data flow.
- [Feature status](feature-status.md) — what is included, excluded, or planned.
- [Scheduling engine](scheduling-engine.md) — deterministic time and conflict
  rules.

## I want to run Project S

- [Local development](local-development.md) — prerequisites, setup, and normal
  development commands.
- [Self-hosting](self-hosting.md) — deployment boundary, environment separation,
  and internet-facing gates.
- [Testing](testing.md) — focused checks, database tests, browser tests, and how
  to interpret the evidence.
- [Time zones](timezones.md) — the scheduling time model.
- [Data model](data-model.md) — the current schema and ownership model.

The public pre-alpha does not include a hosted Project S service. Use synthetic
local data while evaluating it.

## I want to integrate it

- [HTTP API v1](api-v1.md) — the four-operation public boundary.
- [TypeScript SDK](../packages/sdk/README.md) — source-workspace client usage.
- [Local stdio MCP](mcp-local-stdio.md) and
  [tool manifest](mcp-tool-manifest.md) — the client-launched MCP adapter.
- [Parity contract](parity-contract.md) — shared behavior across HTTP, SDK, and
  MCP.
- [Public booking capability ledger](adr/public-booking-capability-ledger.md) —
  scopes, operation IDs, and safety gates.
- [MCP compatibility](compatibility-mcp-v1.md) — what is locally tested and what
  is not officially certified.

## I want to contribute

- [Contributing](../CONTRIBUTING.md) — contribution expectations and validation.
- [Governance](../GOVERNANCE.md) and [maintainers](../MAINTAINERS.md) — who decides
  what and how responsibility grows.
- [Support](../SUPPORT.md) — where bugs, questions, ideas, and vulnerabilities
  belong.
- [Public roadmap](../ROADMAP.md) — current outcome milestones and accepted work.
- [ADR process](adr/README.md) — when a durable technical decision is required.
- [Testing](testing.md) — the evidence expected for different kinds of changes.
- [Open issues](https://github.com/EP2-Git/project-s/issues) and
  [Discussions](https://github.com/EP2-Git/project-s/discussions) — actionable
  work and uncommitted questions or ideas.

## I want to evaluate security

- [Security model](security-model.md) — current controls and deployment duties.
- [Agent threat model](agent-threat-model.md) — client, transport, and authority
  threats.
- [Confirmation flow](agent-confirmation-flow.md) — explicit browser authority
  and the locked commit boundary.
- [Privacy](privacy.md) and
  [agent privacy/provenance](agent-privacy-provenance.md) — data minimization and
  disclosure rules.
- [Database authority ADR](adr/0001-agent-native-public-booking-boundary.md) —
  why the final decision remains transactional.
- [Release evidence](release-evidence-0.1.0-prealpha.md) — exact checks for the
  current public prerelease.
- [Security policy](../SECURITY.md) — private vulnerability reporting.

## Release and design context

- [0.1.1 repository operations evidence](repository-evidence-0.1.1-prealpha.md)
  records the public draft, taxonomy, milestones, Issues, Discussions, and
  remaining manual gates.
- [Publication readiness](publication-readiness.md) records source, self-hosted,
  and managed-service gates separately.
- [Cloud Preview 0.1](cloud-preview-0.1.md) is a future private operating plan,
  not a hosted product or public signup promise.
- The [hosted homepage design lab](hosted-homepage-design-lab.md) and
  [selected direction](hosted-homepage-selected-direction.md) are historical
  design records. They do not describe a live hosted service.

If a document conflicts with executable contracts or migrations, treat the code
as current behavior and open a [documentation issue](https://github.com/EP2-Git/project-s/issues/new/choose).
