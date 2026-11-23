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

## Remaining product gates

Native HTTP integration does not prove browser account/CORS wiring, independent
usability, a runnable approval link or host/guest bilateral authorization. The
ordinary `/authority/review` route remains unavailable. The proposed terminal
status/requester display design, explicit synthetic enablement review, actor
continuation and confirmed booking receipt remain separate. Calendar,
notifications, guest lifecycle, real-user policy and Cloud operation are not
enabled by this proof.
