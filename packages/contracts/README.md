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
