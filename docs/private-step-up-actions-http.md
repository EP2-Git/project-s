# Private step-up action HTTP foundation

The approval interface needs an exact authenticated action boundary as well as
its [private review read](private-step-up-review-http.md). This increment
implements the Request/Response seam for the approve/revoke controls already
accepted in [ADR 0004](adr/0004-bounded-mandate-implementation.md) and the
[implementation supplement](rfcs/bounded-mandate-implementation.md#principal-only-controls).
It does not serve an endpoint or enable an approval screen.

`supabase/functions/_shared/stepUpActionHttp.ts` exports an explicit, unwired
`createStepUpActionHandler` factory for:

| Method/path | Exact body |
| --- | --- |
| POST `/api/v2/authority/step-ups/{reviewId}/approve` | `{expectedRevision,summaryDigest}` |
| POST `/api/v2/authority/step-ups/{reviewId}/revoke` | `{expectedRevision}` |

The existing `createStepUpReviewHandler` remains GET-only. Constructing a read
handler does not add an action surface. Both factories use the same fixed
redacted v2 problems and private response headers. Neither has an entrypoint
import, environment flag, configuration loader, browser route or CORS grant.

## Authentication, input and authority

Trusted server code supplies Auth, the current instance binding and the private
RPC client. Each action freshly verifies the account bearer token and derives
the principal before reading the body. Actor credentials, anonymous accounts,
cookie-only identity and client context/confirmation overrides cannot act.
Every supplied Origin must match the configured app origin; direct principal
HTTP clients may omit Origin. There is no ambient-cookie authentication.

POST requires `application/json` or `application/vnd.project-s.v2+json`, with
optional parameters. The existing body parser enforces its 16,384-byte streamed
limit, including forged content lengths and cancellation on overflow. Malformed
JSON and strict unknown/missing fields are refused before RPC. Oversize remains
the canonical 413 `VALIDATION_ERROR`, without exposing parser diagnostics.

Actions call the existing principal-only approve/revoke adapters directly.
They do not preflight through the pending-only GET: that read would incorrectly
block exact approval retries or revocation after supporting authority changed.
SQL independently verifies ownership, current instance/account and the exact
state/revision; approval rechecks live authority, unused budget and scheduling.

Approval replaces the original unused permission with the reviewed one-use
grant/preparation. It returns permission metadata, not a booking confirmation
or reserved slot. Exact eligible retries return the existing result. Pending
revocation closes this exception; otherwise-valid original permission remains.
Revoking an unused approved replacement invalidates its grant/preparation.
Consumed approvals refuse revocation rather than cancel a booking.

The HTTP boundary performs no automatic action retry. `AUTHORITY_BUSY` retains
the existing one-second same-request retry advice. Canonical scheduling
refusals remain 409, and all responses use `no-store`, `no-referrer` and
`nosniff`. No raw body, credential, personal data or upstream diagnostic enters
public errors or new logs.

## Evidence and remaining gates

The shared Node/Edge action vectors cover strict input, fresh authentication,
owner binding, unchanged read-only refusal, exact retry/revocation behavior,
streamed body limits, redaction and canonical errors. Existing SQL/Auth/race
tests remain separate proof of the transactions. Run `npm run test:parity` and
`npm run test:parity:edge` with the generated packages built.

Auth/RPC doubles do not prove served live Auth-to-HTTP or usability. No new
terminal-status or requester-label projection is implemented: that proposed
visibility design remains unaccepted. Genuine issuer UI, remaining transport
wiring, separate synthetic enablement, actor continuation and bilateral proof
remain required. Public v1, contracts/artifact pins, SQL/grants and the four-tool
manifest are unchanged. Deployment and real-user policy remain separate gates.
