import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  Braces,
  Check,
  CircleCheck,
  Code2,
  Database,
  Eye,
  Fingerprint,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  TerminalSquare,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';

const transportRows = [
  { label: 'WEB UI', detail: 'browser' },
  { label: 'HTTP', detail: '/api/v1' },
  { label: 'SDK', detail: 'TypeScript' },
  { label: 'MCP', detail: 'local stdio' },
] as const;

const traceSteps = [
  {
    label: '01 / INPUT',
    title: 'Prepared intent',
    detail: 'Exact host, meeting type, slot, guest, and time zone.',
    code: 'PREPARED',
    tone: 'neutral',
  },
  {
    label: '02 / BOUNDARY',
    title: 'Create refused',
    detail: 'No server-recorded human approval. Nothing is inserted.',
    code: 'CONFIRMATION_REQUIRED',
    tone: 'blocked',
  },
  {
    label: '03 / AUTHORITY',
    title: 'Human approval recorded',
    detail: 'The exact server-derived preparation is reviewed in-browser.',
    code: 'GRANT_BOUND',
    tone: 'approved',
  },
  {
    label: '04 / TRANSACTION',
    title: 'Current state rechecked',
    detail: 'Clock, policy, availability, grant, and overlap under the host lock.',
    code: 'HOST_LOCK',
    tone: 'neutral',
  },
  {
    label: '05 / RESULT',
    title: 'One booking committed',
    detail: 'An exact retry resolves to the immutable original result.',
    code: 'COMMITTED',
    tone: 'committed',
  },
] as const;

const guarantees: Array<{
  number: string;
  title: string;
  description: string;
  proof: string;
  icon: LucideIcon;
}> = [
  {
    number: '01',
    title: 'A client cannot approve itself.',
    description:
      'Create accepts an opaque preparation token and idempotency key—not a client-supplied confirmation flag. Without a server-recorded grant, the request stops.',
    proof: 'CONFIRMATION_REQUIRED',
    icon: UserCheck,
  },
  {
    number: '02',
    title: 'The latest schedule wins.',
    description:
      'Preparation is not a reservation. Before insert, PostgreSQL rechecks the current clock, scheduling policy, availability, and authority under the host lock.',
    proof: 'locked revalidation',
    icon: LockKeyhole,
  },
  {
    number: '03',
    title: 'Retries converge, not multiply.',
    description:
      'One idempotency key maps to one immutable confirmed result. Repeating the exact request returns that result rather than creating a second booking.',
    proof: 'exact replay',
    icon: RefreshCcw,
  },
  {
    number: '04',
    title: 'Public data stays deliberately narrow.',
    description:
      'Availability responses expose valid slots and bounded alternatives—not private bookings, owner identifiers, busy intervals, or database-shaped records.',
    proof: 'strict v1 schemas',
    icon: Eye,
  },
];

const architectureLayers = [
  {
    label: '01',
    title: 'Presentation',
    detail: 'React booking pages and browser confirmation',
  },
  {
    label: '02',
    title: 'Public boundary',
    detail: 'Versioned contracts, HTTP API, SDK, and MCP adapter',
  },
  {
    label: '03',
    title: 'Application',
    detail: 'Validation, confirmation, abuse controls, and audit',
  },
  {
    label: '04',
    title: 'Authority',
    detail: 'PostgreSQL transactions, locks, RLS, and constraints',
  },
] as const;

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5642d6] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f2efe7]';

const Mark = () => (
  <span
    aria-hidden="true"
    className="relative grid h-7 w-7 shrink-0 grid-cols-2 gap-[3px] rounded-[7px] bg-[#171714] p-[5px]"
  >
    <span className="rounded-[1px] bg-[#f2efe7]" />
    <span className="rounded-[1px] bg-[#8d7cf6]" />
    <span className="rounded-[1px] bg-[#8d7cf6]" />
    <span className="rounded-[1px] bg-[#f2efe7]" />
  </span>
);

