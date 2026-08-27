import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  Database,
  FileCheck2,
  Fingerprint,
  Globe2,
  KeyRound,
  LockKeyhole,
  MousePointerClick,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  TerminalSquare,
  UserCheck,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface TraceState {
  label: string;
  detail: string;
  value: string;
  icon: LucideIcon;
  tone: 'neutral' | 'blocked' | 'approved' | 'committed';
}

interface PipelineStep {
  eyebrow: string;
  title: string;
  description: string;
  contract: string;
  icon: LucideIcon;
  tone?: 'blocked' | 'human' | 'database';
}

interface Guarantee {
  title: string;
  description: string;
  signal: string;
  icon: LucideIcon;
}

const traceStates: TraceState[] = [
  {
    label: 'Intent prepared',
    detail: 'Exact summary returned. No slot is reserved.',
    value: 'notHeld: true',
    icon: FileCheck2,
    tone: 'neutral',
  },
  {
    label: 'Create refused',
    detail: 'Possession of the preparation is not approval.',
    value: 'CONFIRMATION_REQUIRED',
    icon: LockKeyhole,
    tone: 'blocked',
  },
  {
    label: 'Person approves',
    detail: 'The exact request is reviewed in the browser.',
    value: 'one-use grant recorded',
    icon: UserCheck,
    tone: 'approved',
  },
  {
    label: 'Authority commits',
    detail: 'Fresh policy and availability pass under the host lock.',
    value: 'status: confirmed',
    icon: Database,
    tone: 'committed',
  },
];

const pipelineSteps: PipelineStep[] = [
  {
    eyebrow: '01 · Discover',
    title: 'Read the booking page',
    description:
      'The public profile exposes only the host information and meeting choices needed to begin.',
    contract: 'project_s_get_booking_page_v1',
    icon: Search,
  },
  {
    eyebrow: '02 · Availability',
    title: 'List valid slots',
    description:
      'Project S computes current bookable starts from the host schedule and meeting policy.',
    contract: 'project_s_list_free_slots_v1',
    icon: CalendarDays,
  },
  {
    eyebrow: '03 · Prepare',
    title: 'Bind one exact intent',
    description:
      'Casey Example, an Intro call, and the selected instant become a short-lived preview. Preparation is not a hold.',
    contract: 'project_s_prepare_booking_v1 · notHeld=true',
    icon: Fingerprint,
  },
  {
    eyebrow: '04 · Refusal',
    title: 'Stop before consent',
    description:
      'An immediate create attempt is rejected. A boolean, model message, or preparation token cannot stand in for human approval.',
    contract: 'CONFIRMATION_REQUIRED · no booking created',
    icon: X,
    tone: 'blocked',
  },
  {
    eyebrow: '05 · Human authority',
    title: 'Review in the browser',
    description:
      'A person sees the server-derived host, meeting, time zones, and guest details, then explicitly approves that preparation.',
    contract: '/booking/confirm · one-use grant',
    icon: MousePointerClick,
    tone: 'human',
  },
  {
    eyebrow: '06 · Database authority',
    title: 'Recheck, then commit',
    description:
      'Under the host lock, PostgreSQL re-reads the clock, policy, schedule, confirmation, and availability before insertion.',
    contract: 'project_s_create_booking_v1 · status=confirmed',
    icon: Database,
    tone: 'database',
  },
  {
    eyebrow: '07 · Receipt',
    title: 'Return one durable result',
    description:
      'The caller receives a confirmation code. Replaying the identical token and idempotency key returns that original result.',
    contract: 'exact replay · zero duplicate bookings',
    icon: CheckCircle2,
    tone: 'database',
  },
];

const transports = [
  { label: 'Web app', detail: 'Browser interface', icon: Globe2 },
  { label: 'HTTP API', detail: 'Versioned routes', icon: Server },
  { label: 'TypeScript SDK', detail: 'Strict DTOs', icon: Code2 },
  { label: 'MCP server', detail: 'Four public tools', icon: Bot },
];

