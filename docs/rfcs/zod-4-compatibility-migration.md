# RFC: Zod 4 compatibility migration

- **Status:** Proposed; not accepted or authorized for implementation
- **Date:** 2026-10-24
- **Decision owner:** Ethan Patten, lead maintainer
- **Companion:** [proposed ADR 0005](../adr/0005-zod-4-compatibility-migration.md)
- **Source baseline:** `9299b4338a238e30fa00f0b2d897ef68c3122711` on `codex/zod-resource-limits`
- **Scope:** dependency/runtime migration preserving existing Project S contracts

The current authorization covers this local proposal and compatibility tests.
It does not approve changing dependency declarations, runtime imports, production
schemas or generated pins. Design review and explicit implementation approval
are required before that work begins. Publication and merging are separate from
this local preparation.

## Problem and existing evidence

[The resource-limit investigation](../zod-resource-limits.md) records the high
Zod advisory, the application's early collection guards and streamed byte
limits, and the remaining audit failure. Those mitigations retain Zod 3.25.76;
they do not turn it into a patched dependency. The documented first patched
version is 4.6.6. Evaluate **4.6.7** as the concrete migration candidate, with
its registry integrity and patched implementation verified during preparation;
recheck advisories before any later implementation.

The [PR 28 decision](https://github.com/EP2-Git/project-s/pull/28#issuecomment-6203932234)
already classified this as a public-contract compatibility migration requiring
the RFC/ADR and parity process in [CONTRIBUTING](../../CONTRIBUTING.md). A major
version bump alone fails contracts compilation in the later PR 54 candidate.
Neither that failure nor a green isolated library probe establishes application
compatibility.

Existing Node imports resolve the root, contracts and SDK declarations through
the lockfile. Edge separately maps `zod` to `npm:zod@3.25.76` in
`supabase/functions/api-v1/deno.json`. Browser form resolvers and support-response
validators also consume Zod. A successful contracts-only rewrite would leave
these consumers unproven.

## Measured proposal probes

The bounded [raw-library probe](../../scripts/probe-zod-migration.mjs) compares
installed 3.25.76 with an externally extracted official 4.6.7 package whose
registry integrity was checked. It does not install that package into the
application. Reports explicitly set `productionMigrated: false`. The same raw
target probe also passed in standalone Deno 2.9.8; it did not change that
runtime's application import map or exercise the Supabase Edge entrypoint.

| Probe | 3.25.76 baseline | Official 4.6.7 observation |
| --- | --- | --- |
| Array/set maximum or exact size 2 with 32 invalid entries, sync and async | 32 child visits, 33 issues | Zero child visits, one issue |
| Map maximum/exact size | No native max/size API; recorded as unsupported | Zero child visits, one issue |
| Unbounded array/set/map | Every entry visited; map visits key and value | Still unbounded; no early size protection |
| Nested excessive inner array | 32 child visits | Zero child visits; nested path retained |
| Native string maximum 1 with one astral emoji | Rejected | Accepted; native length semantics differ |
| UUID-like `11111111-1111-1111-1111-111111111111` | Accepted | Rejected by native UUID validator |
| Native integer `Number.MAX_SAFE_INTEGER + 1` | Accepted | Rejected |
| Invalid UUID diagnostic | `invalid_string` and old message | `invalid_format` and different message |

The raw date-time probe also found basic offset `+0430` accepted by v3 and
rejected by v4; Project S's existing public regex already rejects that spelling.
Both raw libraries accept seven fractional digits, while Project S caps them at
six. These are library observations, not permission to replace the application's
composed validators with either library's defaults.

The [application compatibility harness](../../tests/parity/migration-compatibility.test.mjs)
freezes further existing distinctions: v1 preserves uppercase UUIDs while v2
lowercases them; the legacy UUID-like example currently passes both Project S
versions. V1's instant validator accepts `+24:99` and refuses lowercase `z`,
whereas v2 refuses that offset and accepts lowercase `z`. Local-date parsing
refuses years 0000..0099 because of its existing `Date.UTC` mapping, accepts
0100, and distinguishes the 1900/2000 leap years. These fixtures expose current
compatibility quirks; they do not endorse them as preferred future semantics.
Any correction needs a separate reviewed/versioned contract decision. The
baseline harness passes 12 Node tests and includes actual exported display-name,
title and description schemas at astral UTF-16 and lone-high-surrogate bounds.
This is baseline evidence, not a candidate application pass.

A type-resolution-only probe extended the actual contracts build configuration
with `noEmit`, mapped `zod` to each package's own declared type entry and retained
the repository's existing type roots. Current v3 exited 0; target v4 exited 2
with **24 TypeScript diagnostics**, including Effects/Object annotations and
the temporary v3 subclass's private parser APIs. This measures a compile blocker;
it is not a migrated build or a substitute for runtime compatibility tests.

Reproduce the installed raw baseline without changing application imports:

```sh
node scripts/probe-zod-migration.mjs --expected-version 3.25.76
```

For a separately verified extracted candidate, provide `--candidate-dir` with
its absolute package directory and `--expected-version 4.6.7`; `--report` is an
optional output path. Version assertions and bounded fixtures must remain
enabled. Do not use a candidate probe as evidence that production resolution,
Edge, SQL or the browser application has migrated.

## Recommended compatibility boundary

Preserve the following under the existing versions:

- The four public v1 operations, HTTP media types/routes/statuses, SDK methods,
  browser confirmation/cancellation behavior and four-tool MCP discovery.
- Exact strict-object acceptance, required/optional/null behavior, scalar limits,
  transform order and normalized output for v1 and the separate unavailable v2
  foundation. Migration does not enable v2 routes or delegated writes.
- Project S problem codes, status relationships, request IDs, field paths and
  messages, retry/step-up behavior, and SDK API/protocol/transport error classes.
  Internal library issue layouts are not a replacement public error contract.
- The hand-maintained JSON Schema/OpenAPI/MCP metadata and current artifact pins:

| Surface | Frozen SHA-256 of the existing generated artifact serialization |
| --- | --- |
| v1 | `827656a8a8748d1d58afa9042daae09fa3be586d274d86308e09ae8ace3f57be` |
| separate v2 foundation | `66977092b59068359dce6eb48fbf2c226f3f6f8a78ab1c6587ef39499e8fa813` |

Do not regenerate expected outputs merely to make a migration pass. If matching
existing behavior requires an adapter, specify and test the adapter. If a
material acceptance, normalization, error or authority change cannot be
preserved, stop that portion and propose the appropriate versioned contract and
RFC. Pre-alpha status permits reviewed changes; it does not make drift invisible.

The package currently exposes `ContractNode`, `arrayNode` and concrete Zod
parser types. Replacing those v3 class/generic signatures is a **TypeScript
source migration**, even if domain DTOs and JSON stay identical. Document that
impact explicitly; do not claim full source compatibility or hide failures with
`any`/unsafe casts. Preserve `z.input`, `z.output` and existing domain aliases
where semantics are unchanged, and provide a consumer migration example.

Exported parsers also expose native diagnostic APIs. The baseline harness's raw
`invalid_string`/`invalid_enum_value` assertions record the current v3 API;
v4 uses different native codes. Review and document those consumer-facing
diagnostic changes explicitly with the parser-type migration. Only those raw
library expectations may change under that specific reviewed decision, with
their paths and safe public projections retained. The exact Project S public
field-error messages, statuses, problem codes and artifact pins must still pass
unchanged. Do not manufacture unsupported native issue codes using unsafe casts
or treat a raw-code change as permission to rewrite public error expectations.

## Concrete migration map

The [official migration guide](https://zod.dev/v4/changelog) explains the changed
type/error model. The proposed edits below are specific to current repository
usage; they are not changes made by this RFC.

| Current usage | Proposed implementation and required evidence |
| --- | --- |
| `ZodTypeAny` constraints in contracts, registry, SDK and browser support helpers | Use `TSchema extends z.ZodType`, retaining each concrete schema's input/output inference. Add compile-only consumer assertions rather than widening return values to `unknown` or `any`. |
| `ZodEffects` annotations on v1 slot, preparation, booking and scopes refinements | Let the returned schema retain its actual v4 type, or derive the annotation from the builder. Keep all existing refinements and paths. Transforms remain ordered pipes; removing a wrapper type must not remove validation. |
| `ZodObject<Shape, 'strict'>` in `objectNode` and success envelopes | Infer the concrete return type from `z.strictObject(zodShape)` instead of spelling the v3 strictness generic. Plain object construction that strips unknown fields is not equivalent. Preserve nested strictness, optional metadata and envelope inference. |
| `BoundedZodArray._parse`, `_def`, `ParseInput`, `z.INVALID` and subclass-preserving derivations | Replace the private v3 subclass with the patched native bounded collection API. Keep `.max()`/exact upper bounds before untrusted element work and prove zero child visits for excessive sync/async arrays. Do not port private internals into v4 or assume an unbounded array is protected. |
| `.shape`, `.unwrap()`, `.innerType()` and object reuse | Keep explicit unrefined shape nodes where fields are reused. Review v2 problem/retry and profile/name reuse individually. If extending a refined object, use `.safeExtend()` or reapply named checks deliberately; spreading only its shape loses cross-field constraints. Replace the v3-only scopes `.innerType()` test access without dropping its resource assertion. |
| `.refine`, `.superRefine`, `context.addIssue`, `z.NEVER` and custom transforms | Preserve nonthrowing malformed-input behavior, issue paths, check order and transform short-circuiting. V2 instant parsing, subject binding, status/step-up/retry constraints and matching request IDs all require direct vectors. |
| Legacy built-in UUID validators | Compare the existing accepted GUID-like grammar with the stricter candidate. If necessary, implement the reviewed legacy grammar with v4 primitives, not v3 runtime imports. Preserve v1 case and v2 lowercase normalization; do not tighten variant/version bits silently. |
| String lengths and formats | The probe confirms different native emoji length behavior. Preserve legacy code-unit bounds with explicit compatibility checks at the same trimming/transform stage; include astral boundaries and lone surrogates. Keep existing booker regexes and ASCII-space/email normalization; built-in email defaults are not substitutes. |
| v1 date/instant/URL validators and v2 canonicalizer | Preserve the measured v1 offset, lowercase-`z`, fraction and local-date year behavior, including documented quirks pending separate review. Retain v2's custom Gregorian validation, six-digit UTC normalization and BigInt microsecond comparisons. Do not substitute millisecond comparison or broaden URL schemes/origins. |
| Integer validators | Check finite values, fractions and safe-integer boundaries. V2 revisions already have an explicit safe ceiling. Inspect host-cancellation version parsing and other less-bounded consumers before adopting a stricter numeric shortcut. |
| React Hook Form resolvers and local forms | Verify the installed resolver's support for the selected v4 release; propose a compatible resolver update if required. Preserve booking, signup and personal-profile field values, messages, touched/error behavior and submit controls. No resolver cast may conceal mismatched input/output types. |

Current production source has no `z.record`, `z.union` or
`z.discriminatedUnion` construction. TypeScript `Record` types and handwritten
JSON Schema `oneOf` entries are different mechanisms and need no invented parser
rewrite. This does not authorize adding records or unions to an existing
contract.

The [official schema APIs](https://zod.dev/api) document strict objects, shape
access and check-preserving extension. Candidate format/length behavior must be
confirmed against the exact pinned package; current documentation alone is not
a version-specific executable result.

## Error compatibility and privacy

`packages/application/src/application.ts` projects the first twelve issues into
public field paths/messages. Consequently, changing default library wording can
change wire output. The SDK also classifies canonical problems separately from
protocol/read failures, while browser services recognize validation failures.

Use explicit Project S message/path projection or schema-local compatibility
messages for the cases exercised by current contracts. Preserve custom messages
and error-map precedence intentionally. Avoid a process-wide replacement error
map that silently changes unrelated forms or consumes input values. Convert
v3-only `errorMap` test calls to supported candidate APIs while keeping their
intent. Native v4 issue-code/layout changes must be recorded, not mislabeled as
byte-identical v3 issue objects.

The [official error documentation](https://zod.dev/error-customization) describes
error customization and input reporting. Do not enable `reportInput`, log raw
issues/bodies, or include credential/profile/prompt data in compatibility
diagnostics. Use synthetic fixtures and stable public projections. No privacy,
retention or identity policy changes are proposed.

## Resource guarantees that must survive

Keep bounded collections at 100 meeting types, 2,000 slots, 32 field errors,
three alternatives and the scope-enum count. Preserve scope uniqueness after
normalization and zero child parsing/async tasks for excessive cardinality.
Move the historical stock-v3 fanout demonstration into an explicit baseline
probe; a patched v4 test must not require vulnerable behavior to continue.

Keep actual streamed request/response byte counting, cancellation, lock release,
pending-read abort, UTF-8/BOM behavior and bounded failure handling. Retain the
16,384-byte request limit and 1,345,112-byte schema-derived public response
budget. If string semantics change, first preserve the legacy scalar limits;
do not enlarge the budget to disguise an accidental acceptance change.

Patched upper-bound checks do not impose global memory, CPU, time, request-rate
or concurrency limits, and they do not bound newly introduced unbounded
collections. A v4 package with application imports redirected to `zod/v3` is
not remediation.

## Stages and gates

1. **Proposal and baseline, authorized now.** Freeze synthetic compatibility
   vectors, inferred-type assertions, resource tests, generated pins and current
   runtime-resolution evidence. Run the proposal harness against the installed
   baseline. A separately identified official-package probe may measure target
   differences without altering application resolution. Record results and
   unavailable checks; do not call this a migrated application.
2. **Design review, then implementation approval.** Ethan reviews this RFC/ADR,
   including source-type impact, format/length adapters and error projection.
   Only then undertake the dependency and source migration in an isolated
   branch. Design acceptance alone is not a green implementation.
3. **One coherent runtime migration.** Synchronize root/contracts/SDK dependency
   declarations, lockfile and Edge import map to the reviewed patched release;
   rebuild ignored workspace output. Verify actual Node and Deno resolution and
   absence of v3 fallback or duplicate parser families. Do not mix old compiled
   contracts with new runtime types.
4. **Local compatibility gates.** Run all package/root typechecks and builds,
   contract tests, input/output assertions, frozen artifact pins, collection and
   transport tests, canonical golden parity, Node and standalone Deno resource
   parity, examples/MCP discovery, form/service tests, lint and docs checks.
   Measure the full Edge entrypoint as well as focused resource vectors.
5. **Integration and security gates.** Run database lint/pgTAP, generated-type
   comparison, independent-client booking races, agent flow, all browser engines,
   production-bundle smoke, keyboard/Axe/responsive and affected visual checks.
   Run full and production dependency audits, secret scanning and licence checks.
6. **Later publication review.** Only separately authorized PR work with the full
   repository pipeline passing on its exact current commit/current main may be
   considered for merge. Do not weaken audit thresholds, golden pins, assertions,
   branch protection or expected checks. No release, deployment or hosted
   configuration change follows from this proposal.

The compatibility harness participates in `npm run test:parity`; its standalone
Deno execution belongs with `npm run test:parity:edge`. Both use the actual
installed application contracts and production import mapping. Keep raw-library
candidate observations separate from those baseline/application results.

The existing investigation reproduced **28 standalone Deno entrypoint type
errors** on unchanged main. Keep their diagnostics and baseline comparison
visible; passing focused resource vectors neither resolves nor waives them.
Repair or reconcile them through reviewed, scoped work before claiming a clean
Edge typecheck/full migration gate. Preserve the distinction between standalone
Deno, bundled local Supabase Edge Runtime and hosted CI. Docker-unavailable SQL
or browser integration is a gap, never a passing result.

The installed v3 dependency remains vulnerable and the production audit remains
high until a genuine reviewed migration changes actual resolution and both
audits are rerun. Do not update the risk record to "resolved" because proposal
tests, an extracted package probe or application mitigations pass.

## Rollback and decision requested

The proposal changes no production dependency, schema, database or credential.
Its tests and documents can be removed without changing authority. A later
implementation must be reversible as a single dependency/source/import-map
unit, followed by clean install/rebuild and parity tests; reverting restores
the vulnerable baseline and must be reported as such. No rollback may remove
existing resource guards until the reverted runtime is protected again.

The recommendation for review is a patched **v4 runtime with explicit
compatibility adapters**, preserving existing wire and normalized domain
behavior while documenting parser-type migration. Remaining decisions concern
this technical migration and any demonstrated incompatibility; this proposal
does not reopen accepted authority designs or authorize unrelated product work.
