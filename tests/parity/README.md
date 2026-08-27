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