const guarantees: Guarantee[] = [
  {
    title: 'Confirmation is authority, not a field',
    description:
      'Create accepts a preparation token and idempotency key. It does not accept a client-supplied confirmation boolean.',
    signal: 'Strict input contract',
    icon: KeyRound,
  },
  {
    title: 'Preparation never reserves time',
    description:
      'Availability can change after preparation. The final transaction must prove the slot is still valid.',
    signal: 'notHeld: true',
    icon: Clock3,
  },
  {
    title: 'Correctness lives at commit',
    description:
      'The authoritative path rechecks mutable scheduling facts under the host advisory lock and inserts under the overlap constraint.',
    signal: 'Postgres authority',
    icon: ShieldCheck,
  },
  {
    title: 'Retries remain one booking',
    description:
      'An exact replay returns the immutable original result. Reusing an idempotency key for different material is rejected.',
    signal: 'Idempotent result',
    icon: RefreshCw,
  },
];

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6d5ce7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f2ed]';
const darkFocusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a99fff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#171815]';

const TracePanel = () => {
  const reduceMotion = useReducedMotion();
  const [sequence, setSequence] = useState(0);
  const [activeState, setActiveState] = useState(reduceMotion ? traceStates.length - 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      setActiveState(traceStates.length - 1);
      return undefined;
    }

    setActiveState(0);
    const timers = traceStates.slice(1).map((_, index) =>
      window.setTimeout(() => setActiveState(index + 1), 850 + index * 900),
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduceMotion, sequence]);

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[#32332f] bg-[#171815] text-[#f5f4ef] shadow-[0_28px_70px_rgba(22,22,20,0.2)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#32332f] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#4a4b45] bg-[#20211e]">
            <Workflow className="h-4 w-4 text-[#9c90ff]" aria-hidden />
          </span>
          <div>
            <p className="text-[0.66rem] font-bold uppercase tracking-[0.2em] text-[#9a9b93]">
              Authority trace
            </p>
            <p className="mt-0.5 text-xs text-[#d3d2cb]">Synthetic demo fixture</p>
          </div>
        </div>
        <span className="rounded-full border border-[#3e403a] bg-[#20211e] px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[#c2c1ba]">
          Contract v1
        </span>
      </div>

      <div className="border-b border-[#32332f] px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[0.7rem] text-[#b9b8b1] sm:text-xs">
          <TerminalSquare className="h-4 w-4 shrink-0 text-[#8a7cf2]" aria-hidden />
          <span className="truncate">project_s_create_booking_v1</span>
        </div>
      </div>

      <div className="relative px-5 py-6 sm:px-6 sm:py-7">
        <div className="absolute bottom-8 left-[2.13rem] top-8 w-px bg-[#393a35] sm:left-[2.63rem]" aria-hidden>
          <motion.div
            className="w-px origin-top bg-[#8172ed]"
            initial={false}
            animate={{ height: `${(activeState / (traceStates.length - 1)) * 100}%` }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.48, ease: 'easeOut' }}
          />
        </div>

        <ol className="relative space-y-5" aria-label="Prepared booking authority states">
          {traceStates.map((state, index) => {
            const StateIcon = state.icon;
            const isActive = index === activeState;
            const isReached = index <= activeState;
            const toneClasses = {
              neutral: 'border-[#53544d] bg-[#242521] text-[#d7d6cf]',
              blocked: 'border-[#8f5539] bg-[#2b211d] text-[#ffb68e]',
              approved: 'border-[#665bb8] bg-[#24213a] text-[#b9afff]',
              committed: 'border-[#3d7763] bg-[#1b2b25] text-[#8de1be]',
            }[state.tone];

            return (
              <li key={state.label} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4">
                <motion.span
                  className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border sm:h-10 sm:w-10 ${
                    isReached ? toneClasses : 'border-[#42433e] bg-[#1d1e1b] text-[#777871]'
                  }`}
                  initial={false}
                  animate={reduceMotion ? undefined : { scale: isActive ? 1.06 : 1 }}
                  transition={{ duration: 0.22 }}
                  aria-hidden
                >
                  <StateIcon className="h-4 w-4 sm:h-[1.125rem] sm:w-[1.125rem]" aria-hidden />
                </motion.span>
                <motion.div
                  className={`min-w-0 rounded-xl border px-3.5 py-3 transition-colors sm:px-4 ${
                    isActive
                      ? toneClasses
                      : isReached
                        ? 'border-[#41423d] bg-[#1d1e1b]'
                        : 'border-transparent bg-transparent'
                  }`}
                  initial={false}
                  animate={reduceMotion ? undefined : { x: isActive ? 3 : 0 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold text-[#f5f4ef]">{state.label}</p>
                    <code className={`break-all text-[0.65rem] font-semibold ${
                      state.tone === 'blocked'
                        ? 'text-[#ffb68e]'
                        : state.tone === 'committed'
                          ? 'text-[#8de1be]'
                          : 'text-[#aaa2f7]'
                    }`}>
                      {state.value}
                    </code>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[#b2b1aa]">{state.detail}</p>
                </motion.div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-4 border-t border-[#32332f] bg-[#1b1c19] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2 text-xs text-[#aaa9a1]">
          <Database className="h-4 w-4 text-[#8de1be]" aria-hidden />
          <span>Host lock · overlap constraint · exact replay</span>
        </div>
        <button
          type="button"
          onClick={() => setSequence((value) => value + 1)}
          className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-[#4b4c46] px-4 py-2 text-xs font-semibold text-[#ecebe5] transition-colors hover:border-[#7568d8] hover:bg-[#252331] ${darkFocusRing}`}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Replay authority trace
        </button>
      </div>
    </div>
  );
};

const PipelineCard = ({ step, index }: { step: PipelineStep; index: number }) => {
  const StepIcon = step.icon;
  const isBoundary = step.tone === 'blocked';
  const isHuman = step.tone === 'human';
  const isDatabase = step.tone === 'database';

  return (
    <li
      className={`relative flex min-w-0 flex-col border-t-2 px-0 pb-7 pt-5 sm:px-5 sm:pb-5 ${
        isBoundary
          ? 'border-[#b45c35]'
          : isHuman
            ? 'border-[#6d5ce7]'
            : isDatabase
              ? 'border-[#23745a]'
              : 'border-[#c9c6bd]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p
          className={`text-[0.66rem] font-bold uppercase tracking-[0.18em] ${
            isBoundary
              ? 'text-[#9a4623]'
              : isHuman
                ? 'text-[#5b4ac9]'
                : isDatabase
                  ? 'text-[#166348]'
                  : 'text-[#6d6e68]'
          }`}
        >
          {step.eyebrow}
        </p>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            isBoundary
              ? 'bg-[#f7e4da] text-[#9a4623]'
              : isHuman
                ? 'bg-[#e9e5ff] text-[#5b4ac9]'
                : isDatabase
                  ? 'bg-[#dceee7] text-[#166348]'
                  : 'bg-[#e8e6df] text-[#51524d]'
          }`}
        >
          <StepIcon className="h-[1.125rem] w-[1.125rem]" aria-hidden />
        </span>
      </div>
      <h3 className="mt-5 text-xl font-semibold leading-tight tracking-[-0.025em] text-[#1b1c19]">
        {step.title}
      </h3>
      <p className="mt-3 text-sm leading-6 text-[#62635e]">{step.description}</p>
      <code
        className={`mt-auto block break-words pt-5 text-[0.65rem] font-semibold leading-5 ${
          isBoundary
            ? 'text-[#9a4623]'
            : isHuman
              ? 'text-[#5b4ac9]'
              : isDatabase
                ? 'text-[#166348]'
                : 'text-[#62635e]'
        }`}
      >
        {step.contract}
      </code>
      {index < pipelineSteps.length - 1 ? (
        <ArrowRight
          className="absolute -right-2 top-6 hidden h-4 w-4 text-[#aaa79e] lg:block"
          aria-hidden
        />
      ) : null}
    </li>
  );
};

const AuthorityPipeline = () => {
  useEffect(() => {
    const previousTitle = document.title;
    const existingRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = existingRobots?.getAttribute('content') ?? null;
    const robots = existingRobots ?? document.createElement('meta');

    if (!existingRobots) {
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }

    document.title = 'Authority Pipeline — Project S design review';
    robots.setAttribute('content', 'noindex, nofollow, noarchive');

    return () => {
      document.title = previousTitle;
      if (existingRobots) {
        if (previousRobots === null) existingRobots.removeAttribute('content');
        else existingRobots.setAttribute('content', previousRobots);
      } else {
        robots.remove();
      }
    };
  }, []);

  return (
    <div className="min-h-screen overflow-x-clip bg-[#f4f2ed] text-[#1b1c19] selection:bg-[#dcd6ff] selection:text-[#251d61]">
      <a
        href="#main-content"
        className={`fixed left-4 top-3 z-[100] -translate-y-20 rounded-md bg-[#171815] px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0 ${focusRing}`}
      >
        Skip to content
      </a>

      <header className="border-b border-[#d8d5cd] bg-[#f4f2ed]">
        <div className="mx-auto flex min-h-[4.75rem] w-full max-w-[90rem] items-center justify-between gap-5 px-5 sm:px-8 lg:px-12">
          <Link
            to="/"
            aria-label="Project S home"
            className={`inline-flex items-center gap-2.5 rounded-sm text-lg font-bold tracking-[-0.04em] ${focusRing}`}
          >
            <span className="grid h-7 w-7 grid-cols-2 gap-[3px] rounded-[0.4rem] bg-[#1b1c19] p-[5px]" aria-hidden>
              <span className="rounded-[1px] bg-[#9c90ff]" />
              <span className="rounded-[1px] bg-[#f4f2ed]" />
              <span className="rounded-[1px] bg-[#f4f2ed]" />
              <span className="rounded-[1px] bg-[#9c90ff]" />
            </span>
            Project S
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-[#555650] md:flex" aria-label="Concept navigation">
            <a href="#authority-flow" className={`rounded-sm transition-colors hover:text-[#1b1c19] ${focusRing}`}>
              Authority flow
            </a>
            <a href="#one-contract" className={`rounded-sm transition-colors hover:text-[#1b1c19] ${focusRing}`}>
              One contract
            </a>
            <a href="#ownership" className={`rounded-sm transition-colors hover:text-[#1b1c19] ${focusRing}`}>
              Self-hosting
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-[0.65rem] font-bold uppercase tracking-[0.16em] text-[#62635e] sm:inline">
              Concept A · Review
            </span>
            <Link
              to="/demo"
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#1b1c19] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#33342f] sm:px-5 sm:text-sm ${focusRing}`}
            >
              View demo
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="relative border-b border-[#d8d5cd]">
          <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px bg-[#dedbd3] xl:block" aria-hidden />
          <div className="mx-auto grid w-full max-w-[90rem] gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1.08fr)_minmax(26rem,0.92fr)] lg:gap-14 lg:px-12 lg:py-24 xl:gap-20 xl:py-28">
            <div className="flex min-w-0 flex-col justify-center">
              <p className="flex items-center gap-3 text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#5b4ac9] sm:text-xs">
                <span className="h-px w-8 bg-[#6d5ce7]" aria-hidden />
                Open-source scheduling infrastructure
              </p>
              <h1 className="mt-7 text-[2.65rem] font-semibold leading-[0.94] tracking-[-0.065em] text-[#171815] sm:mt-9 sm:text-[4.8rem] lg:text-[5rem] xl:text-[6.15rem]">
                <span className="block">Agents prepare.</span>
                <span className="block text-[#6556d8]">People approve.</span>
                <span className="block">Project S commits.</span>
              </h1>
              <p className="mt-8 max-w-2xl text-base leading-7 text-[#555650] sm:text-lg sm:leading-8">
                One deterministic scheduling contract across the web app, API, SDK, and MCP—self-hosted, auditable, and designed so software cannot bypass availability, consent, or database authority.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  to="/demo"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#6556d8] px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(101,86,216,0.2)] transition-colors hover:bg-[#5748c7] ${focusRing}`}
                >
                  Run the authority demo
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a
                  href="#authority-flow"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#c9c6bd] bg-[#f8f7f3] px-6 py-3 text-sm font-semibold text-[#292a26] transition-colors hover:border-[#aaa69c] hover:bg-white ${focusRing}`}
                >
                  See the contract flow
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </a>
              </div>

              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 border-t border-[#d8d5cd] pt-6 text-xs font-medium text-[#666761]">
                <span className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#23745a]" aria-hidden />
                  Deterministic core
                </span>
                <span className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#23745a]" aria-hidden />
                  Explicit human authority
                </span>
                <span className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-[#23745a]" aria-hidden />
                  Self-hosted by design
                </span>
              </div>
            </div>

            <div className="min-w-0 self-center">
              <TracePanel />
              <p className="mt-4 px-2 text-xs leading-5 text-[#696a64]">
                The trace reflects the repository’s real synthetic authority-boundary fixture. It is an explanatory walkthrough, not a live production request.
              </p>
            </div>
          </div>
        </section>

        <section id="authority-flow" aria-labelledby="authority-flow-title" className="scroll-mt-20 border-b border-[#d8d5cd] bg-[#f9f8f4]">
          <div className="mx-auto w-full max-w-[90rem] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(24rem,1.18fr)] lg:items-end">
              <div>
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#5b4ac9]">
                  The authority pipeline
                </p>
                <h2 id="authority-flow-title" className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#171815] sm:text-5xl lg:text-6xl">
                  The refusal is the feature.
                </h2>
              </div>
              <p className="max-w-2xl text-base leading-7 text-[#5f605a] lg:justify-self-end lg:text-lg lg:leading-8">
                Project S lets software do useful preparation work, then stops at the point where a write needs a person’s authority. Approval still does not guarantee success: current scheduling facts must pass again inside the database transaction.
              </p>
            </div>

            <ol className="mt-14 grid gap-x-3 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4 xl:grid-cols-7">
              {pipelineSteps.map((step, index) => (
                <PipelineCard key={step.title} step={step} index={index} />
              ))}
            </ol>

            <div className="mt-8 grid overflow-hidden rounded-[1.5rem] border border-[#d4d1c8] bg-[#f4f2ed] md:grid-cols-[0.9fr_1.1fr]">
              <div className="border-b border-[#d4d1c8] p-6 sm:p-8 md:border-b-0 md:border-r lg:p-10">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f4ded3] text-[#93431f]">
                    <LockKeyhole className="h-5 w-5" aria-hidden />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#93431f]">Before approval</p>
                </div>
                <p className="mt-6 font-mono text-sm font-semibold text-[#713517] sm:text-base">CONFIRMATION_REQUIRED</p>
                <p className="mt-3 text-sm leading-6 text-[#62635e]">
                  The create request is refused and authoritative booking state remains unchanged.
                </p>
              </div>
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dceee7] text-[#166348]">
                    <Database className="h-5 w-5" aria-hidden />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#166348]">After approval</p>
                </div>
                <p className="mt-6 font-mono text-sm font-semibold text-[#13563f] sm:text-base">LOCK → RECHECK → COMMIT</p>
                <p className="mt-3 text-sm leading-6 text-[#62635e]">
                  A one-use confirmation grant permits a fresh attempt. PostgreSQL—not the browser or agent—makes the final scheduling decision.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="one-contract" aria-labelledby="one-contract-title" className="scroll-mt-20 bg-[#191a17] text-[#f5f4ef]">
          <div className="mx-auto w-full max-w-[90rem] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-end">
              <div>
                <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#a99fff]">
                  One scheduling truth
                </p>
                <h2 id="one-contract-title" className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.04] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                  Different interfaces.<br />No private rules.
                </h2>
              </div>
              <p className="max-w-xl text-base leading-7 text-[#b9b8b1] lg:justify-self-end lg:text-lg lg:leading-8">
                Web, HTTP, SDK, and MCP adapters express the same intent. None gets a privileged shortcut around validation, confirmation, or the authoritative commit.
              </p>
            </div>

            <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
              {transports.map((transport) => {
                const TransportIcon = transport.icon;
                return (
                  <div key={transport.label} className="border-t border-[#494a44] bg-[#20211e] px-5 py-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold">{transport.label}</h3>
                        <p className="mt-1 text-sm text-[#9f9f98]">{transport.detail}</p>
                      </div>
                      <TransportIcon className="h-5 w-5 text-[#9f94fa]" aria-hidden />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
              <div className="border border-[#494a44] bg-[#242521] p-6 sm:p-8">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#999a93]">Contract boundary</p>
                <h3 className="mt-3 text-xl font-semibold">Strict public v1 operations</h3>
                <p className="mt-3 text-sm leading-6 text-[#b2b1aa]">
                  Typed inputs, bounded responses, explicit reason codes, and transport-parity tests define what callers may ask.
                </p>
              </div>
              <ArrowRight className="mx-auto hidden h-5 w-5 self-center text-[#777871] lg:block" aria-hidden />
              <div className="border border-[#665eb0] bg-[#26233a] p-6 sm:p-8">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#b4abff]">Application boundary</p>
                <h3 className="mt-3 text-xl font-semibold">Context is derived, not trusted</h3>
                <p className="mt-3 text-sm leading-6 text-[#c8c5dc]">
                  The gateway supplies verified scope, provenance, and the server-recorded grant. Public payloads cannot author those facts.
                </p>
              </div>
              <ArrowRight className="mx-auto hidden h-5 w-5 self-center text-[#777871] lg:block" aria-hidden />
              <div className="border border-[#477563] bg-[#1e2b26] p-6 sm:p-8">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[#8de1be]">Authority boundary</p>
                <h3 className="mt-3 text-xl font-semibold">Postgres decides the write</h3>
                <p className="mt-3 text-sm leading-6 text-[#bad2c8]">
                  Fresh scheduling checks, locking, overlap protection, persistence, and idempotency meet in one transaction.
                </p>
              </div>
            </div>

            <p className="mt-7 flex max-w-3xl items-start gap-3 text-sm leading-6 text-[#aaa9a2]">
              <CircleDot className="mt-1 h-4 w-4 shrink-0 text-[#9f94fa]" aria-hidden />
              MCP is a local stdio transport in v1. It is not a model, an autonomous approval mechanism, or a database credential.
            </p>
          </div>
        </section>

        <section aria-labelledby="guarantees-title" className="border-b border-[#d8d5cd] bg-[#f4f2ed]">
          <div className="mx-auto w-full max-w-[90rem] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <div className="max-w-3xl">
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#5b4ac9]">Built to be verified</p>
              <h2 id="guarantees-title" className="mt-4 text-4xl font-semibold leading-[1.04] tracking-[-0.045em] text-[#171815] sm:text-5xl lg:text-6xl">
                Guarantees you can test,<br className="hidden sm:block" /> not prompts you have to trust.
              </h2>
            </div>

            <div className="mt-14 grid border-b border-l border-[#cfccc3] sm:grid-cols-2 lg:mt-16 lg:grid-cols-4">
              {guarantees.map((guarantee, index) => {
                const GuaranteeIcon = guarantee.icon;
                return (
                  <article key={guarantee.title} className="flex min-h-[19rem] flex-col border-r border-t border-[#cfccc3] bg-[#f9f8f4] p-6 sm:p-7">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9e5ff] text-[#5b4ac9]">
                        <GuaranteeIcon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="font-mono text-[0.65rem] text-[#62635e]">0{index + 1}</span>
                    </div>
                    <h3 className="mt-7 text-xl font-semibold leading-tight tracking-[-0.025em]">{guarantee.title}</h3>
                    <p className="mt-4 text-sm leading-6 text-[#62635e]">{guarantee.description}</p>
                    <p className="mt-auto border-t border-[#dedbd3] pt-5 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#5b4ac9]">
                      {guarantee.signal}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="ownership" aria-labelledby="ownership-title" className="scroll-mt-20 bg-[#dedbd3]">
          <div className="mx-auto grid w-full max-w-[90rem] gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(24rem,1.1fr)] lg:items-center lg:gap-20 lg:px-12 lg:py-28">
            <div>
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-[#5b4ac9]">Self-hosting and ownership</p>
              <h2 id="ownership-title" className="mt-4 text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#171815] sm:text-5xl lg:text-6xl">
                Your scheduler.<br />Your policy.<br />One authority.
              </h2>
              <p className="mt-7 max-w-xl text-base leading-7 text-[#555650] sm:text-lg sm:leading-8">
                Project S’s core runs without an AI provider or paid calendar service. Hosts publish availability; guests and software use the same bounded booking path; PostgreSQL keeps the final word.
              </p>
            </div>

            <div className="border-l-2 border-[#6d5ce7] bg-[#eceae4] p-6 sm:p-8 lg:p-10">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#5b4ac9]">Developer preview · current v1 scope</p>
              <ul className="mt-7 space-y-5">
                {[
                  'Account profiles, meeting types, and host-defined availability',
                  'Authority-bounded public booking through UI, HTTP, SDK, and MCP',
                  'Explicit browser confirmation before agent-prepared commits',
                  'Synthetic local fixture with contract, database, race, and browser tests',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm leading-6 text-[#444540] sm:text-base">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#23745a]" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/demo"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#1b1c19] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#33342f] ${focusRing}`}
                >
                  Explore the real demo
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  to="/about"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#bbb7ad] px-6 py-3 text-sm font-semibold text-[#292a26] transition-colors hover:bg-[#f4f2ed] ${focusRing}`}
                >
                  Read the architecture
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#cbc8bf] bg-[#f4f2ed]">
        <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-5 px-5 py-8 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 grid-cols-2 gap-[3px] rounded-[0.4rem] bg-[#1b1c19] p-[5px]" aria-hidden>
              <span className="rounded-[1px] bg-[#9c90ff]" />
              <span className="rounded-[1px] bg-[#f4f2ed]" />
              <span className="rounded-[1px] bg-[#f4f2ed]" />
              <span className="rounded-[1px] bg-[#9c90ff]" />
            </span>
            <div>
              <p className="text-sm font-bold tracking-[-0.02em]">Project S</p>
              <p className="text-xs text-[#62635e]">Authority Pipeline · isolated design review</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-[#656660]">
            <Link to="/demo" className={`rounded-sm transition-colors hover:text-[#1b1c19] ${focusRing}`}>Demo</Link>
            <Link to="/about" className={`rounded-sm transition-colors hover:text-[#1b1c19] ${focusRing}`}>Architecture</Link>
            <Link to="/login" className={`rounded-sm transition-colors hover:text-[#1b1c19] ${focusRing}`}>Host login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AuthorityPipeline;
