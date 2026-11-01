# Private mandate controls

This internal slice implements the principal-only review, approval, inspection
and revocation controls accepted in [ADR 0004](adr/0004-bounded-mandate-implementation.md)
under [#17](https://github.com/EP2-Git/project-s/issues/17). It adds no configured
instance, public route, issuer UI, SDK/MCP operation or delegated booking. The
existing app and labelled Authority Lab remain unchanged. Monitoring and
approval authority remain separate; neither is granted by possessing an ID.

## Review and exact approval

The server-only `mandateControls.ts` adapter accepts only a freshly verified
principal context and the existing strict v2 control inputs. Call
`authenticatePrincipal` immediately before it. SQL independently verifies the
live instance/epoch, account, principal and object ownership under the existing
principal fence. Actor contexts cannot issue or revoke authority. Anonymous and
authenticated clients cannot call these service-only RPCs directly; even the
service role has no direct access to the private tables.

A review resolves one owned active actor credential, one immutable reviewed
profile revision and one current public host/active meeting type. Its summary
contains the exact normalized policy, reviewed name/email/timezone and host/type
display names. SQL computes the digest over that summary and the supporting
binding/snapshot; a client-supplied digest or summary cannot create a review.
Review lifetime is at most five minutes and is further bounded by its live
supporting credential, profile and permission expiry. Review does not reserve a
slot or consume a booking budget.

Approval requires the exact review revision/digest and rechecks the supporting
objects and current host/type snapshot. Changes require a new review; approval
does not silently change the policy. Permission is one booking, one actor,
profile and resolved host/type, with fixed meeting bounds and maximum derived
duration. Permission expiry is bounded by the supporting objects and at most
24 hours after the actual issuance time. Choose `notBefore` far enough in the
future to allow review and approval: the accepted rule is `issuedAt <= notBefore`,
not a server-adjusted start time. The approved policy is stored without profile
PII; the review's sensitive summary is cleared atomically.

Exact matching approval retries return the original still-eligible mandate and
original timestamps, without a second permission or event. They do not restore
revoked, expired or unsupported authority. Creation/approval adapters perform no
automatic retry or compensating create. Reconcile uncertain outcomes; an
uncertain result is not permission to issue replacement booking authority.

## Revocation, deletion and locking

Owner inspection returns only state/revision/times/remaining uses. Inspection is
an internal RPC adapter, not a public serializer, booking lookup or actor receipt.
Credential/profile expiry and revocation are enforced on reads even without a
cleanup worker. Inspection does not revalidate the current host/type snapshot
or establish admission; the future booking kernel must do that. This slice
cannot spend a use: booking commit, step-up and receipt
semantics remain unimplemented.

Revocation compares the original revision, records a minimal ordered audit
event and acknowledges only after commit. An exact revoke retry returns the
original acknowledgement without a second event. Deleting a reviewed profile
under the same principal fence invalidates its pending reviews, clears their
summaries and revokes all active dependent mandates before deleting the profile
PII. Audit failure rolls back the entire operation, including event order and
dependent changes. This does not delete existing bookings or operator backups.

All new state has default-deny RLS, narrow service-role RPC grants and private
references. No foreign keys/cascades enter legacy Auth, host, meeting-type or
booking tables. Shared legacy row/owner boundaries use nonblocking acquisition;
busy state produces `AUTHORITY_BUSY`, with no fallback to v1. Fresh time and
live checks occur after waits. The existing one-second lock/five-second
function settings do not establish an outer admission deadline; that integration
and the complete mixed booking lock graph still gate enablement.

## Verification and remaining work

Shared Node/Deno vectors exercise exact normalized policy/microseconds, strict
contexts/inputs, response identity/privacy and redacted failures without fallback.
Disposable pgTAP and independent dblink sessions exercise grants, lifecycle,
expiry/staleness, ownership, real fence waits and audit rollback. The extended
`npm run test:authority:live` uses genuine synthetic Auth accounts and PostgREST
to exercise the server adapter, principal isolation, direct-RPC denial and
profile-dependent invalidation. Its existing explicit disposable-test opt-in,
verified bootstrap/loopback checks and scoped fixture cleanup remain.
Report local, hosted and adapter-double evidence separately.

Public v1 schemas/artifacts, four-tool discovery, scheduling/confirmation,
browser appearance and host cancellation are unchanged. Retention cleanup,
recovery/epoch invalidation, full delegated commit/step-up/replay/race proof,
issuer controls and genuine authorized activity monitoring remain required.
Explicit synthetic enablement review remains separate; bilateral #18 and
real-user/Cloud policy are still gated. This is progress toward a working
human-agent partnership, not a working monitoring interface or Cloud service.

## Migration and rollback

The additive migration creates private review/mandate state, narrow controls,
minimal audit actions and a replacement profile-delete function with atomic
dependent invalidation. Public generated RPC types must match the migrated
stack. It inserts no instance configuration or test data.

Prefer a forward repair with routes disabled. Reverting application code does
not revoke durable authority, undo bookings or erase stored data. Do not revert
profile deletion to its pre-mandate implementation or drop private tables,
events or tombstones while referenced. Preserve the revocation/invalidation
fences and apply reviewed retention/recovery procedures before re-enabling any
future delegated write.
