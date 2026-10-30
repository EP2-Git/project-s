# Repeatable local booking demo

This walkthrough uses the working app, local Supabase Auth, the HTTP booking
boundary and PostgreSQL. It creates disposable demo identities through the
signup form, saves setup, books from a separate guest browser, cancels as the
host and deletes the run-owned account and booking records. It then repeats
with the same email and username and a different Auth identity.

Account deletion here is an explicitly guarded **local operator** action. The
application's public self-service deletion and retention contracts remain
unchanged. Minimal booking audit, provider logs and rate-limit records remain;
this walkthrough does not promise erasure of every byte.

## Start and run

Use a fresh unlinked checkout, the Node/npm versions in the repository, Git and
a healthy local Docker engine. Existing databases must be preserved.

```sh
npm ci
npm run build:packages
npx playwright install chromium
node scripts/local-demo.mjs --headed
```

For an unattended browser run, use `npm run demo:local`. The command runs two
complete cycles and writes sanitized verdicts and screenshots to ignored
`output/playwright/local-demo-<run-id>/`. It records no network trace, HAR,
password or session token in those artifacts.

For the normal app without the automated walkthrough:

```sh
node scripts/local-demo.mjs --serve
```

Open `http://127.0.0.1:8080`. Stop the app with Ctrl+C. Accounts created manually
through that app are preserved; the demo's cleanup accepts only its exact
run-owned identity and cancelled booking manifest.

## Isolation and reuse

The demo uses its own project under ignored `.cache/local-demo-stack`, with a
name derived from this checkout. It leaves existing `project-s-local` containers
and retained volumes intact. First initialization checks ownership before
applying migrations to its newly created database. Subsequent runs verify the
same backend configuration, migrations, seed and function sources, generated
environment, container and network and reuse the stack
without resetting it.

The API, database, Studio and mail ports bind to localhost through a separate
owned Docker bridge, following the [Supabase local-development guidance](https://supabase.com/docs/guides/local-development).
Vite also binds to localhost. Foreign endpoints, inherited frontend overrides,
redirected paths, changed source or environment, missing ownership and recreated
containers fail closed. A partial setup is preserved for diagnosis; do not
delete data or fabricate an ownership marker to bypass a refusal.

The cleanup takes the existing owner boundary, requires the exact reserved
identity and one host-cancelled booking, refuses additional authority/storage
state or external references, and keeps audit records. The runner verifies
actual Auth rejection, the missing public booking page, audit retention,
baseline public rows/Auth UUIDs and refusal of an old preparation after the
username is recreated. A failure after account creation preserves its data and
ignored diagnostic manifest rather than running broad cleanup.

Real rate limits remain active. Several rapid repetitions can reach the
existing prepare/create window. The walkthrough checks its five-create/two-prepare
budget before signup and reports a numeric retry delay when a window is full.
Respect the reported retry time; do not clear
rate-limit buckets or disable a challenge to make a run pass.

## Scope

This is an operator-run, locally hosted Slotly walkthrough using disposable
identities and real backend operations. It does not enable the private Cloud
preview, deploy a service, send external mail, use customer data, configure
calendar providers or enable delegated booking/live agent monitoring.
