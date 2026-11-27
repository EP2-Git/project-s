# Live step-up HTTP integration proof

The [pending review component/client](pending-step-up-review-ui.md) and private
[read](private-step-up-review-http.md)/[action](private-step-up-actions-http.md)
factories previously had separate evidence: browser/HTTP doubles, and direct
Auth-to-RPC tests. The disposable live-authority script now joins the actual
client, native HTTP, those factories, fresh local Auth verification and real SQL.
It implements proof under [ADR 0004](adr/0004-bounded-mandate-implementation.md);
it does not enable the normal application route or general delegated writes.

## Guarded setup and teardown

The existing `npm run test:authority:live` command still requires
`PROJECT_S_DISPOSABLE_AUTHORITY_TEST=1`, a verified bootstrap ownership marker,
the exact owned local project and loopback Supabase API, required migrations and
an empty authority instance. It never resets an existing database. Do not point
it at customer data or treat an unavailable Docker engine as integration proof.
CI runs it in the existing disposable database job.

After those checks, a test-only listener binds `127.0.0.1` on an ephemeral port.
It refuses actions until the locked empty-instance insert succeeds. Its origin
is selected as the synthetic audience before any fixture principal context or
credential is created; an established instance is never reconfigured. Only the
existing GET and action factories are dispatched. Foreign Host/Origin, absolute
targets and inappropriate GET bodies cannot become authority inputs. The bridge
streams bodies, propagates cancellation and imposes bounded request deadlines.

Shutdown closes connections and waits for asynchronous handlers to finish,
including work that ignores the request's cancellation signal. Only then may
owned fixture deletion proceed. If quiescence cannot be established within the
bounded deadline, the proof fails and withholds SQL cleanup rather than racing
an in-flight transaction. The guarded instance must then be handled by its owned
disposable-stack teardown; rerunning against unexpected state is refused.
Successful runs remove their random accounts/authority fixtures and listener.
Diagnostics contain fixed stage labels, never bearer tokens, snapshots or SQL
errors. This is not a production listener, configuration loader or CORS grant.

## Joined scenarios

The script reuses existing fixtures, assertions and audit totals:

- The owner client reads the same exact pending snapshot over HTTP. Counters
  wrap real `getUser` and service RPC calls; they never supply a fabricated user.
- Foreign and missing references share a redacted refusal. Invalid/actor
  credentials, foreign Origin, client identity overrides and stale revision or
  digest cannot authorize a write.
- A real approval transaction finishes before its HTTP response is deliberately
  dropped. The client reports uncertainty. Retrying the identical action freshly
  verifies the account and returns the preparation/deadline read independently
  from SQL, with one grant and unchanged event sequence. Approval is still
  permission, not a booking or held slot.
- Pending Decline and its exact retry preserve otherwise-valid original
  permission. After account deletion, the old bearer is rejected before RPC.

The original direct adapter checks and exact audit totals remain binding. The
new transport groups report separately; no extra mandates are created just to
inflate test counts. The actual client source runs under the existing Node
strip-types invocation, without a rewritten client, new runtime flag or compiler
copy. Its error constructor uses equivalent explicit fields for that runtime.

Bridge-only tests use doubles and are distinct from the joined live proof:

```sh
npm run build:packages
node --test tests/setup/step-up-http-proof.test.mjs tests/setup/step-up-client-runtime.test.mjs
```

## Disposable browser journey

The optional `--browser` proof joins the existing `Login`, `useAuth`, safe auth
return helpers and `StepUpReview` to the same real Auth/HTTP/SQL boundary:

```sh
PROJECT_S_DISPOSABLE_AUTHORITY_TEST=1 npm run test:authority:live -- --browser
```

Use an already bootstrapped, verified disposable local stack and install Chromium
with `npx playwright install --with-deps chromium`. The environment assignment
above uses POSIX shell syntax; in PowerShell set
`$env:PROJECT_S_DISPOSABLE_AUTHORITY_TEST = '1'` before running the npm command.
All the existing ownership, schema and empty-instance guards still apply. The
database CI job runs this variant; it does not substitute for any earlier check.

