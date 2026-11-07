# ADR 0006: Delegated booking timezone projection

- **Status:** Accepted on 2026-11-06 for the synthetic delegated commit and receipt
- **Owner:** Ethan Patten, lead maintainer
- **Issue:** [#17](https://github.com/EP2-Git/project-s/issues/17)
- **Related:** [ADR 0004](0004-bounded-mandate-implementation.md)

## Context

The reviewed booker profile preserves a guest timezone exactly. Some accepted
values, such as fixed offsets and case variants, are valid in the v2 contract
but fail the existing booking table's PostgreSQL timezone name check. The
approved start and end instants are already fixed independently of that field.

## Decision

Ethan approved preserving the exact reviewed guest timezone in the private
receipt. Copy it to the existing booking row only if the existing timezone
validator accepts that exact value. Otherwise, store null in the legacy field.
The v2 receipt remains the source for guest display and eligible replay. Its
existing access, expiry and privacy rules apply. The legacy validator and v1
contracts retain their existing rules.

## Consequences and proof

A legacy consumer may see an empty guest timezone for such a v2 booking. The
booking still has its exact instants and host timezone. Tests must cover
representable names and unrepresentable reviewed values, unchanged instants,
exact replay and caller isolation. Synthetic enablement and real-user operation
remain separate decisions under ADR 0004.
