# Feature status

This table describes Project S Core `0.1.0-prealpha`. Contract identifiers ending
in `v1` identify the current wire contract; they do not promise stable APIs,
production support, or general availability.

| Capability | Core pre-alpha status | Notes |
|---|---|---|
| Profiles/authentication | Included | Owner data remains RLS-protected. |
| Meeting types | Included | Active types can be published. |
| Weekly/date availability | Included | Interpreted in owner timezone. |
| Public free-slot discovery | Included | Must not expose booking rows. |
| Atomic booking creation | Included | Database-authoritative and concurrency-tested; an internet deployment still requires API-origin abuse controls. |
| Host dashboard | Included | Owner-only private data. |
| Google Calendar | Excluded from Core | No integration or shared OAuth client ships. Any legacy Google OAuth/Calendar surface is outside Project S and is not Project S Cloud onboarding. A supported integration requires a separate contract and release gate. |
| Outbound email | Excluded | UI/docs must not promise delivery. |
| Guest cancel/reschedule | Excluded | Requires a future signed-capability design. |
| AI interpretation | Excluded | Future optional layer; never scheduling authority. |
| Payments/teams | Excluded | No dormant billing schema in the baseline. |
| Gateway rate limiting and confirmation challenge | Included reference boundary | Persisted limits cover all four operations and both browser support routes. Production additionally requires configured Turnstile, HTTPS/origin/hostname allowlists, and a verified proxy-header boundary. |
| Managed Project S Cloud | Planned/unavailable | Cloud Preview 0.1 is a private staging goal with no public signup, billing, SLA, or production traffic. |

An excluded feature must be absent from normal navigation and must not appear successful through placeholder or mocked behavior.
