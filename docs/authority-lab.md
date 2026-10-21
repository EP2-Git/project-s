# Authority Lab

Authority Lab is a browser-only simulation of the human-agent partnership planned
for Project S. Open `/demo/mandates` on a running local app, or follow **Open
Authority Lab** from `/demo`. It is available in both application audiences.

The lab creates no real booking, credential, permission or approval. It sends no
booking API requests and stores no state outside the current page. Reloading or
resetting starts a new synthetic scenario. The existing [Authority Boundary
Demo](authority-boundary-demo.md) remains the separate path for real local
MCP/browser/PostgreSQL evidence.

## Try a bounded request

1. Keep the initial limits and choose **Within permission** as the request
   scenario. Prepare the request, inspect the result, then commit the simulated
   booking. Preparation alone must leave the booking count at zero.
2. Retry the same request. The receipt stays the same and the count remains one.
   Revoke the permission and retry again: a valid receipt can still be returned,
   while revoking the agent key prevents even receipt access.
3. Reset, choose the request outside the booking window, and prepare it. Review
   the difference and approve that exact request. Commit the replacement
   preparation; this does not create a second reusable permission budget.
4. Reset, prepare, and advance the clock by twenty minutes. The original
   permission has expired, so commit is refused without creating a booking.
5. Reset and prepare again. Change slot availability before committing. The
   refusal consumes no booking; restoring the slot permits the still-valid
   request to succeed.

The clock starts at a fixed synthetic instant. Time advances only through the
clock controls, making outcomes reproducible. Pending review and preparations
also expire. The activity list records synthetic actions and concise outcomes;
it does not display real agent activity or private reasoning. Host cancellation
is simulated and does not restore a spent use.

## What this proves

The pure reducer and its deterministic adversarial tests exercise model-level
scope, caller binding, expiry, revocation, exact approval, single use,
idempotency, cancellation and refusal transitions. Browser tests exercise the
visible workflow, keyboard use, narrow layouts and accessibility. The production
bundle smoke test checks that the lazy-loaded route renders in all three browser
engines.

These checks do not establish database isolation, a real two-client race,
credential verification, RLS, transport parity or independent evaluation.
[Issue #17](https://github.com/EP2-Git/project-s/issues/17) remains unfinished.
The accepted [authority design](adr/0003-authority-provider-bounded-mandates.md)
and [implementation decisions](adr/0004-bounded-mandate-implementation.md) still
require production implementation and proof before delegated booking can be
enabled. Public v1 keeps its existing four operations.

## Interface direction

This is an early interaction pattern for the future Cloud interface: visible
limits, a clear prepare/commit distinction, exact human approval, and a readable
activity trail. It is not an authorized monitoring service. Real sign-in,
monitoring roles, principal isolation, event retention and live control need
their corresponding authority contracts and backend enforcement. Calendar,
notification and guest lifecycle integrations remain separate product work.

Run the focused checks with:

```sh
npx vitest run tests/unit/authority-lab-model.test.ts
npx playwright test tests/e2e/authority-lab.spec.ts
npm run test:built-app
```

The browser checks use the normal local app configuration described in
[Testing](testing.md). No Docker-backed booking service is required for the lab
itself.
