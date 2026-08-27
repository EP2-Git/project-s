# Hosted homepage design lab

These three noindex routes are isolated visual studies for Project S's own hosted
website. They are not a live or generally available `/` route and they are unavailable when
the deployment audience is missing, invalid, or `self-hosted`.

| Concept | Local route | Primary idea |
| --- | --- | --- |
| Authority Pipeline | `/design-lab/authority-pipeline` | The refusal and human-authority boundary are the hero artifact. |
| Scheduling Kernel | `/design-lab/scheduling-kernel` | Typed transports converge on one deterministic Postgres authority. |
| Own Your Booking Flow | `/design-lab/own-your-booking-flow` | The guest booking page and host dashboard lead; agent parity follows. |

Start an isolated hosted-mode review server:

```sh
node scripts/start-vite-audience.mjs hosted 4180
```

Then open:

- `http://127.0.0.1:4180/design-lab/authority-pipeline`
- `http://127.0.0.1:4180/design-lab/scheduling-kernel`
- `http://127.0.0.1:4180/design-lab/own-your-booking-flow`

Run the cross-browser semantic, Axe, reduced-motion, console-error, and layout
checks with:

```sh
npm run test:homepage:lab
```

Generate the reproducible seven-viewport Chromium capture corpus with:

```sh
npm run capture:homepage:lab
```

Captures are written to ignored `test-results/hosted-homepage-lab`. They are
review evidence, not shipped product assets.

The studies use only current Project S behavior and fictional local fixture data.
They do not demonstrate calendar-provider sync, outbound notifications, model
reasoning, paid plans, uptime, deployment security, or production integrations.
