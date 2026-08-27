# MCP v1 compatibility policy

Project S MCP v1 targets the Model Context Protocol revision `2026-07-28` and JSON Schema 2020-12. That revision is stateless: every request carries protocol version and client capabilities in `_meta`, results carry `resultType`, and `server/discover` reports supported versions and capabilities.

## Current implemented subset

- Protocol: `2026-07-28` only.
- Transport: client-launched, newline-delimited stdio.
- Server feature: tools.
- Tools: the four public booking tools documented in [mcp-tool-manifest.md](mcp-tool-manifest.md).
- Cancellation: `notifications/cancelled` for in-flight tool calls.
- Schema dialect: JSON Schema 2020-12.
- Node.js: 22.12 or newer.

The server returns MCP error `-32022` with `supported: ["2026-07-28"]` for a different modern protocol version. It returns standard JSON-RPC errors for malformed messages, invalid protocol envelopes, and unknown methods. Application errors remain successful JSON-RPC responses with `isError: true` and the shared structured problem envelope.

## Not implemented

- Legacy initialization-based MCP revisions (`2025-11-25` and earlier).
- The deprecated HTTP+SSE transport.
- Streamable HTTP MCP or remote sessions.
- MCP authorization, OAuth client registration, token exchange, or token passthrough.
- Resources, prompts, sampling, elicitation, subscriptions, tasks, MCP Apps, or experimental extensions.
- Conditional/per-user tool lists.

Project S sends an actionable error for legacy `initialize`, but it does not emulate a legacy session. Clients that only know the initialization era are incompatible with this release.

## Remote OAuth sequencing

Remote Streamable HTTP MCP is a later release slice. It requires TLS, Origin validation, OAuth 2.1 with PKCE, protected-resource metadata, resource indicators and audience binding, scope step-up, and transport-specific rate controls. It must use the same application contracts and cannot pass third-party tokens through to Supabase.

Supabase's OAuth 2.1 authorization server remains a beta feature as of this compatibility baseline. A spike may validate it early, but v1 local stdio does not depend on that beta surface and must not quietly grow remote authentication behavior.

## Change policy

These guarantees begin only with a future maintainer-approved supported Project S
release. The public Core pre-alpha exposes the current contract for evaluation
but carries no compatibility or support guarantee. The
2026-08-25 rename was an intentional pre-release namespace reset of a local,
unpublished candidate with no remote distribution or supported external
consumers. It changed names only; the four-operation behavior and authority
semantics were preserved. After a supported release, the rules below apply
without exception.

- Additive descriptions and safe examples may ship in a patch release if schemas and semantics do not change.
- Adding an optional input can change model behavior and requires explicit compatibility review.
- Removing or renaming a field, tool, code, or meaning requires a new contract/tool version.
- A fifth tool requires capability-ledger review, threat review, parity vectors, documentation, and release authorization.
- Supported MCP revisions and conformance requirements are pinned for each release; upgrades are intentional migrations, not floating dependency changes.

References: [MCP versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [MCP base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic), [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), and [Supabase OAuth server](https://supabase.com/docs/guides/auth/oauth-server).
