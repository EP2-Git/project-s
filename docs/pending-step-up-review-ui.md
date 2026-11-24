# Pending approval review component

The booking approval link needs a usable review as well as its private HTTP
foundations. `src/features/step-up-review/StepUpReview.tsx` now implements the
pending-request component and action controller using the accepted
[ADR 0004 C2](adr/0004-bounded-mandate-implementation.md) controls. It is not
imported by the application routes. `/authority/review` remains unavailable;
there is no new environment switch, served v2 endpoint or synthetic enablement.

## Human review and recovery

The component presents the recorded host, meeting, start/end, duration,
reviewed time zones, name/email and reasons extra approval is needed. It uses
existing components, readable labels, wrapping layouts, visible keyboard focus
and large action targets. There is no required walkthrough or global shortcut
that approves a request. A requester name is not invented: that separate
visibility proposal is still unaccepted.

Approval submits the captured review ID, revision and digest. Pending Decline
submits the captured revision to the existing revoke action. The explanation
distinguishes exact one-use permission from a held slot or confirmed booking,
and explains what happens to the original permission. Only verified action
acknowledgements produce the local approval/decline outcomes.

If an action response is lost or cannot be verified, only that same action and
input can be retried. The opposite control stays disabled; retry does not read
the pending-only GET or depend on its old deadline. Contention waits for the
existing one-second retry advice without automatically resubmitting. A generic
conflict or reopening an unavailable request produces neutral recovery, not an
inferred approved, declined, expired, used or revoked state.

Changing the review, session key or client identity resets the component before
old private details can render. Logout removes them immediately. Requests are
aborted and delayed results ignored. Captured details/inputs exist only in
component memory, never browser storage, logs, analytics or URL payloads.
The session key is a UI reset signal; it does not authenticate or authorize.

Reviewed zones and exact instants are preserved. If component formatting fails,
the display labels its UTC fallback and shows the original zone/instant rather
than silently substituting a zone. The client still applies the shared strict
schema; an unsupported response remains unverifiable rather than being
rewritten. Device time does not establish a terminal state or authorize a booking.

## Explicit private client

`src/services/stepUpReviewClient.ts` exports an explicitly constructed client
for the existing [GET](private-step-up-review-http.md) and
[approve/revoke](private-step-up-actions-http.md) factories. Trusted integration
code must supply the configured app origin and account bearer, and replace the
client/session key when that account/session changes. There is no environment
singleton, publishable-key fallback, caller context or v1 provider fallback.
The server must still freshly verify the account and all permissions.

Requests omit cookies/referrers, disable caching and reject redirects. Both
success and problem bodies are read with bounded streaming and cancellation.
A 30-second deadline covers fetch and body reading. Timeout leaves an action's
result uncertain and preserves its exact retry; it never automatically resubmits.
The client budget conservatively covers the current fixed serializers: finite
snapshot scalars, four differences constructed by the preparation SQL from
usernames/titles/time ranges/durations, envelope strings, JSON structure and
worst-case escaping. It is not a general bound derived from v2's unbounded
difference-text schema or the unrelated v1 response budget. Reassess it if the
server producers change. Unknown, oversized or malformed action responses
remain uncertain; raw problem diagnostics never become UI copy. Strict v2
envelopes, review identity and revoke revision are checked before acknowledging.

## Verification and remaining work

Unit tests exercise the actual controller/client, cancellation, exact input,
stale responses, logout, contention, refusals and uncertain-result recovery.
The test-only HTML entry under `tests/fixtures/step-up-review/` runs the real
component and client against Playwright's synthetic HTTP responses. It labels
that evidence, checks phone and keyboard use, Axe and responsive layout, and
captures screenshots. With packages built and the usual local test environment:

```sh
npx vitest run tests/unit/step-up-review-client.test.ts tests/unit/step-up-review.test.tsx
npx playwright test tests/e2e/step-up-review.spec.ts
```

The fixture is not a production entry, a genuine signed-in approval link, live
Auth/SQL proof or independent usability evaluation. The ordinary application
route remains unavailable. A separate [live HTTP proof](live-step-up-http-proof.md)
joins the actual client, private factories, fresh Auth and SQL in a disposable
test listener. Its optional browser variant uses actual sign-in/auth-return and
review screens against that boundary with phone/keyboard and safe-retry checks.
Normal application account wiring and served routing, separate reviewed
synthetic enablement, design acceptance and implementation of terminal
reconciliation/requester visibility, agent continuation and a confirmed booking
receipt remain necessary for the complete experience. Public-service/Cloud
operation is separately gated.
