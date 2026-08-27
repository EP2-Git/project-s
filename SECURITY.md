# Security Policy

## Supported version

Project S has no production or supported version yet. Security fixes for the
current public pre-alpha are handled on a best-effort basis; no response-time,
compatibility, or production-support guarantee is offered. A version-support
table will be added only when maintainers approve a supported release.

## Reporting a vulnerability

Do not open a public issue. Use the repository's
[private security-advisory form](https://github.com/EP2-Git/project-s/security/advisories/new)
to report the issue to the maintainers.

Include the affected commit/version, reproduction steps, impact, and any suggested mitigation. Do not access data that is not yours, test against a production installation, or retain personal data while investigating.

The maintainers will investigate privately and coordinate disclosure after a fix
is available. Do not test a deployment you do not own without the operator's
explicit authorization, and do not test against production data. Project S Cloud
Preview 0.1 is planned and unavailable; there is no public Project S-operated
service to test.

## Security boundaries

- The browser receives only a Supabase project URL and publishable/anon key.
- Service-role keys and integration credentials must never enter Vite variables or browser bundles.
- Anonymous visitors may receive computed public profile/type/slot data, never raw booking rows or calendar tokens.
- Booking validity and overlap protection are enforced by PostgreSQL in one transaction.
- All privileged functions authenticate and authorize the caller before using elevated credentials.

See [the security model](docs/security-model.md) for the threat model and verification requirements.