const KernelTrace = () => {
  const reduceMotion = useReducedMotion();

  return (
    <figure
      aria-labelledby="kernel-trace-title"
      className="overflow-hidden rounded-[1.5rem] border border-white/15 bg-[#121210] text-[#f5f3ed] shadow-[0_24px_80px_rgba(18,18,16,0.16)] sm:rounded-[2rem]"
    >
      <figcaption className="flex flex-col gap-3 border-b border-white/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/[0.04]">
            <Fingerprint className="h-4 w-4 text-[#a99cff]" aria-hidden="true" />
          </span>
          <div>
            <p id="kernel-trace-title" className="font-mono text-xs font-semibold tracking-[0.18em]">
              AUTHORITY TRACE / V1
            </p>
            <p className="mt-1 text-xs text-white/55">Illustrative view of the real booking contract</p>
          </div>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#a99cff]/35 bg-[#a99cff]/10 px-3 py-1 font-mono text-[10px] tracking-[0.16em] text-[#d8d1ff]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#a99cff]" />
          DETERMINISTIC
        </span>
      </figcaption>

      <div className="grid min-w-0 lg:grid-cols-[0.78fr_1.22fr]">
        <div className="border-b border-white/15 p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">TRANSPORT INPUTS</p>
          <div className="mt-5 space-y-2.5">
            {transportRows.map((transport, index) => (
              <motion.div
                key={transport.label}
                initial={reduceMotion ? false : { x: -12 }}
                whileInView={reduceMotion ? undefined : { x: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.35, delay: index * 0.08 }}
                className="grid grid-cols-[4.2rem_1fr_auto] items-center gap-3 border-b border-white/10 py-3 last:border-b-0"
              >
                <span className="font-mono text-xs font-semibold text-white/85">{transport.label}</span>
                <span className="h-px bg-white/20" />
                <span className="text-right font-mono text-[10px] text-white/45">{transport.detail}</span>
              </motion.div>
            ))}
          </div>

          <div className="mt-8 border-l-2 border-[#8d7cf6] pl-4">
            <p className="font-mono text-[10px] tracking-[0.18em] text-[#a99cff]">ONE CONTRACT</p>
            <p className="mt-2 text-sm font-semibold">Same inputs. Same reason codes.</p>
            <p className="mt-2 text-xs leading-5 text-white/55">
              Transport changes syntax, not scheduling authority.
            </p>
          </div>
        </div>

        <div className="min-w-0 p-5 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">COMMIT PATH</p>
            <span className="font-mono text-[10px] text-white/60">synthetic trace / local</span>
          </div>

          <ol className="relative mt-5">
            <motion.div
              aria-hidden="true"
              className="absolute bottom-5 left-[0.7rem] top-5 w-px origin-top bg-[#8d7cf6]/60"
              initial={reduceMotion ? false : { scaleY: 0 }}
              whileInView={reduceMotion ? undefined : { scaleY: 1 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 1.1, ease: 'easeInOut' }}
            />
            {traceSteps.map((step, index) => {
              const blocked = step.tone === 'blocked';
              const committed = step.tone === 'committed';
              const approved = step.tone === 'approved';

              return (
                <motion.li
                  key={step.code}
                  initial={reduceMotion ? false : { y: 10 }}
                  whileInView={reduceMotion ? undefined : { y: 0 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.35, delay: 0.12 + index * 0.11 }}
                  className="relative grid min-w-0 grid-cols-[1.5rem_1fr] gap-3 pb-5 last:pb-0 sm:gap-4"
                >
                  <span
                    className={`relative z-10 mt-1 flex h-6 w-6 items-center justify-center rounded-full border ${
                      blocked
                        ? 'border-[#f3a27c] bg-[#2a1912] text-[#f3a27c]'
                        : committed
                          ? 'border-[#8fe0bc] bg-[#11251c] text-[#8fe0bc]'
                          : approved
                            ? 'border-[#a99cff] bg-[#201b3d] text-[#c5bcff]'
                            : 'border-white/25 bg-[#121210] text-white/55'
                    }`}
                  >
                    {blocked ? (
                      <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                    ) : committed ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : approved ? (
                      <UserCheck className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <div className="min-w-0 border-b border-white/10 pb-5 last:border-b-0 last:pb-0">
                    <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="font-mono text-[9px] tracking-[0.18em] text-white/60">{step.label}</p>
                        <h3 className="mt-1 text-sm font-semibold tracking-[-0.01em] sm:text-base">
                          {step.title}
                        </h3>
                      </div>
                      <code
                        className={`w-fit max-w-full break-all rounded px-2 py-1 font-mono text-[9px] tracking-[0.08em] ${
                          blocked
                            ? 'bg-[#f3a27c]/10 text-[#f3a27c]'
                            : committed
                              ? 'bg-[#8fe0bc]/10 text-[#8fe0bc]'
                              : approved
                                ? 'bg-[#a99cff]/10 text-[#c5bcff]'
                                : 'bg-white/[0.06] text-white/55'
                        }`}
                      >
                        {step.code}
                      </code>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/50">{step.detail}</p>
                  </div>
                </motion.li>
              );
            })}
          </ol>

          <div className="mt-7 flex items-center gap-3 border-t border-white/15 pt-5 text-xs text-white/50">
            <Database className="h-4 w-4 shrink-0 text-[#a99cff]" aria-hidden="true" />
            PostgreSQL—not the client—makes the final transactional decision.
          </div>
        </div>
      </div>
    </figure>
  );
};

const TransportMatrix = () => (
  <div className="overflow-hidden border-y border-[#1b1b18]/20">
    <div className="grid grid-cols-[4.5rem_1fr] border-b border-[#1b1b18]/15 bg-[#ebe7de] px-4 py-3 font-mono text-[10px] tracking-[0.17em] text-[#5c5a54] sm:grid-cols-[7rem_1fr_8rem] sm:px-6">
      <span>SURFACE</span>
      <span>PUBLIC OPERATION</span>
      <span className="hidden text-right sm:block">AUTHORITY</span>
    </div>
    {[
      ['WEB UI', 'Render and submit an exact booking intent'],
      ['HTTP API', 'Versioned request and problem envelopes'],
      ['TS SDK', 'Typed access to the same four operations'],
      ['MCP', 'Local tools over the public SDK boundary'],
    ].map(([surface, operation]) => (
      <div
        key={surface}
        className="group grid grid-cols-[4.5rem_1fr] items-center gap-3 border-b border-[#1b1b18]/15 px-4 py-5 last:border-b-0 sm:grid-cols-[7rem_1fr_8rem] sm:px-6"
      >
        <span className="font-mono text-xs font-semibold">{surface}</span>
        <span className="text-sm leading-6 text-[#5c5a54]">{operation}</span>
        <span className="hidden items-center justify-end gap-2 text-right font-mono text-[10px] font-semibold tracking-[0.12em] text-[#5642d6] sm:flex">
          SAME PATH
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </span>
      </div>
    ))}
    <div className="grid gap-4 border-t-2 border-[#1b1b18] bg-[#1b1b18] px-5 py-6 text-[#f5f3ed] sm:grid-cols-[7rem_1fr_auto] sm:items-center sm:px-6">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#8d7cf6] text-[#171714]">
        <Database className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold">PostgreSQL scheduling authority</p>
        <p className="mt-1 text-sm leading-5 text-white/55">Fresh checks, host lock, overlap constraint, one commit.</p>
      </div>
      <span className="w-fit border border-white/20 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-white/65">
        AUTHORITATIVE
      </span>
    </div>
  </div>
);

const SchedulingKernel = () => {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const previousTitle = document.title;
    const existingRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = existingRobots?.content;
    const robots = existingRobots ?? document.createElement('meta');
    const createdRobots = !existingRobots;

    document.title = 'Scheduling Kernel — Design Lab | Project S';
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    if (createdRobots) document.head.appendChild(robots);

    return () => {
      document.title = previousTitle;
      if (createdRobots) {
        robots.remove();
      } else if (previousRobots !== undefined) {
        robots.content = previousRobots;
      }
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f2efe7] text-[#171714] selection:bg-[#d7d0ff] selection:text-[#171714]">
      <a
        href="#kernel-main"
        tabIndex={0}
        className={`fixed left-4 top-3 z-50 -translate-y-24 rounded-md bg-[#171714] px-4 py-3 text-sm font-semibold text-white transition-transform focus:translate-y-0 ${focusRing}`}
      >
        Skip to content
      </a>
      <header className="border-b border-[#1b1b18]/15" aria-label="Scheduling Kernel review navigation">
        <div className="mx-auto flex min-h-[72px] w-full max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
          <Link to="/" className={`inline-flex items-center gap-2.5 rounded-sm font-semibold tracking-[-0.02em] ${focusRing}`}>
            <Mark />
            <span>Project S</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-5">
            <span className="hidden font-mono text-[10px] tracking-[0.16em] text-[#68655e] sm:inline">
              DESIGN LAB / 02
            </span>
            <Link
              to="/demo"
              className={`inline-flex items-center gap-2 rounded-full bg-[#171714] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#38372f] sm:px-5 ${focusRing}`}
            >
              Run the demo
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main id="kernel-main">
        <section className="mx-auto w-full max-w-[1440px] px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20 lg:px-12 lg:pt-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)] lg:items-end">
            <div className="min-w-0">
              <p className="flex items-center gap-3 font-mono text-[10px] font-semibold tracking-[0.2em] text-[#5642d6] sm:text-xs">
                <span className="h-px w-8 bg-[#5642d6]" aria-hidden="true" />
                OPEN-SOURCE SCHEDULING INFRASTRUCTURE
              </p>
              <motion.h1
                initial={reduceMotion ? false : { y: 20 }}
                animate={reduceMotion ? undefined : { y: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="mt-7 max-w-[1050px] text-[clamp(3.6rem,8.2vw,7.8rem)] font-semibold leading-[0.88] tracking-[-0.067em]"
              >
                Scheduling infrastructure you can verify.
              </motion.h1>
            </div>

            <div className="border-l-2 border-[#171714] pl-5 sm:pl-7">
              <p className="text-lg leading-8 text-[#43413c]">
                One deterministic contract across the web app, HTTP API, TypeScript SDK, and MCP. PostgreSQL remains the authority every time.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="#kernel"
                  className={`inline-flex items-center gap-2 rounded-full bg-[#5642d6] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#4533b8] ${focusRing}`}
                >
                  Inspect the kernel
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </a>
                <Link
                  to="/demo"
                  className={`inline-flex items-center gap-2 rounded-full border border-[#171714]/25 px-5 py-3 text-sm font-semibold transition-colors hover:border-[#171714] hover:bg-white/40 ${focusRing}`}
                >
                  See the real flow
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-16 grid border-y border-[#1b1b18]/20 sm:grid-cols-3 lg:mt-24">
            {[
              ['04', 'public booking operations'],
              ['01', 'confirmation boundary'],
              ['01', 'transactional authority'],
            ].map(([value, label], index) => (
              <div
                key={label}
                className={`grid grid-cols-[3.5rem_1fr] items-center gap-4 py-4 sm:block sm:px-5 sm:py-5 ${
                  index > 0 ? 'border-t border-[#1b1b18]/20 sm:border-l sm:border-t-0' : ''
                }`}
              >
                <span className="font-mono text-2xl font-semibold tracking-[-0.04em] text-[#5642d6]">{value}</span>
                <span className="text-sm text-[#5c5a54] sm:mt-2 sm:block">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="kernel" aria-labelledby="kernel-heading" className="scroll-mt-6 px-3 sm:px-5 lg:px-8">
          <div className="mx-auto max-w-[1500px] rounded-[1.75rem] bg-[#ded9cf] px-3 py-12 sm:rounded-[2.5rem] sm:px-8 sm:py-16 lg:px-12 lg:py-20">
            <div className="mx-auto max-w-[1320px]">
              <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
                <div>
                  <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-[#5642d6]">THE COMMIT KERNEL</p>
                  <h2 id="kernel-heading" className="mt-5 text-4xl font-semibold leading-[0.96] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                    Clients propose.
                    <br />
                    Authority decides.
                  </h2>
                </div>
                <p className="max-w-2xl text-base leading-7 text-[#55524c] lg:justify-self-end lg:text-lg lg:leading-8">
                  Project S’s interface is intentionally plural; its scheduling truth is singular. Each surface reaches the same prepared-intent boundary. No adapter receives a private route around confirmation or database checks.
                </p>
              </div>

              <div className="mt-10 sm:mt-14">
                <KernelTrace />
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="surfaces-heading" className="mx-auto grid w-full max-w-[1320px] gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[0.7fr_1.3fr] lg:px-12">
          <div className="lg:sticky lg:top-10 lg:self-start">
            <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-[#5642d6]">CONTRACT PARITY</p>
            <h2 id="surfaces-heading" className="mt-5 max-w-md text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-5xl">
              Different surfaces. The same answer.
            </h2>
            <p className="mt-6 max-w-md text-base leading-7 text-[#5c5a54]">
              The UI is a client, not a privileged implementation. Contract version, request identity, success envelopes, and reason codes stay aligned across every supported transport.
            </p>
          </div>
          <TransportMatrix />
        </section>

        <section aria-labelledby="verified-heading" className="bg-[#171714] text-[#f5f3ed]">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-24 sm:px-8 sm:py-32 lg:px-12">
            <div className="grid gap-8 border-b border-white/20 pb-12 lg:grid-cols-2 lg:items-end">
              <div>
                <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-[#a99cff]">BUILT TO BE VERIFIED</p>
                <h2 id="verified-heading" className="mt-5 text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                  Guarantees with observable failure states.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-white/55 lg:justify-self-end">
                Project S makes refusal part of the contract. Invalid, stale, unapproved, or conflicting actions resolve to bounded outcomes instead of becoming hidden client behavior.
              </p>
            </div>

            <div>
              {guarantees.map((guarantee) => {
                const Icon = guarantee.icon;
                return (
                  <article
                    key={guarantee.number}
                    className="grid gap-5 border-b border-white/15 py-8 sm:grid-cols-[3rem_1fr] lg:grid-cols-[3rem_0.8fr_1.2fr_auto] lg:items-start lg:gap-8 lg:py-10"
                  >
                    <span className="font-mono text-xs text-white/60">{guarantee.number}</span>
                    <div className="flex items-start gap-4">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 text-[#a99cff]">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <h3 className="text-xl font-semibold leading-6 tracking-[-0.025em]">{guarantee.title}</h3>
                    </div>
                    <p className="text-sm leading-6 text-white/55 sm:col-start-2 lg:col-start-auto">{guarantee.description}</p>
                    <code className="w-fit max-w-full break-all border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-[#c7bfff] sm:col-start-2 lg:col-start-auto">
                      {guarantee.proof}
                    </code>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section aria-labelledby="ownership-heading" className="mx-auto w-full max-w-[1320px] px-5 py-24 sm:px-8 sm:py-32 lg:px-12">
          <div className="grid overflow-hidden border border-[#1b1b18]/20 bg-[#e3defd] lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-7 sm:p-10 lg:p-14">
              <p className="font-mono text-[10px] font-semibold tracking-[0.2em] text-[#4d3cba]">SELF-HOSTING / OWNERSHIP</p>
              <h2 id="ownership-heading" className="mt-5 max-w-xl text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-5xl">
                Keep the scheduling authority in your stack.
              </h2>
              <p className="mt-6 max-w-xl text-base leading-7 text-[#454149]">
                Deploy the browser application with a compatible Supabase stack and the repository’s migrations. The public SDK and local MCP adapter point at your HTTP boundary; neither needs database credentials.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/features"
                  className={`inline-flex items-center gap-2 rounded-full bg-[#171714] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#38372f] ${focusRing}`}
                >
                  Inspect the v1 surface
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to="/demo"
                  className={`inline-flex items-center gap-2 rounded-full border border-[#171714]/30 px-5 py-3 text-sm font-semibold transition-colors hover:border-[#171714] hover:bg-white/30 ${focusRing}`}
                >
                  Run authority demo
                </Link>
              </div>
            </div>

            <ol className="border-t border-[#1b1b18]/20 bg-[#f7f5ef]/60 lg:border-l lg:border-t-0">
              {architectureLayers.map((layer, index) => (
                <li key={layer.label} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 border-b border-[#1b1b18]/15 px-5 py-5 last:border-b-0 sm:px-7 sm:py-6">
                  <span className="font-mono text-[10px] text-[#67636c]">{layer.label}</span>
                  <div>
                    <h3 className="text-sm font-semibold">{layer.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-[#666269]">{layer.detail}</p>
                  </div>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1b1b18]/15 bg-white/40">
                    {index === 0 ? (
                      <Code2 className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : index === 1 ? (
                      <Braces className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : index === 2 ? (
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Database className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="final-heading" className="border-t border-[#1b1b18]/15">
          <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_auto] lg:items-end lg:px-12">
            <div>
              <div className="flex items-center gap-2 text-[#5642d6]">
                <CircleCheck className="h-5 w-5" aria-hidden="true" />
                <span className="font-mono text-[10px] font-semibold tracking-[0.2em]">DEVELOPER PREVIEW</span>
              </div>
              <h2 id="final-heading" className="mt-5 max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                Don’t take the architecture on faith.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-[#5c5a54]">
                Run the synthetic authority-boundary fixture and watch an MCP create request fail before approval, commit after browser confirmation, then replay without duplication.
              </p>
            </div>
            <Link
              to="/demo"
              className={`inline-flex w-fit items-center gap-3 rounded-full bg-[#5642d6] px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#4533b8] ${focusRing}`}
            >
              <TerminalSquare className="h-4 w-4" aria-hidden="true" />
              Open the authority demo
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#1b1b18]/15 bg-[#e8e4db]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
          <div className="flex items-center gap-2.5 font-semibold">
            <Mark />
            <span>Project S</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#5c5a54]">
            <Link to="/demo" className={`rounded-sm underline-offset-4 hover:text-[#171714] hover:underline ${focusRing}`}>
              Authority demo
            </Link>
            <Link to="/features" className={`rounded-sm underline-offset-4 hover:text-[#171714] hover:underline ${focusRing}`}>
              V1 surface
            </Link>
            <span className="font-mono text-[10px] tracking-[0.14em]">NOINDEX REVIEW CONCEPT / 02</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default SchedulingKernel;
