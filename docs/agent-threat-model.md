# Agent access threat model

This document covers Project S's four public API/SDK/MCP booking operations. PostgreSQL remains the scheduling authority; the shared application layer is the policy and transport boundary.

## Protected assets

- Host schedules, overrides, busy intervals, buffers, owner identifiers, and provider state.
- Guest name, email, notes, time zone, preparation links, and confirmation grants.
- Booking integrity: one valid booking, at the selected time, for the confirmed intent.
- Actor, client, delegation, scope, confirmation, idempotency, and audit provenance.
- Availability and abuse-control capacity.

## Trust boundaries

1. Model or automation to MCP client.
2. MCP client to the local stdio process.
3. Local process to the public HTTPS API through `@project-s/sdk`.
4. API transport adapter to shared application use cases.
5. Application ports to the Supabase/PostgreSQL authority, rate limiter, abuse guard, and audit store.
6. Preparation link to the human-controlled browser confirmation page.

The MCP process is not trusted with database credentials and is not an authority. Client-supplied actor, owner, subject, scope, `on_behalf_of`, end time, duration, buffers, or confirmation assertions are ignored because they are absent from the contract.

## Primary threats and controls

| Threat | Required control |
| --- | --- |
| Prompt injection asks for hidden data or new powers | Fixed four-tool allowlist; strict schemas; no SQL/CRUD, resources, prompts, sampling, or service-role access. |
| Agent creates without real approval | Prepare/browser/one-use confirmation grant; create accepts only preparation token and idempotency key. |
| TOCTOU between availability and commit | No hold claim; advisory lock; fresh policy/time re-read; preview-fingerprint comparison; exclusion constraint. |
| Cross-transport idempotency race | One authority and idempotency domain across UI, HTTP, SDK, and MCP. |
| Preparation replay or substitution | Opaque high-entropy token stored only as a digest, with expiry, audience and fingerprint binding; single-use confirmation and commit. |
| PII leaks through model-visible text or logs | Static safe text; structured allowlisted responses; no raw args/errors; HMAC identifiers in abuse keys; private audit. |
| Enumeration of host state | Stable public reason codes; bounded alternatives; no busy intervals, booking IDs, rules, or owner IDs. |
| Public endpoint resource exhaustion | Per-operation limits keyed by a server-HMAC of the verified network source plus the minimum public resource dimensions needed for that operation; production refuses to boot without a verified proxy chain, rate secret, and human challenge configuration. |
| Plaintext remote SDK traffic | HTTPS required; HTTP accepted only for loopback development. |
| Stdout corruption | JSON-RPC only on stdout; diagnostics only on stderr; 1 MiB input bound. |
| Unsupported protocol downgrade | Modern per-request metadata and explicit `-32022` supported-version response; no silent legacy interpretation. |

## Residual risks

- A compromised MCP host can read values the user intentionally supplies to that host, including guest PII and confirmation URLs.
- Public slot discovery can be scraped within configured limits.
- Human confirmation reduces unintended writes but cannot correct a human-approved malicious or misleading preview; the browser must be origin-authentic and exact.
- Availability remains volatile by design. A prepared slot may disappear before commit.
- Local environment variables and process execution remain the responsibility of the machine operator.

## Out of scope for v1

Remote Streamable HTTP MCP, OAuth delegation, owner/admin operations, autonomous confirmation, service-role impersonation, hosted control-plane credentials, dynamic client registration, AI extraction of natural-language booking requests, and arbitrary plugin execution are not part of this release boundary.
