# Selected hosted-homepage direction

The maintainer-selected concept is **Own Your Booking Flow**, originally reviewed
at `/design-lab/own-your-booking-flow`. Its visual selection is final for this
work unit. The refined, isolated human-review candidate is available only in a
hosted-audience build at:

```text
/design-lab/selected-direction
```

Neither route replaces or claims a live `/` homepage. The three original design
lab routes remain unchanged. Missing, invalid, or `self-hosted` deployment
audience configuration fails closed: the selected route renders the normal 404
surface and its page/chrome chunks are excluded from the self-hosted release bundle.

## What the candidate says

The page follows the durable [product direction and public-claims
contract](product/project-s-north-star.md):

- the north star is an open-source, authority-bounded agent-to-agent booking platform;
- the real current proof is agent discovery and preparation, visible refusal
  without human authority, explicit browser confirmation, locked deterministic
  commit, immutable exact replay, and authenticated host cancellation;
- agent capability is explicitly separated from agent authority;
- the scheduling and authority kernel stays deterministic even when UI,
  confirmation, HTTP, SDK, MCP, notification, model, or federation adapters are
  added or removed;
- bilateral agents, mandates, no-click execution inside a mandate, remote MCP,
  and federation are labeled future direction at the point of the claim; and
- managed Project S Cloud is labeled a planned operating model with no current
  signup, pricing, uptime, or general-availability claim.

The page contains no “first” claim and offers only real local calls to action:
the current Authority Boundary Demo, the fictional booking page, and in-page
explanation. It does not invent a source URL, remote-agent demo, Cloud console,
signup, or waitlist.

## Local review

Install dependencies and start a dedicated hosted-audience server:

```sh
npm ci
node scripts/start-vite-audience.mjs hosted 4184
```

The homepage itself does not require the database. To follow its fictional
booking-page CTA through the real local scheduling path, start and seed the
synthetic authority first:

```sh
npm run db:start
npm run db:reset
npm run db:env
```

The generated local Edge configuration explicitly permits the `4184` review
origin. A different origin remains blocked and the booking UI identifies that
as a site-configuration problem rather than implying a booking-policy refusal.

Open:

```text
http://127.0.0.1:4184/design-lab/selected-direction
```

Run the route, claims, original-concept integrity, hosted/self-hosted bundle,
Chromium/Firefox/WebKit, Axe, keyboard, reduced-motion, console, and reflow
coverage with:

```sh
npm run test:homepage:selected
```

Generate the ignored seven-viewport Chromium capture corpus with:

```sh
npm run capture:homepage:selected
```

Captures are written to `test-results/hosted-homepage-selected`. Hosted and
self-hosted bundle evidence is written to
`test-results/selected-homepage-bundles`. Both locations are already covered by
the repository's `test-results` ignore rule.

Project S is a client-rendered Vite application, so the route requires JavaScript
to render. Current/future labels and all substantive copy are ordinary semantic
HTML once rendered; they do not depend on animation, color, or interaction.
Reduced-motion mode removes the meaningful transition timing without removing
content. A separately server-rendered no-JavaScript marketing surface is outside
this bounded candidate.

## Human review gate

Review the isolated candidate at desktop and mobile widths and decide whether its
copy and composition should later replace the future managed `/` page. That
replacement, deployment, Cloud availability, and any new authority provider
remain separate owner decisions.
