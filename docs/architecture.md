# Architecture

Project S is a browser application backed by Supabase Auth and PostgreSQL. The design deliberately separates public presentation, deterministic scheduling, and persistence authority.

## Boundaries

1. **React client, TypeScript SDK, and MCP adapter** — collect intent and render
   results through the same four strict public operations. They are never
   authoritative for availability, confirmation, or conflicts.
2. **`api-v1` Edge gateway** — derives execution context, applies persisted abuse
   controls and minimized audit, serves browser-only preview/confirmation support
   routes, and holds the server-only authority adapter credential.
3. **Scheduling database functions** — prepare a non-holding intent, record the
   server-verified human grant, and revalidate the first commit under the host
   advisory lock.
4. **PostgreSQL constraints and RLS** — provide final concurrency, ownership, and
   persistence guarantees even when transports race. The authenticated owner
   dashboard remains RLS-bound and uses a version-checked host cancellation RPC.

```text
Browser UI -----------\
TypeScript SDK --------> /api/v1 gateway -> application use cases
stdio MCP -> SDK ------/                         |
                                                  v
                                      service-role authority RPCs
                                                  |
                                                  v
                                  host lock + RLS + DB constraints

Authenticated owner dashboard -> RLS queries + host-only cancel RPC
```

## Source layout

- `src/components` and `src/pages`: user interface
- `src/hooks`: UI orchestration and remote-state hooks
- `src/lib`: shared client/time primitives
- `src/services`: typed browser boundaries
- `src/integrations/supabase`: generated schema types and client creation
- `supabase/migrations`: complete, ordered schema authority
- `supabase/tests`: schema, RLS, and transaction tests
- `tests/unit`: isolated tooling and domain tests
- `tests/e2e`: browser/accessibility coverage

## Environment model

The Vite client accepts only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Local, preview, and production deployments use distinct Supabase projects. Production values must not be committed or hard-coded.

The agent-native Core pre-alpha requires the included `api-v1` Edge
Function for its four public booking operations. It has no Google Calendar,
notification, or AI runtime requirement. Optional integrations may be introduced
later behind typed server-side adapters without changing scheduling authority.

## Change rules

- Never move validation or conflict authority into the browser.
- Never use a service-role client before caller authentication and object authorization.
- Schema changes begin as migrations and update generated types and tests together.
- A clean `supabase db reset` is the reproducibility test; a manually configured hosted database is not schema authority.
