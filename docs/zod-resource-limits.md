# Zod collection and transport resource limits

Status: local remediation candidate, 2026-10-24. No release or deployment is
implied. This is an application mitigation; the Zod dependency advisory remains
open while the affected dependency version is retained.

## Verified advisory and compatibility decision

[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), also
identified as CVE-2023-54404, covers Zod versions below 4.6.6. Alert #4 identifies
the installed 3.25.76 dependency as affected. Zod can accumulate an issue for
every invalid collection element even after discovering that its size exceeds
the schema's upper bound. This can exhaust memory on sufficiently large input.

The official first patched version is 4.6.6.
[Upstream PR 6652](https://github.com/colinhacks/zod/pull/6652) and
[its implementation](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)
abort oversized arrays, sets and maps before parsing elements in **v4**.
Unconstrained collections remain unconstrained. No patched stable v3 release
was published at inspection time; the `zod/v3` code within 4.6.7 also retains the
old behavior. A package upgrade followed by v3 subpath imports is not a fix.

[PR 54](https://github.com/EP2-Git/project-s/pull/54) upgrades to 4.6.7 but
[fails contracts compilation](https://github.com/EP2-Git/project-s/actions/runs/40019733125)
because v4 changes `ZodEffects` and `ZodObject` typing. Downstream browser checks
were skipped. The [prior migration decision](https://github.com/EP2-Git/project-s/pull/28#issuecomment-6203932234)
requires the RFC/ADR and parity process for a Zod 4 migration. This candidate
retains v3 and mitigates the application's concrete boundaries instead.

Node's root/contracts/SDK resolve Zod 3.25.76 from the lockfile. Edge independently
resolves `npm:zod@3.25.76` through `supabase/functions/api-v1/deno.json`. The same
compiled contracts and body reader execute in both runtimes. Dependency
declarations, actual runtime resolution and application mitigation are distinct
evidence; this change does not make `npm audit` report a patched version.

## Exposure and implementation

The four public v1 request schemas contain fixed objects and scalars, with no
array/set/map input fields. No unauthenticated request-to-collection-fanout
exploit against this application or any deployed service was established.
Response arrays and internal context scopes do use Zod. An SDK endpoint's
response is untrusted data, regardless of its HTTP success status.

`arrayNode` now constructs a private Zod 3 array subclass. Its `_parse` checks
the raw array length against existing maximum/exact upper bounds and returns
one ordinary `too_big` issue before any child parser, transform, refinement or
async task runs. Otherwise it delegates to the original parser. The scopes
schema also uses this builder. The array API, inferred input/output types,
minimum sizes, normalization, strict objects, optional/nullable composition and
ordinary error maps remain intact. Deriving `min`, `max`, `length`, `nonempty`
or `describe` retains the guard. Sets/maps remain invalid array input types;
the application has no Zod set/map fields.

The existing limits remain: 100 meeting types, 2,000 slots, 32 field errors,
three alternatives and the existing scope count. Invalid oversized arrays now
produce a bounded size error instead of additionally enumerating invalid
elements. No global Zod monkey patch or dependency override is installed.
Future collection schemas must continue using bounded builders; arbitrary new
Zod schemas and transformations that reconstruct them are not protected by
importing the package.

The shared `readBoundedText` reads actual stream chunks before copying them
into a bounded growing buffer. It rejects an excessive chunk before decoding,
cancels the source and releases its lock. Abort interrupts pending reads;
failed or hanging cancellation cannot replace or delay the original error.
UTF-8 split across chunks, replacement decoding and BOM behavior match ordinary
Fetch text decoding. Content-Length can reject early, but an absent, invalid or
understated value never bypasses actual byte counting. This includes chunked
bodies and Fetch-exposed bytes after content decoding.

The HTTP parser keeps its existing **16,384-byte** request limit and canonical
413/400 `VALIDATION_ERROR` behavior, but no longer buffers an unlimited body
with `request.text()` first. Empty-body and JSON parsing behavior is preserved.

The SDK applies **1,345,112 bytes** to both success and error bodies before
JSON/schema parsing. The value is computed from every existing public success
schema and the problem envelope: all optional fields, container cardinalities,
known keys/separators, numeric bounds and up to six JSON bytes per UTF-16 code
unit. UUID/date/instant sizes and normalized booker email/name/notes bounds
come from the existing codecs where legacy schema metadata omits a maximum.
Maximum canonical DTO fixtures for all four operations and problems fit this
budget. A future unbounded response schema fails budget derivation explicitly.

The server emits normalized compact JSON with `JSON.stringify`. Unlimited JSON
whitespace, arbitrarily padded pre-normalized strings or unrelated fields do
not have a finite maximum and are intentionally not an unlimited compatibility
promise. Standard Fetch responses are required from custom fetch adapters;
there is no unbounded `.text()`/`.json()` fallback for incomplete response mocks.
Oversize is a `ProjectSProtocolError` without retaining the body; read/abort
failures are `ProjectSTransportError` with their cause. Valid canonical problems
remain `ProjectSApiError`, and public problem codes/fields are unchanged.

## Verification and limits

```sh
npm run check
npm run test:parity
npm run test:parity:edge
npm run docs:check
npm run security:scan
npm run licenses:check
```

The Edge resource suite needs Deno on PATH. It executes the same isolated
vectors as Node using the production import map, without account credentials,
listening services or database writes. Standalone Deno proof is not the bundled
Supabase Edge Runtime or a deployed-service test. The four-operation golden
suite and v1/v2 artifact digest pins remain unchanged.

At local validation, build/typechecks, units/SDK/parity and focused coverage
passed; the aggregate `check` stopped at its unchanged production audit gate
with the known high Zod advisory. Full standalone Deno 2.9.8 entrypoint checking
also reports 28 errors reproduced on unchanged main, including compiled-JS
type exports and CORS inference. The resource vectors pass in that runtime.
Local Docker is unavailable, so live Edge/DB, pgTAP, concurrency and full browser
booking checks are not claimed. These gaps cannot be called a green pipeline.

The affected version remains installed and the alert remains open. A reviewed
Zod migration or a genuine upstream-compatible patched release is still needed
to clear the dependency finding without weakening audit policy. This mitigation
does not impose global service memory, time, rate or concurrency budgets. Fetch
or a custom stream may allocate an incoming chunk before the reader receives
it. Browser preview/confirmation support requests still use their separate
`response.json()` reader; extending that helper is a separate scope choice.
Unrelated provider fetches and the MCP line reader are not rewritten.

## Rollback

Revert this focused candidate as one unit, then run `npm run build:packages` to
replace ignored compiled workspace output and rerun the existing tests. There
are no SQL migrations, data changes or credential changes to roll back. Revert
also removes the collection early-abort and streamed byte protections; retain
the advisory/open-risk record and avoid representing that state as remediated.
