# Private actor credential foundation

This is the first internal C1 storage/verifier unit from accepted
[ADR 0004](adr/0004-bounded-mandate-implementation.md), tracked under
[#17](https://github.com/EP2-Git/project-s/issues/17). It enables no v2 HTTP,
issuer UI, SDK/MCP credential path or delegated booking. The Authority Lab
remains a labelled simulation. Credential authentication is not booking authority.

## State and trust boundary

The forward migration creates private synthetic instance configuration,
per-principal fences, one credential per distinct actor identity and minimal
sequenced events. It deliberately inserts no instance configuration. An
unconfigured instance fails closed; there is no public initialization,
production-retention or recovery endpoint. Tests configure only synthetic data.
Private tables have RLS and no direct grants to anonymous, authenticated or
service roles. Only narrow service-role RPCs can register, read verifier metadata
or revoke. The service key remains a trusted server credential, never a browser
key. Context fields are server inputs, not an authorization mechanism by themselves.

`actorCredentials.ts` is a server-only adapter. It verifies issuer accounts with
Supabase Auth `getUser`, requires an explicitly non-anonymous registered user
and derives both principal and subject from that result. It never uses decoded
claims, `getSession`, metadata, email or a client principal override. Auth failure
or outage denies before a privileged RPC. Expected instance UUID, epoch and
canonical API origin come from trusted server configuration, never Host headers.

Agent credentials use `psa2.<random UUID>.<32 random bytes as canonical base64url>`.
The server stores SHA-256 of the decoded random secret, never the raw credential.
Malformed/noncanonical tokens fail before a lookup. Native fixed-size
`timingSafeEqual` compares 32-byte verifiers in Node and Deno; a missing or malformed
lookup also performs the fixed-size comparison. This is not a claim that network,
database or all rejection paths take identical time. Internal errors are redacted.

The registration adapter returns raw material only after a successful matching
database result, and no lookup recovers it. Future issuer routes must add
`no-store`, same-origin/CSRF protection and reviewed secret transfer. Those routes
are absent here; do not put raw credentials in URLs, browser storage, tool inputs
or logs. An uncertain registration is not permission to issue overlapping
credentials or compensate for an uncertain booking. Replacement must revoke the
old identity and create a different actor with fresh mandates; no rotation,
refresh or receipt transfer exists in this unit.

## SQL guarantees within this unit

The issuer-only register RPC bootstraps an epoch/principal fence. Lookup cannot
bootstrap one. Register, lookup and revoke take that fence before credential
locks; live Auth account key-share locks use NOWAIT. No legacy auth/profile/
booking foreign keys or delete cascades enter the new state. Composite private
keys prevent cross-principal references. Lookup re-reads current config/account/
principal/credential state and checks fresh expiry after its waits. Credentials
last at most 168 hours and cannot be refreshed. Revocation advances revision once;
the exact original revoke retry returns the original acknowledgement and adds no
second event. Stale requests and another principal's object refuse.

Issuance/revocation and their private ordered audit event commit together; audit
failure rolls back state and sequence. Event payloads contain only their private
partition, sequence, action and time; credential rows link the relevant event
sequence. No secret, actor lookup ID, label, prompt or booker fields enter the
event payload. These linked private partitions remain sensitive identity data.
Public errors never expose verifier metadata or upstream diagnostics.

RPCs carry one-second lock and five-second statement timeout settings. Lock
timeout and NOWAIT refusals map to `AUTHORITY_BUSY`; callers retry the same
identity and must never fall back to v1. A function-local `statement_timeout`
setting alone is not a proof that an already-running outer statement's timer
was restarted. Future admission/transaction integration must establish the full
bounded deadline and retry behavior before enabling a route. This unit does not
claim a complete mixed v1/v2 scheduling lock proof.

## Verification and remaining gates

The same 18 bounded credential/Auth/metadata/error vectors run in Node and Deno.
New pgTAP fixtures cover default-deny grants and direct RPC calls, wrong bindings,
missing/anonymous/deleted accounts, disabled principals, seven-day limits,
revocation/CAS/retry, audit privacy/rollback and legacy-FK isolation. Separate
dblink sessions observe actual principal-fence waits, then prove that expiry
during that wait and committed revocation deny the later lookup. All test data
is synthetic; the dblink fixture is only for the disposable local/CI stack.

This is an unexposed foundation. Reviewed profiles, mandate issuance/approval,
permission scope and one-use budget, step-up, receipt serializers and privacy,
retention cleanup/tombstones, offline recovery/epoch invalidation, real
Auth-to-RPC transport integration and issuer UI remain required. Full current-head
CI, exact generated-type comparison and v1 browser/race regressions still gate
merge. An independent evaluator and bilateral agent proof remain separate.

Prefer a forward repair. Keep routes disabled and retain any issued credential
tombstones and private audit until their reviewed cleanup/recovery procedure is
implemented. Reverting application code cannot revoke durable credentials or
undo bookings. No legacy booking or production configuration is changed here.
