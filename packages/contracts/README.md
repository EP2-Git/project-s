# `@project-s/contracts`

The transport-neutral Project S public booking contract. It exports strict Zod schemas and inferred types for the four approved v1 operations, canonical problems, server-derived execution context, the operation registry, and deterministic JSON Schema/OpenAPI/MCP artifacts.

```ts
import {
  generateContractArtifacts,
  operationRegistryById,
  prepareBookingInputSchema,
} from '@project-s/contracts';

const input = prepareBookingInputSchema.parse(untrustedInput);
const operation = operationRegistryById['project-s.public.prepare_booking.v1'];
const mcpInputSchema = operation.inputJsonSchema;
const { openApi, mcpManifest } = generateContractArtifacts();
```

The schema DSL in `src/schema.ts` emits runtime Zod validation and strict JSON Schema properties together. Do not hand-maintain separate transport DTOs. The artifact drift test intentionally requires review whenever the generated surface changes.

Build before runtime consumption:

```sh
npm run build --workspace @project-s/contracts
```

## V2 mandate and booking schema foundation

The separate `@project-s/contracts/v2` export begins implementation of
[ADR 0004](../../docs/adr/0004-bounded-mandate-implementation.md). It contains
mandate review/approval and actor prepare/create request and response parsers,
principal control inputs and terminal responses, server-only principal/actor
contexts, privacy-minimal actor summaries/receipts, strict version-2 success and
problem envelopes, and a separate deterministic JSON Schema bundle. The root
export, v1 artifact digest, four-operation registry and public MCP manifest are
unchanged.

```ts
import {
  generateV2ContractArtifacts,
  v2PrepareBookingInputSchema,
} from '@project-s/contracts/v2';

const input = v2PrepareBookingInputSchema.parse(untrustedInput);
const { jsonSchemaBundle } = generateV2ContractArtifacts();
```

This is an incremental contract foundation, not an available API. There is no
v2 router, SDK/MCP adapter, credential verifier, authority provider, private SQL
state or delegated write. Actor-registration success/audience serialization,
mandate inspection and step-up status/review serializers, provider evidence
contracts and their implementation follow separately. Object
IDs and successfully parsed bodies grant no authority. Actual ownership,
credential/profile status, server-relative expiry, digest verification,
availability, revocation, one-use enforcement and races require Core validation.

Unknown fields are rejected at every object level. Actor inputs cannot supply
principal/credential identity, booker details or duration. Principal review
summaries include the reviewed name/email; actor summaries and booking receipts
reject those fields and policy bounds. This response separation is a contract
constraint, not server-side access-control proof.

Principal controls now model actor registration's display label, revision-bound
revoke/delete inputs, reviewed booker-profile creation/deletion, and exact
step-up approval/revocation acknowledgements. Profile data enforces a positive
validity span of at most seven days without losing microseconds. A parsed
acknowledgement does not prove approval, atomic revocation, PII deletion or
one-use replacement; those need the private transaction and its tests. The
five-minute step-up ceiling is server-enforced because its response carries no
issuance time. Remaining public serializers must be reconciled with the reviewed
design before adapters are exposed; no open-ended state or difference payload
is accepted as a substitute.

`v2PrincipalContextSchema` and `v2ActorContextSchema` describe **internal server
inputs**, not request bodies. Both bind protocol version, instance, positive
epoch, principal equal to subject, verification time and the reviewed transport.
The actor context also requires its actor/credential IDs, revision and verifier
fingerprint. Parsing does not authenticate any of those claims; the gateway must
derive them from verified state, and Core must revalidate current records under
locks. Never accept context overrides or log the fingerprint/identity binding.

`v2ProblemEnvelopeSchema` keeps a separate code enum and matching inner/outer
request IDs. Only `STEP_UP_REQUIRED` may carry a required review reference;
`AUTHORITY_BUSY` requires the reviewed one-second retry. Review URLs have the
exact review path/UUID, but only the server can check their configured same
origin. Alternative slots are limited to three and retain exact time ordering.
Public error producers must still redact free-form text: a schema cannot prove
that a bounded message contains no secret, personal data or diagnostic detail.
Provider errors never authorize falling back to v1 browser authority.
V2 rejects the legacy `CONFIRMATION_REQUIRED` code and `confirm_in_browser`
retry action; their v1 contracts remain unchanged.

V2 instants accept the existing four-digit-year ISO shape with seconds, a `Z`/`z`
or numeric offset, and zero to six fractional digits. Parsing validates Gregorian
dates and clock/offset bounds, then normalizes to UTC with exactly six digits.
UTC normalization outside years 0000..9999 is refused. Adjacent microseconds
remain distinct, including before 1970. Use `compareV2Instants` or
`v2InstantToEpochMicroseconds` for exact ordering; do not round through
`Date.toISOString()` or a floating-point microsecond value. BigInt is a helper
result, never a JSON wire field. Parse the complete object before serializing or
hashing its normalized fields; these helpers do not compute or authenticate a
policy digest.

Runtime parsers enforce local meeting/permission ordering and the necessary
24-hour permission-span bound. Server-issued time and live supporting-record
ceilings remain separate checks. The generated bundle describes normalization
and cross-field refinements with `x-project-s-*` extensions. Generic JSON Schema
validation alone does not execute those extensions; future adapters must use
the runtime parsers and shared vectors. No v2 OpenAPI paths or MCP discovery are
generated while the operations are unavailable.

After building, `npm run test --workspace @project-s/contracts` runs both v1
compatibility and v2 foundation checks, including the separate artifact pins and
compiled subpath export. These tests do not establish authentication, transport
parity, SQL isolation, retention deletion or independent agent evaluation.
