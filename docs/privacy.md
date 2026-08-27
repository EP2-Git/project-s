# Privacy

Project S processes host profile/availability information and guest booking information. A self-hoster is responsible for its deployment, retention policy, legal notices, and user requests.

## Data minimization

- Public endpoints expose only the fields required to identify a host, describe active meeting types, and select valid free slots.
- Raw busy intervals and booking rows are private.
- Notes are optional and length-limited.
- Logs must not contain names, emails, notes, authorization codes, tokens, raw request bodies, or provider responses.
- Seed and automated-test records are synthetic.

## External services

Core `0.1.0-prealpha` requires Supabase and the deployment host chosen by the
self-hoster. It does not send scheduling or intake data to Google, an email
provider, or an AI model.

When an operator enables Cloudflare Turnstile for public booking confirmation,
the confirmation page loads Cloudflare's widget and Cloudflare processes
browser, device, and network signals for bot detection. Project S sends the
resulting challenge token, a random Siteverify retry identifier, and—only when
trusted proxy handling is enabled—the visitor IP address to Cloudflare's
Siteverify API. The challenge is bound to a stable action name and an opaque
preparation identifier. Project S does not send the guest name, email, notes,
meeting time, or other form entries to Siteverify.

Operators must disclose and lawfully configure this processing. See Cloudflare's
[Turnstile overview](https://developers.cloudflare.com/turnstile/),
[server-side validation reference](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/),
and [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).

The baseline uses system font fallbacks and does not contact a remote font host. If a deployment adds remote fonts, document the resulting network disclosure; if it bundles fonts, record their provenance and license in `ASSET_PROVENANCE.md`.

## Retention and deletion

No universal retention duration is imposed by the codebase. Before operating a public instance, document retention, backups, deletion behavior, and the process for responding to access/correction/deletion requests.

This document and the in-application privacy page are self-hosting templates, not
a privacy policy for a Project S Cloud service. Cloud Preview 0.1 remains planned
and unavailable; it requires its own operator-specific review before traffic.
