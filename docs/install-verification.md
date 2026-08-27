# Cross-platform install verification

Public evaluators should not be the first people to discover platform-specific
setup gaps. This document is the checklist for issue-style clean-install
verification on Windows, macOS, and Linux.

## Automated gate (every PR)

CI runs `npm ci` and `npm run test:install-smoke` on:

- `ubuntu-latest`
- `macos-latest`
- `windows-latest`

That smoke path covers Node/npm engine floors, workspace install presence,
shared package builds, typecheck, production Vite build, and the local Edge
env writer. It deliberately **does not** start Docker or Supabase; those remain
the Linux `database` / `e2e` jobs plus manual full-stack checks below.

```sh
npm ci
npm run test:install-smoke
```

## Full local checklist (one OS per contributor is enough)

Use only the synthetic local fixture from `supabase/seed.sql`. Record versions,
wall-clock setup time, undocumented steps, and exact failures.

### Prerequisites to record

| Item | Example |
|------|---------|
| OS | Windows 11 / macOS 14 / Ubuntu 24.04 |
| Node | from `.nvmrc` (22.12+) |
| npm | 10.9+ |
| Docker engine | Desktop Linux containers on Windows/macOS |
| Git | 2.40+ |

### Steps

```sh
git clone --no-local https://github.com/EP2-Git/project-s.git
cd project-s
npm ci
npm run test:install-smoke
npm run db:start
npm run db:reset
npm run db:env
npm run dev
# separate terminal after the app is up:
npm run demo:authority
```

On Windows PowerShell the bootstrap is identical for npm scripts. If `db:start`
cannot connect, start Docker Desktop (Linux containers) and retry. Port
conflicts are reported by the Supabase CLI.

### What to file when something breaks

Open a focused follow-up issue with:

1. OS, Node, npm, Docker versions
2. The exact command and full stderr
3. Whether the failure is install-only or Docker/database-only
4. Whether `npm run test:install-smoke` passed

Do not paste production keys, personal booking data, or workstation absolute
paths beyond the generic drive letter when describing a path bug.

## Scope notes

- Hosted deployment and production readiness are out of scope here.
- Linux CI already exercises fresh `db:start` / double `db:reset`, RLS, concurrency, and Playwright.
- macOS and Windows full Docker stacks are still welcome as manual evidence; attach results to the tracking issue or a release-evidence note.
