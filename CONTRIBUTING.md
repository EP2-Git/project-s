# Contributing to Project S

Project S welcomes focused bug reports and contributions. This is public
pre-alpha software, so maintainers may change contracts and are not offering a
production support or compatibility guarantee. The deterministic scheduling and
authorization boundary is the most important invariant.

## Before opening a change

1. Search existing issues and discussions.
2. For a substantial feature or schema change, open a design issue first.
3. Never include real booking data, access tokens, production identifiers, screenshots containing personal information, or copied proprietary assets.
4. Keep Google, notifications, and future AI features optional. The scheduler must work when they are absent.
5. Keep authority and scheduling correctness in Project S Core. Cloud work may
   operate Core, but it may not bypass or relocate those guarantees into a
   proprietary cloud-only path.

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
