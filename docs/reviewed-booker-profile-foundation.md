# Private reviewed booker profile foundation

This internal unit implements the reviewed-profile portion of accepted
[ADR 0004](adr/0004-bounded-mandate-implementation.md) under
[#17](https://github.com/EP2-Git/project-s/issues/17). A verified principal can
record immutable normalized `{name,email,guestTimeZone}` details and explicitly
delete them. It configures no instance and exposes no HTTP, UI, SDK or MCP
operation. A profile is neither booking authority nor permission to monitor an
agent. The existing app and labelled Authority Lab are unchanged.

## Authentication, storage and privacy

The server-only `reviewedBookerProfiles.ts` adapter uses existing strict v2
control schemas. Its caller must freshly verify the account with
`authenticatePrincipal` before passing the server-derived context. Actor
contexts, caller-supplied identity, notes and extra fields are refused. The
adapter preserves existing ASCII-space name/email normalization, email
lowercasing, UTF-16 name bounds and accepted timezone spellings. No profile PII
is returned by a successful control or included in a public error.

The private table has RLS, no client policies and no direct grants, including to
the service role. Only narrow service-role RPCs can create/delete. Service keys
are a server trust boundary, never browser credentials. SQL rechecks the live
instance/epoch, account and enabled principal under the existing C1 fence;
ownership checks precede profile locks. There are no foreign keys or cascades
into legacy Auth, profiles or bookings. The same scoped timeout limitations
described in the [credential foundation](actor-credential-foundation.md) apply.

Review time and expiry are derived after locks using actual wall-clock time.
Validity is exactly 168 hours from review. Details and revision one are
immutable; changing details requires a new reviewed object. The server generates
the private UUID. SQL can reconcile an exact matching internal-ID create retry
without extending time or appending an event, but expired/deleted objects cannot
be revived. The public create input has no idempotency field; there is no
automatic create retry or promise of recovering an uncertain result here.

Deletion compares the original revision, clears name, email and timezone in the
same transaction as its minimal ordered audit event, and retains a private
tombstone. An exact delete retry returns the original acknowledgement without
another event. Another principal's reference and an unknown reference receive
the same minimal refusal. Deleting an expired profile is allowed. Audit failure
rolls back both state and event sequence; deletion does not remove a booking or
claim erasure from an operator's backups.

## Proof and remaining gates

Identical bounded Node/Deno adapter vectors cover strict inputs, normalization,
Unicode/timezone boundaries, response validation, redacted errors and no retry
or fallback. Disposable SQL fixtures cover role grants, direct-RPC denial,
ownership, exact retries, deletion/expiry, live account/epoch/principal checks
and audit rollback. Independent dblink sessions observe actual fence waits,
then verify fresh review time, expiry during retry, delete ordering, principal
disable, epoch change and account deletion. Adapter doubles are separate from
live database evidence.

`npm run test:authority:live` requires `PROJECT_S_DISPOSABLE_AUTHORITY_TEST=1`,
the checkout's verified bootstrap marker, an owned local Docker stack and the
loopback API on port 54321. It refuses existing authority configuration. Two
normal synthetic Auth signups exercise genuine `getUser` verification and the
server adapter through PostgREST/service RPCs. Other-principal controls and
direct calls with real anonymous/authenticated clients are denied. Credentials
remain in memory, diagnostics are redacted, and only owned random synthetic
fixtures/configuration are removed. CI runs this proof on its disposable stack;
an unavailable local Docker engine is not local integration evidence.

Expiry is enforced on retries, but does not yet purge stored PII. Expired/orphan
cleanup, bounded audit/tombstone retention and recovery remain required before
enablement. There are no mandates yet: future mandate storage must add atomic
dependent invalidation under this same fence before profile deletion can
acknowledge success. This unit does not prove that unimplemented behavior.
Mandate review/approval, one-use commit, step-up, receipts, mixed v1/v2 races,
issuer UI and genuine authorized monitoring remain separate work. Explicit
reviewed synthetic enablement is still required after the complete proof.

## Migration and rollback

The additive migration changes only private v2 state, two service-only RPCs and
the minimal audit action allowlist. Generated public RPC types must match the
migration stack; public v1 schemas/artifact pin and existing table grants remain
unchanged. Require the full latest-candidate/current-main pipeline before merge.

Prefer a forward repair and keep routes/configuration disabled. A code revert
cannot erase existing PII, revoke authority or undo a booking. Preserve private
tombstones/events while referenced; remove synthetic fixtures only through the
owned disposable proof. Do not drop the new table or restore deleted profile
details as a rollback shortcut.
