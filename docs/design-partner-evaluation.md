# Design-partner evaluation guide

Evaluate the current public Core pre-alpha with disposable synthetic data. The
goal is comparable feedback from three to five technical evaluators who can
follow this guide without private coaching. Publishing this guide does not mean
those evaluations have happened. No hosted signup, customer onboarding, support
response time, or production security audit is offered.

Success is understanding and reproducing the authority boundary: an agent can
prepare a request, a person approves its exact details, and PostgreSQL makes the
first commit decision. Standing mandates and autonomous or bilateral booking
are future work; see [feature status](feature-status.md).

## Before starting

- Use a local desktop session with Git, Node from [.nvmrc](../.nvmrc) (22.12+),
  npm 10.9+, a running local Docker engine, and a browser. On Windows, Docker
  Desktop must use Linux containers. No paid service, LLM, hosted Supabase
  project, or production credentials are needed.
- Use only `demo-host`, the seeded `Intro call`, and fictional guests. Do not
  import calendars or enter real names, emails, meeting notes, or customer data.
- The local stack uses a shared project ID across checkouts. An empty clone
  does not make an existing Docker database disposable. Bootstrap refuses
  existing containers or retained volumes; do not delete them to get past a
  refusal. Use [safe reuse or the manual workflow](local-development.md#existing-data-and-retries)
  after inspecting ownership, or use a separate local environment.
- Keep a private copy of the [feedback worksheet](evaluation-feedback-template.md).
  Leave names and employer details out. Record any help you need; an assisted
  session is useful evidence but is not an independent completion.

Start a timer before cloning. Record prerequisite installation time separately
from clone-to-app time and app-to-completed-flow time. A blocked or partial run
is useful feedback; do not mark unattempted stages as passes.

## 1. Clone and start the disposable fixture

These commands work in PowerShell and a POSIX shell. Use an empty destination:

```sh
git clone --no-local https://github.com/EP2-Git/project-s.git
cd project-s
git rev-parse HEAD
node --version
npm --version
docker --version
npm run doctor
npm run bootstrap
npm run dev
```

Record the exact commit and versions in your worksheet. Doctor may warn about
missing dependencies or generated environment in a fresh clone. Resolve failed
checks using [local development](local-development.md); do not bypass them.
Bootstrap installs the lockfile, builds packages, creates and resets a **new**
local stack, seeds fictional data, and writes ignored local configuration. It
does not start the app; leave `npm run dev` running in this terminal.

Open `http://127.0.0.1:8080/book/demo-host` to inspect the synthetic public booking
page. The default `/` route is login/dashboard, not a hosted marketing page.
Do not create a separate manual booking yet. Record when the app first works.
Never include `.env.local`, Edge environment files, Docker/Supabase diagnostics,
or capability links in feedback.

## 2. Try one integration transport

In a second terminal, from the same repository root, choose one command:

```sh
npm run examples:http
npm run examples:sdk
npm run examples:mcp
```

One transport is sufficient for this evaluation; record which one. The SDK is a
source workspace package, not an npm release. MCP launches its own local stdio
subprocess, without a model or external MCP client. These examples call the
running local API, not a mocked success path.

Expected observations:

1. Discover the seeded host and a returned meeting type.
2. Select a server-listed slot within the next 14 UTC dates.
3. Prepare the fictional intent with `notHeld=true`.
4. Re-list the date and see that preparation did not remove the interval.
5. Create is refused with `CONFIRMATION_REQUIRED`, status `428`, and retry action
   `confirm_in_browser`. This refusal is the expected success of the example.

The command stops there; it does not approve or commit. It withholds tokens,
guest fields and confirmation URLs. Do not extract a token to continue this
example manually. See [the examples guide](../examples/README.md) for source and
failure behavior. Avoid repeatedly running all transports: they consume normal
rate limits and create expiring preparations.

## 3. Complete the joined authority flow

From the second terminal, use the separate interactive walkthrough:

```sh
npm run demo:authority
```

This uses a new preparation and launches the real MCP subprocess. It reuses the
running app; if the app is absent it can start a temporary loopback proxy. The
guided command does not reset the database. Follow all eight numbered stages:

| Stage | What to observe and record |
| --- | --- |
| 1. Local service | Contract v1 health succeeds. |
| 2. MCP discovery | Exactly four approved public tools; no cancellation or approval tool. |
| 3. Availability | The seeded `Intro call` has a server-listed future slot. |
| 4. Preparation | `notHeld=true`; the capability token and handoff URL are withheld from terminal output. |
| 5. Refused create | `BLOCKED CONFIRMATION_REQUIRED` before browser approval; no commit occurred. |
| 6. Browser authority | The default browser opens the exact review page. Inspect host, meeting, time zones and fictional guest fields; accept the notice, complete the local challenge, and choose **Approve booking**. Wait for **Human authority recorded**, then type `APPROVED` in the terminal. Typing it alone grants no authority. Approval itself has not created a booking. |
| 7. Commit and exact replay | The first create reports `status=confirmed`; an identical request returns the same result. A new idempotency key is not an exact replay. |
| 8. Host cancellation | The script switches to the fictional host's authenticated session, resolves exactly one booking through RLS, and cancels using its current version. Expect `status=cancelled` and **Authority Boundary Demo complete**. |

Record each stage as pass, fail, or not attempted. The host cancellation is an
authenticated host RPC used by the dashboard, not agent/guest cancellation or a
fifth public operation. The script checks one persisted row after replay and a
version increment on cancellation. The [demo guide](authority-boundary-demo.md)
explains these assertions and their limits.

Afterward, you may sign in at `http://127.0.0.1:8080/login` using the **public,
fictional, local-only fixture** `demo@project-s.local` /
`project-s-demo-password` and inspect the cancelled booking in the dashboard.
Do not reuse these fixture credentials on any service or paste session tokens.
The guided flow already cancels; do not expect a second active booking to cancel.

## 4. Record understanding, friction and failures

Before rereading the explanation, answer in your own words:

1. Does preparation hold a slot or authorize booking?
2. What changes at browser approval, and what still has to happen at commit?
3. What prevents an exact retry from creating another booking?
4. Who may cancel in this version, and what can the MCP client not do?

Capture the smallest useful improvement, any undocumented step, the first
failure, and which part of the distinction between ability and authority was
unclear. Use the same [worksheet](evaluation-feedback-template.md) for each run.

| Symptom | Next action |
| --- | --- |
| Doctor/bootstrap refuses setup | Record the failed check and consult [local development](local-development.md). Preserve existing containers, volumes and configuration. |
| Example cannot reach the API | Check the first terminal and local Docker readiness. Use the default loopback origin and generated local configuration. |
| Guided demo cannot open a browser | Use an interactive local desktop terminal with a default browser. A headless or automated test is separate evidence. |
| No slots, expired/stale preparation, or conflict | Record the exact safe error and step. Preparation is not a hold; restart discovery when ready. Do not claim the first run passed. |
| Rate limit | Stop repeated attempts and wait for the service's retry guidance. Do not disable the limiter. |
| Approval fails | Inspect the local review/challenge and generated loopback configuration; never simulate approval by changing a tool argument. |
| Cancellation/cleanup fails | Inspect the booking as the fictional authenticated host and cancel it through the dashboard. Preserve the failure in feedback. |

For a clean rerun, first confirm that the local stack is disposable and that no
other checkout uses it. `npm run db:reset` erases that local database; it is not
a generic repair step. `npm run bootstrap -- --reuse` preserves a previously
verified setup's data and environment; it does not reset the fixture. To finish,
stop the dev server with Ctrl+C. Stop the local stack with `npm run db:stop`
only when it is yours and no other local work needs it.

## 5. Share only the summary you choose

Keep the worksheet private by default. Submission is optional; review and
redact it yourself before opening the
[Evaluation feedback form](https://github.com/EP2-Git/project-s/issues/new?template=evaluation_feedback.yml).
It asks for commit, platform, setup time, furthest stage, friction, authority
clarity and one improvement. Paste only the relevant sanitized worksheet
sections into the friction field. Use [Discussions Q&A](https://github.com/EP2-Git/project-s/discussions/categories/q-a)
for usage questions and [private vulnerability reporting](../SECURITY.md) for a
suspected security issue. Do not post a vulnerability reproduction publicly.

Public feedback is visible on GitHub and associated with the account posting it;
it is not anonymous. No telemetry is added by this guide. Do not attach raw
terminal/network logs, environments, screenshots of capability URLs, guest or
customer data, workstation paths, or production identifiers. Describe the
command, expected result and sanitized actual result instead. No recording,
public attribution, quotation, or testimonial is requested by participation;
obtain separate permission before any such reuse. There is no promised support
response time.

For three to five evaluations, a coordinator can summarize stage counts,
setup-time ranges, recurring friction and the next proposed improvement without
names, account handles, employers, quotes or raw reports. State how many runs
were independent, assisted, partial, blocked or not attempted. Do not count
maintainer/agent rehearsals as independent evaluations or imply external review
has happened. Record any permission for further sharing separately.

## Interpret the evidence

This exercise proves a synthetic local flow through the current contracts.
The local challenge does not establish natural-person identity, email ownership
or production bot resistance. A passing flow is not application-wide coverage,
official MCP certification, an external security audit or Cloud readiness.
Calendar integration, outbound email, guest changes and standing mandates are
absent. See [testing](testing.md), [cross-platform evidence](install-verification.md)
and [publication gates](publication-readiness.md) before making broader claims.
