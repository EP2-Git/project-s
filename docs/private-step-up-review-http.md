# Private step-up review HTTP foundation

The booking approval link needs a way for its signed-in owner to read the exact
booking and the reason approval is needed. This increment implements the
read-only Request/Response seam from [ADR 0004](adr/0004-bounded-mandate-implementation.md)
and its [reviewed wire boundary](rfcs/bounded-mandate-implementation.md#proposed-strict-v2-wire-boundary).
It does not serve an endpoint or enable the approval screen.

`supabase/functions/_shared/stepUpReviewHttp.ts` exports an unwired handler for
`GET /api/v2/authority/step-ups/{reviewId}`. A trusted server supplies its
instance binding, Auth verifier and private RPC client. There is no new
environment flag, configuration loader, entrypoint import, browser route or
delegated write. Public v1 and its four-tool manifest stay unchanged.

## Read and privacy boundary

Each request verifies its account bearer token with Auth, derives the principal
on the server and calls the existing principal-fenced SQL read. Anonymous
accounts and actor credentials are refused. The UUID in a link identifies a
review; it cannot authorize access. No client context, cookie identity or
principal query parameter is accepted. Browser Origin, when present, must equal
the configured app origin; this handler grants no cross-origin access.

The shared strict v2 response includes only the pending review's revision,
digest, deadline, exact booking snapshot and allowlisted differences. Reviewed
name and email are private owner-visible fields. Missing and foreign reviews
retain the same `FORBIDDEN` refusal. An owned review that is no longer usable
retains `VERSION_CONFLICT`; this increment does not invent terminal summaries.
Read access does not grant permission to approve, revoke or book.

All success and error responses use `no-store`, `no-referrer` and `nosniff`.
The server generates the correlation ID. Errors have the strict version-2
problem envelope and fixed messages, without raw Auth/RPC diagnostics or request
data. Contention preserves the existing one-second same-request retry advice.

## Evidence and remaining work

Contract tests cover the shared response's normalization and strictness. The
Node/Edge parity suite exercises the actual handler with isolated Auth/RPC
doubles, including owner context, credential refusal, cross-principal denial,
malformed requests, redaction and safe response headers. Run:

```sh
npm run test:parity
npm run test:parity:edge
```

These doubles do not prove a served HTTP endpoint, independent usability or a
new live Auth-to-HTTP integration. Existing SQL/Auth tests remain separate
evidence. The genuine issuer screen, remaining authenticated transport wiring,
reviewed synthetic enablement, approve/decline outcomes and agent continuation
are still required. Deployment and real-user retention remain separately gated.
