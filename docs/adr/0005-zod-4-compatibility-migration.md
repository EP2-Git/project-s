# ADR 0005: Zod 4 compatibility migration

- **Status:** Accepted for local implementation; publication and integration gates remain
- **Date:** 2026-10-24
- **Owner:** Ethan Patten, lead maintainer
- **Issue/Discussion:** [prior PR 28 migration decision](https://github.com/EP2-Git/project-s/pull/28#issuecomment-6203932234), [migration RFC](../rfcs/zod-4-compatibility-migration.md)
- **Supersedes:** None; ADRs 0001, 0003 and 0004 retain their authority and contract decisions

## Context

Zod 3.25.76 remains affected by the high collection-validation advisory described
in the [resource-limit investigation](../zod-resource-limits.md). Local early
array guards and streamed byte limits reduce application exposure but do not
clear the dependency finding. An automated Zod 4 bump fails contract compilation
and does not establish compatibility.

The repository previously required an RFC/ADR and parity process for this major
migration. On 2026-10-24, Ethan reviewed the recommended path and instructed
"Go with the recommendation." This accepts the compatibility design and local
implementation. Pushing, publishing, merging, deployment, alert dismissal and
credential/security-setting changes remain outside this authorization.

## Decision

Use genuine patched Zod 4.6.7 with compatibility adapters wherever its behavior
differs from Project S's existing contracts. The local candidate also pins the
compatible form resolver 5.2.2. Recheck versions/advisories before publication.
Synchronize Node workspace declarations/lockfile, Edge imports
and compiled package output; do not route application code through `zod/v3`.

Preserve strict v1 and separate unavailable v2 wire acceptance, transform order,
normalization, domain input/output types, public problem/status/path/message
behavior and transport error classes. Keep the existing generated artifact
pins and four-operation/four-tool discovery. If an unavoidable behavior change
is proposed, review it through a versioned contract/RFC rather than replacing
expected outputs to bless drift.

Exported parser classes/generic signatures are a separate TypeScript source
migration. Document this impact even if JSON and domain DTOs stay unchanged.
Do not claim complete source compatibility or suppress type failures with
unsafe casts. The RFC maps the actual Effects/Object annotations, refinements,
object-shape reuse, scalar normalization, form resolvers and error projection.
Native exported parser diagnostic codes also need explicit compatibility review;
updating their historical v3 assertions never permits changing the frozen public
problem/field-error assertions or artifact pins.

Replace the private v3 collection parser only with proven patched native upper
bounds. Keep finite collection cardinalities and zero child work for excessive
arrays, including async/derived schemas. Preserve streamed byte caps and exact
microsecond logic. Unbounded collections remain unbounded.

## Authority and security impact

No new booking or delegated capability is proposed. Authentication, browser
confirmation, scope, expiry, revocation, step-up, replay and deterministic Core
commit rules remain unchanged. A parser accepting a context or object reference
does not establish authority. V2 stays unavailable until its separate reviewed
implementation and enablement gates are satisfied.

Main's affected v3 runtime remains vulnerable. The local candidate resolves
4.6.7; passing local audits do not change remote installation or alert state.
Proposal tests and extracted-package probes alone cannot resolve the finding.
Migration must not weaken security gates or use a v3 fallback to obtain a build.

## Privacy and data impact

Use synthetic compatibility vectors. Preserve minimized public errors and
existing profile/credential disclosure boundaries. Do not enable input
reporting or log raw bodies/issues to diagnose migration differences. No new
storage, retention, telemetry or credential handling is proposed.

## Database and RLS impact

No SQL migration, grant, RLS or transaction change is proposed. PostgreSQL
remains authoritative. Existing pgTAP, cancellation, direct-access denial,
rollback and independent-client concurrency regressions must still pass during
later implementation; parser tests do not prove those properties.

## Public contracts and compatibility

Freeze existing v1/v2 metadata and normalized output. Measure UUID grammar,
date/offset/fraction acceptance, string-length units, optional/null semantics,
error projection, safe integer limits and transform short-circuiting against
the exact target. Preserve existing validators where a new built-in differs.
No new record, union, operation, route, MCP tool or Cloud behavior is introduced.

Bounded official-package probes confirm early rejection of excessive native v4
collections, but also different emoji-length, UUID, unsafe-integer and issue
behavior. A type-resolution-only target probe reports 24 compilation diagnostics
against the historical unadapted contracts. These measured blockers explain
the explicit source migration. The RFC records baseline quirks such as v1's permissive
offsets and local-date year handling; corrections require separate review.

## Alternatives considered

- **Keep mitigated v3:** useful containment, but retains the unresolved advisory
  and failing audit gate.
- **Upgrade without adapters/review:** risks changing public acceptance, errors,
  inferred types and Edge/browser behavior; existing compilation already fails.
- **Use v3 inside a v4 package:** retains the affected parser behavior and fails
  the security objective.
- **Replace the validation library:** broader migration with additional risk and
  no demonstrated need for the current bounded scope.

## Migration and rollback

Migrate source, dependency declarations, lockfile and Edge resolution together
in an isolated candidate. Local implementation approval does not authorize
publishing or merging.

Later rollback must restore a coherent dependency/source/import-map unit and
rebuild workspace output. Restoring v3 restores its risk; restore/retain the
resource mitigations as well. No data or authority state is changed by this
local implementation, and no release/deployment is authorized. The
[consumer migration guide](../zod-4-consumer-migration.md) records the resulting
parser types, native diagnostics, supported adapters and coherent rollback.

## Verification

Require type/build and inferred input/output checks; contract/resource vectors;
unchanged artifact pins/goldens; Node/Deno parity and full Edge checking; SDK,
MCP/examples and forms; SQL/types/races; browser/Axe/responsive/production-bundle
checks; full/production audits, scan/licences and the exact-candidate full
pipeline. Keep existing thresholds and expected jobs intact.

The recorded 28 Deno entrypoint type errors are preexisting evidence to repair
or reconcile, not a waiver. Separate local, focused Deno, bundled Edge and hosted
results, and state unavailable Docker/integration evidence explicitly.

## Consequences

The local implementation replaces the vulnerable runtime with explicit
adapters and a documented TypeScript consumer migration. Exact candidate
compatibility, audit and integration results must accompany its review;
unavailable checks remain gaps. Authority, deployment and production readiness
claims do not change.
