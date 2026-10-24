# Canonical transport parity harness

`golden-vectors.mjs` is the single fixture set for Project S's four public v1
operations. `canonical-parity.test.mjs` sends every vector through three
boundaries:

1. the `@project-s/application` use-case boundary with an in-memory authority;
2. the `@project-s/sdk` HTTP request/response serialization seam; and
3. the MCP tool adapter backed by the real SDK and contract registry.

The harness checks normalized valid input and output, strict unknown input and
authority-response rejection, canonical success and problem behavior, and the
minimal PII-safe MCP text projection. Run it with:

```sh
npm run test:parity
```

This deterministic harness does not replace the live database/HTTP/MCP agent
flow, the separate 50-way booking-collision check, or an official MCP
conformance runner.

`resource-parity.test.mjs` additionally runs the production HTTP body parser,
bounded contracts and SDK against isolated streams. It verifies early nested
collection rejection, request/response byte limits and cancellation, existing
golden-vector normalization/strictness, and unchanged v1/v2 artifact pins. It is
included in `test:parity`; Node uses its TypeScript stripping flag for the shared
Edge helper. Run the same vectors in standalone Deno with the production import
map using `npm run test:parity:edge` (Deno must be on PATH). This does not start
the Edge router or prove the bundled Supabase runtime, database or hosted CI.

`migration-compatibility.test.mjs` freezes the actual v1/v2 contract behavior
most likely to change under Zod 4: Unicode boundaries, UUIDs, dates/instants,
normalization, strictness and errors. It also runs in both `test:parity` and
`test:parity:edge`. Passing on current Zod 3 is baseline evidence, not a migrated
application result. Preserve public behavior assertions when implementing the
[proposed migration](../../docs/rfcs/zod-4-compatibility-migration.md); historical
native v3 diagnostic codes need the explicit parser-API review described there.

`npm run probe:zod-migration` is a separate, offline raw-library probe. It
accepts an explicitly supplied verified package directory via
`-- --candidate-dir <absolute-directory> --expected-version 4.6.7`. The fixed
32-element samples compare leading array/set/map bounds, sync/async child
visits and selected acceptance/error behavior. Zod 3 maps have no built-in
max/size API; the report marks those cases unsupported. A passing target probe
does not establish compiled application compatibility. Never replace the
application/parity gates with these observations.
