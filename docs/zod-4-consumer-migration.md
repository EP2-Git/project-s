# Consuming Project S contracts with Zod 4

The local migration candidate uses the actual **Zod 4.6.7** runtime in Node,
the browser and the Edge import map. It does not use `zod/v3`. This implements
the locally accepted [RFC](rfcs/zod-4-compatibility-migration.md) and
[ADR 0005](adr/0005-zod-4-compatibility-migration.md); it is not a release,
deployment, alert dismissal or claim that hosted integration checks ran.

## Wire and domain compatibility

Existing v1 and separate unavailable v2 JSON Schema, OpenAPI and MCP artifact
pins remain frozen. Normalized DTOs, strict unknown-field rejection, public
problem codes/statuses/field messages, authority refusals and SDK error classes
must retain their existing behavior. The migration does not enable v2 or
delegated writes. Compile-only assertions independently check literal input and
output shapes rather than comparing aliases derived from the same parser.

Zod 4's built-in defaults differ from the old application in several ways.
The shared compatibility helpers use supported schema APIs to retain:

- UTF-16 code-unit lengths, including astral characters and lone surrogates,
  at the original trimming and normalization stage.
- Existing UUID, email, URL and date/instant acceptance, including documented
  legacy quirks. V1 retains UUID case; v2 lowercases it. Microsecond arithmetic
  and the existing Gregorian rules remain in the v2 canonicalizer.
- Existing numeric bounds and diagnostic messages, without imposing a new
  implicit safe-integer ceiling on previously less-bounded fields.
- Rejection of Date, Map, Set and Promise values where v3 object parsers
  refused them, even if such values carry enumerable schema-shaped fields.
- Transform short-circuiting and compound-error order. Failures before an old
  transform must abort that branch; issues raised inside the old custom instant
  transform remain continuable. These distinctions affect parent cross-field
  checks and public first-twelve-issue projection.

These are compatibility adapters, not a global error map, monkey patch or
reimplementation of Zod's private parser. Future correctness changes to legacy
quirks need their own reviewed contract decision.

`contractTransform` accepts a synchronous base schema, as used by every current
call site, and preserves its behavior under outer `parse`/`parseAsync` calls.
It does not turn an asynchronous base refinement into a synchronous validator;
future async bases need a deliberately asynchronous adapter and new ordering
tests.

## TypeScript parser API changes

Exported domain DTO types retain their meaning. Concrete parser classes,
generic signatures and native diagnostic APIs are a source migration:

```ts
import { z } from 'zod';

function parseResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  return schema.parse(input);
}
```

Use `z.ZodType` instead of removed `z.ZodTypeAny` constraints. Do not annotate
refined schemas as `ZodEffects` or use the old `ZodObject<Shape, 'strict'>`
generic. Retain the builder's actual inferred type or use explicit
`z.input<typeof schema>` and `z.output<typeof schema>` for domain boundaries.
Do not use `any` or cast a resolver to hide an input/output mismatch.

Object parsers return a guarded pipe and are not native `ZodObject` instances.
Read the explicit **object node's** `.shape`, such as `bookerNode.shape`, when
composing fields; the parser's `.shape` is removed. Attaching that property to
one parser would incorrectly advertise it on clone/refine/describe derivatives
that discard attached properties. Deliberately reapply named cross-field checks
when composing a shape: a spread alone does not retain refinements. The helper
does not emulate `.extend()`. V3-only `.innerType()` and `errorMap` call options
are gone.
Native Zod 4 `.nonempty()` derives an array type rather than v3's tuple type;
the existing bounded contract DTO array types are unchanged.

Native issues use Zod 4 codes/layouts such as `invalid_format` and
`invalid_value`, rather than v3's `invalid_string` and `invalid_enum_value`.
Their paths and the application's safe public projection remain tested, but
consumers inspecting raw native issues must migrate. Schema-local compatibility
messages take precedence over per-parse error callbacks in Zod 4. A callback
cannot override those installed legacy defaults. Custom messages retain their
own precedence. Do not serialize raw native errors as a new public protocol.

## Collections and streamed bodies

The old private v3 array subclass is removed. `arrayNode` installs the patched
native upper bound before element parsing. Its typed public library-author
core length checks guard `when` with `Array.isArray` so raw strings report the old
array-type error rather than an additional string-length error. No private
parser state is read or changed by the adapter. Excessive bounded arrays, sets and
maps are tested in sync and async paths for zero child validator work; nested
paths and valid boundary sizes are retained. Project S currently uses arrays,
not set/map fields. Native unbounded containers remain unbounded.

The previous streamed body protections remain: 16,384 request bytes and the
schema-derived 1,345,112-byte public response budget. SDK and browser readers
cap both success and error responses, count actual chunks regardless of
Content-Length, cancel on overflow/abort and release reader locks. No complete
unbounded `.text()` or `.json()` fallback is introduced. See the
[resource-limit explanation](zod-resource-limits.md) for compatibility limits.

## Forms, builds and Edge resolution

`@hookform/resolvers` is pinned to **5.2.2**, the compatible release fixing Zod
4 output typing. The old 3.10.0 resolver rejects invalid input with an uncaught
ZodError under the new runtime. The chosen resolver uses `zod/v4/core`; its only
new transitive dependency is `@standard-schema/utils` 0.3.0. Later resolver
versions were not selected because they changed unrelated optional-peer graphs.
Booking, signup and profile schemas retain field values/messages, trimming and
unknown-field stripping; no layout change is intended.

Build contracts, application and SDK together. The build annotates each emitted
JavaScript module with its sibling `@ts-self-types` declaration link so Deno
can follow transitive compiled package exports. The added header has a matching
empty generated source-map line; original source locations remain aligned.
Declarations and declaration maps are not rewritten. This is a strict type-link
repair, not a `no-check` or `skipLibCheck` waiver. Runtime JavaScript semantics
are unchanged. Edge also has explicit string/CORS annotations where literal
inference was too narrow for existing values.

Verify the actual graph with `npm ls zod @hookform/resolvers --all` and the
Edge import map, followed by Node parity, standalone Deno parity and the full
Edge entrypoint typecheck. Standalone Deno is distinct from Supabase's bundled
Edge Runtime. Docker-backed SQL, race and complete booking checks still require
their real disposable stack; synthetic browser and parser proof cannot replace
them. No hosted candidate pipeline runs under the local-only authorization.

## Rollback

Revert the migration's source, manifests, lockfile, resolver and import map as
one unit to the mitigated `6679ce1` baseline; run `npm ci`, rebuild packages and
rerun parity/body-limit checks. Keep the earlier v3 raw-container guard and
streamed byte protections. This restores an affected Zod dependency and its
audit failure, which must be recorded. There are no SQL/data or credential
changes to reverse. Do not mix old compiled package output with new runtime
types or remove mitigations while rolling back the runtime.
