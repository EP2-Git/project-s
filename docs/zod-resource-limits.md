# Zod collection and transport resource limits

Status: local mitigation and approved Zod 4 migration candidate, 2026-10-24.
No release or deployment is implied. The candidate now resolves genuine Zod
4.6.7 in Node and Edge. Main and GitHub alert state remain separate; no alert
has been dismissed or remotely changed.

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
requires the RFC/ADR and parity process for a Zod 4 migration. The first local
unit retained v3 and mitigated concrete boundaries. Ethan subsequently approved
the recommended migration locally; the current candidate adds compatibility
adapters and the patched runtime rather than merging the automated bump.

Node's root/contracts/SDK now resolve Zod 4.6.7 from the lockfile. Edge independently
resolves `npm:zod@4.6.7` through `supabase/functions/api-v1/deno.json`. The same
compiled contracts and body reader execute in both runtimes. Dependency
declarations, actual runtime resolution and application mitigation are distinct
evidence. Both full and production audits must be rerun against this actual
installed candidate; proposal probes alone cannot establish remediation.

## Exposure and implementation

The four public v1 request schemas contain fixed objects and scalars, with no
array/set/map input fields. No unauthenticated request-to-collection-fanout
exploit against this application or any deployed service was established.
Response arrays and internal context scopes do use Zod. An SDK endpoint's
response is untrusted data, regardless of its HTTP success status.

The initial `arrayNode` mitigation used a private Zod 3 array subclass. The
approved migration removes that subclass and installs patched native v4
maximum/exact bounds before any child parser, transform, refinement or async
task. The scopes schema also uses this builder. Excessive input yields one
ordinary `too_big` issue. Domain input/output types, minimum sizes,
normalization, strict objects and optional/nullable composition remain tested.
Derived bounds and sync/async paths are covered. Sets/maps remain invalid array
input types; the application has no Zod set/map fields. Native set/map leading
bounds are separately tested, including zero key/value validator work.

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

The browser's preparation preview and human confirmation helper uses the same
reader and budget for both successful and problem responses. Preview contains
a subset of the already-budgeted prepare response; confirmation has a fixed
smaller envelope. Tests verify their longest legitimate fields fit. The helper
retains canonical problems, retry information, normalization, strict field
rejection and the existing approval request. Oversize and stream failures map
to the existing safe protocol/connection messages, without displaying upstream
diagnostics or retaining an oversized body. It does not add approval authority.

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
npm run test:browser:body-limits
npm run docs:check
npm run security:scan
npm run licenses:check
```

The Edge resource suite needs Deno on PATH. It executes the same isolated
vectors as Node using the production import map, without account credentials,
listening services or database writes. Standalone Deno proof is not the bundled
Supabase Edge Runtime or a deployed-service test. The four-operation golden
suite and v1/v2 artifact digest pins remain unchanged.

The historical mitigated-v3 validation passed build/typechecks, units/SDK/parity
and focused coverage, then stopped at its known high production audit finding.
The approved v4 candidate must pass the same gates without changing thresholds.
Strict full Deno entrypoint checking is required in addition to focused resource
vectors. The migration repairs compiled declaration linkage and narrow literal
inference that produced 28 errors on unchanged main, without waiving checking.
Record exact candidate results separately. When Docker is unavailable, live
Edge/DB, pgTAP, concurrency and complete browser booking evidence remain gaps;
they cannot be called a green pipeline.

The remote alert remains open until an authorized integrated change is detected;
a passing local audit does not dismiss it. The candidate migration does not
weaken audit policy. This mitigation
does not impose global service memory, time, rate or concurrency budgets. Fetch
or a custom stream may allocate an incoming chunk before the reader receives
it. Unrelated provider fetches and the MCP line reader are not rewritten.

## Approved local dependency migration

The [Zod 4 migration RFC](rfcs/zod-4-compatibility-migration.md) and
[ADR 0005](adr/0005-zod-4-compatibility-migration.md) were accepted for local
implementation on 2026-10-24. The candidate synchronizes manifests, lockfile and
Edge map at 4.6.7, with the required compatible form resolver. See the
[consumer migration guide](zod-4-consumer-migration.md) for source-type and native
diagnostic changes. Pushing, merging and deployment remain unauthorized.

`tests/parity/migration-compatibility.test.mjs` freezes actual v1/v2 acceptance,
normalization and error boundaries in Node and standalone Deno. Separately,
`npm run probe:zod-migration` inspects a small, bounded raw-library sample. Pass
`-- --candidate-dir <absolute-package-directory> --expected-version 4.6.7` to
inspect a separately verified, externally unpacked package. The default now
inspects installed 4.6.7. The probe has no downloader or dependency mutation.
Its passing result demonstrates the sampled upstream fix, not an application
migration or complete parity. Both versions leave unbounded collections
unbounded; the v3 subpath is not an acceptable workaround.

Side-by-side observations of 3.25.76 and official 4.6.7 confirm changed UUID,
Unicode length, integer and diagnostic semantics. A separate no-emit TypeScript
resolution probe passed against the old v3 baseline and reported 24 diagnostics
against unadapted v4, including effects/object types and private array internals.
Those historical blockers explain the explicit migration rather than a routine
bump. Current application build/parity evidence must come from the actual
migrated source and installed runtime, not those old probes.

## Rollback

Revert the v4 migration coherently to the mitigated `6679ce1` baseline, run
`npm ci` and `npm run build:packages`, and rerun parity/body-limit checks.
That restores affected v3 and its audit failure; retain the earlier raw-array
guard and streamed byte protections. There are no SQL/data or credential
changes to reverse. Reverting the entire mitigation to unprotected main would
also remove those protections and must not be represented as remediation.
