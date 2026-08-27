# Agent booking confirmation flow

Project S treats human confirmation as server-recorded authority, not conversational evidence. An agent may assemble an intent, but it cannot approve that intent on the user's behalf.

## State transition

1. The agent calls `project_s_get_booking_page_v1` and `project_s_list_free_slots_v1` to present current public choices.
2. The agent calls `project_s_prepare_booking_v1` with the chosen slot and booker fields.
3. The API derives the meeting end, title, host zone, booking-policy effects, and a visible preview. It returns a short-lived preparation token, preparation ID, expiry, `notHeld: true`, and a browser confirmation URL.
4. The human opens the Project S URL. The page re-displays the exact host, meeting type, start/end, zones, and guest details represented by the preparation, plus the same terms/privacy acknowledgement used by the direct browser flow.
5. The human accepts that notice, completes the configured abuse challenge, and explicitly approves the preview. In production, the challenge action and `cData` are bound to the exact preparation ID and its hostname must match the operator allowlist. The server records a one-use confirmation grant bound to the preparation, actor/client context, audience, expiry, and request fingerprint.
6. The agent calls `project_s_create_booking_v1` with only the preparation token and a fresh idempotency key.
7. Under the host advisory lock, the scheduling authority re-reads the meeting type, schedule and fresh clock; recomputes availability and the visible preview fingerprint; and inserts under the database exclusion constraint.
8. The server consumes the grant and records the audit outcome atomically with the commit. An exact idempotent replay returns the prior result.

Preparation never reserves or holds a slot. A slot may become unavailable between steps 3 and 7. In that case the API returns `PREPARATION_STALE` or `SLOT_UNAVAILABLE` with safe alternatives, and the agent starts again from current availability.

## What does not count as confirmation

- A tool argument such as `confirmed: true`.
- A model statement that the user approved.
- MCP tool annotations.
- Possession of an unapproved preparation token.
- Opening the confirmation URL without completing the explicit approval.
- An approval for a different preparation, user, actor, client, audience, or expired fingerprint.

The create schema contains no confirmation boolean. This makes bypass attempts invalid at the transport boundary, while the API and database commit path provide the authoritative enforcement.

The v1 notice checkbox is a required client-side presentation gate in both browser
paths; it is not represented as an agent argument and is not stored as a legal
consent record. An operator that needs durable consent evidence must introduce a
reviewed, versioned server-side consent contract and retention policy rather than
inferring consent from the confirmation grant.

## Token and browser constraints

- The preparation token is an opaque, high-entropy, short-lived, audience-bound, one-purpose capability. It contains no guest PII, and the authority stores only its digest.
- The browser URL carries the token in the fragment so it is not sent in the initial HTTP request or ordinary referrer headers.
- The confirmation page uses `Referrer-Policy: no-referrer` and must not load third-party analytics, pixels, or untrusted assets.
- Confirmation grants are one-use and cannot be converted into general account credentials.
- Neither preparation nor confirmation links belong in logs, analytics, MCP text blocks, or support screenshots.

## Retry behavior

Confirmation and create are retry-safe across lost responses. Reconfirming the same immutable preview under a compatible verified confirmation context returns the original durable grant without creating another grant or duplicate authority-level confirmation event; the gateway still audits the distinct retry request. For the anonymous public flow, this is intentionally bearer-capability semantics: possession of the opaque preparation token plus a fresh human challenge is the proof, and `clientId=project-s-web` is not a natural-person identity, so cross-device confirmation can succeed. Verified principal, subject, or delegation bindings cannot be substituted. Once approval is recorded, the browser retries create directly with the original idempotency key instead of requesting another grant. Reusing one idempotency key for a different request yields `IDEMPOTENCY_KEY_REUSED` and never causes the browser to rotate keys automatically. An exact create replay remains available through the approved review even after its displayed preparation expiry, because the database must distinguish a committed replay from an expired uncommitted preparation. Retrying an uncommitted expired or stale preparation never creates a booking.
