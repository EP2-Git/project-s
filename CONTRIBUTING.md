# Contributing to Project S

Project S welcomes focused bug reports and contributions. This is public
pre-alpha software, so maintainers may change contracts and are not offering a
production support or compatibility guarantee. The deterministic scheduling and
authorization boundary is the most important invariant.

## Before opening a change

1. Search existing issues and discussions.
2. Ask usage questions and test uncommitted ideas in Discussions. Work from an
   accepted Issue when the outcome is ready for implementation.
3. For a public-contract, schema/RLS, authority, privacy, Core/Cloud, or
   compatibility change, open an RFC/design proposal and follow the
   [ADR process](docs/adr/README.md) before implementation.
4. Never include real booking data, access tokens, production identifiers, screenshots containing personal information, or copied proprietary assets.
5. Keep Google, notifications, and future AI features optional. The scheduler must work when they are absent.
6. Keep authority and scheduling correctness in Project S Core. Cloud work may
   operate Core, but it may not bypass or relocate those guarantees into a
   proprietary cloud-only path.

Read the [documentation index](docs/README.md), [governance](GOVERNANCE.md),
[support routing](SUPPORT.md), and [public roadmap](ROADMAP.md) before proposing
broad work.

## Development

Follow [local development](docs/local-development.md). Create a branch, make one coherent change, and add tests at the lowest useful level:

- pure scheduling rules: Vitest;
- schema, RLS, and database functions: pgTAP under `supabase/tests`;
- concurrent booking behavior: independent-client integration test;
- user-visible flows and accessibility: Playwright/Axe.

Before requesting review, run:

```sh
npm run check
npm run db:lint
npm run test:db
npm run test:concurrency
npm run types:check
npm run test:e2e
```

## Pull request requirements

- Use a focused title beginning with `feat`, `fix`, `docs`, `test`, `refactor`,
  `chore`, or `security`. Squash titles become permanent history.
- Explain the problem and why the chosen design preserves security and scheduling correctness.
- Include test evidence and any migration/rollback implications.
- Update public documentation when configuration, behavior, privacy, or deployment changes.
- Do not weaken RLS, browser accessibility, secret scanning, or concurrency checks to make a test pass.
- Keep generated Supabase types synchronized with migrations.

## Compatibility

Backward compatibility is useful but not more important than security or a coherent schema. Breaking changes need a migration note and release-note entry.

By submitting an intentional contribution, you represent that you have the right
to submit it and license it under the [Apache License 2.0](LICENSE), with the same
inbound and outbound terms and no additional restrictions. Do not submit a
contribution under incompatible terms; maintainers will not accept an opt-out by
issue, pull-request, commit, or source-file notice.
