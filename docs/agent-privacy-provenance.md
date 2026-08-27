# Agent privacy and provenance

Agent access does not weaken Project S's data-minimization rules. The same response schemas, reason codes, retention policy, and scheduling authority apply to the human UI, HTTP API, SDK, and MCP.

## Data visible to an MCP client

- Public host profile fields and active public meeting types.
- Public scheduling horizon and minimum notice needed to explain valid choices.
- Requested-date free slots, with start/end instants and the display time zone.
- The derived preparation preview—including the submitted booker fields needed for exact review—expiry, no-hold notice, and confirmation URL.
- The final public booking confirmation fields.
- Stable public errors, retry guidance, and at most three safe alternatives.

Responses do not expose owner or internal booking UUIDs, weekly rules, overrides, buffer values, occupied intervals, raw availability-provider data, database details, or another guest's information.

Booker name, email, and notes travel in the structured prepare input because they are necessary to create the requested booking, and the structured preview repeats them for exact human review. The MCP server never repeats them in its text result or diagnostics, and no discovery, availability, or create response returns them. Clients should avoid copying them into prompts, transcripts, analytics, or logs beyond what their own privacy policy explicitly permits.

## Server-derived provenance

The application layer derives execution context from verified transport and authorization state. It may record:

- Request and operation/version identifiers.
- Actor kind: anonymous, human, API, service, or delegated agent.
- Verified principal and subject identifiers when applicable.
- Client and transport identifiers.
- Delegation and scopes when applicable.
- Confirmation and resource binding.
- Preparation ID and a digest of the idempotency key.
- Outcome, stable problem code, and timestamps.

Callers cannot set the authoritative actor, principal, subject, `on_behalf_of`, scopes, owner, or confirmation state in tool arguments. MCP `clientInfo` is self-reported protocol metadata and is useful for diagnostics only; it is not an identity credential.

## Audit and operational logs

The authoritative audit is private and append-only. It must not contain guest PII, prompts, completions, raw preparation or confirmation tokens, raw idempotency keys, service credentials, or full IP addresses. Abuse-control identifiers use keyed digests with bounded retention.

The rate-limit transaction opportunistically removes expired unconsumed grants, expired uncommitted preparations, and expired rate buckets. Committed preparation rows are retained only for exact idempotent replay after their guest PII has been redacted.

The local MCP process logs only safe event fields to stderr. It does not log tool arguments or raw exceptions. stdout is exclusively the MCP channel and should be treated as sensitive because structured results may include a confirmation URL.

## Operator responsibilities

- Run only trusted MCP hosts on a trusted machine profile.
- Keep the API origin and confirmation origin under operator control.
- Do not capture stdio traffic in general-purpose telemetry.
- Rotate any credential accidentally placed in MCP configuration, even though v1 requires none.
- Apply the documented retention and deletion policy to bookings, audit, and abuse-control records.