After those guards, a separate test-only Vite entry is built in memory with only
the exact local Auth URL and anonymous public key. It imports the actual screens,
not the normal App router, and exposes only its built assets and fixture review
and login pages on the ephemeral loopback listener. There is no disk bundle,
dev server, CORS workaround, normal route change or configurable deployment.
The listener still refuses requests until the instance is locked/configured.

The phone journey starts signed out at an opaque review link, uses the ordinary
password sign-in form, returns to that exact request, and displays details from
the verified pending response. A separate real
account cannot see them. The desktop journey declines a different pending
request through focused keyboard controls; SQL checks that the original
permission remains valid and no replacement grant was created.

A later browser approval deliberately loses its successful response after SQL
commit. The same mounted screen retries the exact action without a GET preflight.
Independent SQL reads verify the original preparation/deadline, one grant and an
unchanged event sequence. The UI acknowledges permission, never a booking. A
reload uses neutral unavailable recovery rather than inferring a terminal state.
Existing fixture/audit totals and subsequent direct-adapter checks still apply.

The browser driver uses real normal sign-in, not injected tokens, storage state
or mocked HTTP. It never records traces, HAR, Auth headers or password forms.
Axe, responsive bounds, keyboard behavior and screenshots of synthetic review
states provide agent-run evidence; screenshots are not independent usability
evaluation. Accessibility scans wait for actual finite UI animations to finish,
then check the whole page, including the sign-in toast; no rules or elements are
excluded. Browser contexts close before listener quiescence and owned SQL
cleanup. An uncertain shutdown withholds cleanup and fails the proof.

The original loaded phone page is retained only for the final private-state
clearing check; it is not treated as a fresh or usable review after later
backend changes. Its real global sign-out runs after all original authenticated
RPC checks, then removes those details and returns to sign-in. This deliberately
orders the destructive session boundary last; it does not replace account
tokens, change logout scope or weaken fresh verification/direct-RPC denials.

## The original agent resumes the approved request

The test listener also serves `GET /api/v2/delegated/step-ups/{reviewId}` to
the original agent. It freshly verifies the agent credential and rechecks the
request and its supporting authority under the principal lock. Pending returns
only the review reference, state and deadline. A usable approval adds the
preparation reference and reports the approval's deadline. The read does not
hold a slot, consume permission or grant access to the human review details.
Other agents, missing requests and requests that can no longer be used receive
the same refusal. Account sessions cannot access the agent operation.

The agent starts by posting the mandate ID, host username, meeting type and exact
start time to `/api/v2/delegated/bookings/prepare` using its own credential. For
an in-scope request the listener returns a private preparation with `notHeld: true`
and a summary without booker name or email. For a request that needs approval it
returns `428 STEP_UP_REQUIRED` with a same-origin review link, reference and deadline.
The proof resends each request and verifies the original reference and deadline.
Neither preparation nor escalation spends a booking use or holds the time.

The live proof uses the review link from that escalation for browser approval.
The agent reads the approved preparation over HTTP using its own credential and
the original review reference. The listener's private commit and receipt
handlers verify the actor again on every call. Commit accepts only the approved
preparation reference and the agent's retry key in a bounded JSON object. The
database still decides whether permission and availability allow a booking.

The harness drops the first successful commit response after the database saves
the booking. Resending the exact preparation and key returns the original receipt,
which the same actor can also read by reference. A separate approval for the same
slot receives `SLOT_UNAVAILABLE` once the first booking takes it. That refusal
creates no receipt. Another actor cannot learn whether the original receipt exists.
After the successful commit, the consumed continuation is unavailable. The agent
can use its exact retry or receipt read to reconcile the result.

Without `--browser`, the native proof approves through the private issuer adapter
and exercises the same agent HTTP requests.

## Remaining product gates

Disposable browser integration does not establish independent usability, a
generally available approval link or host/guest bilateral authorization. The
ordinary `/authority/review` route remains unavailable. The proposed terminal
status/requester display design and explicit synthetic enablement review remain
open. Normal routing and agent receipt delivery through the SDK or MCP remain
to be wired. Calendar,
notifications, guest lifecycle, real-user policy and Cloud operation are not
enabled by this proof.
