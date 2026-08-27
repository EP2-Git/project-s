import { useEffect, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Code2,
  Database,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MousePointer2,
  RefreshCcw,
  ServerCog,
  ShieldCheck,
  TerminalSquare,
  UserCheck,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const ink = '#171716';
const paper = '#f4f3ef';
const lavender = '#6857d9';

const reveal = {
  hidden: { y: 18 },
  visible: { y: 0 },
};

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

const Reveal = ({ children, className, delay = 0 }: RevealProps) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : 'hidden'}
      whileInView="visible"
      viewport={{ once: true, amount: 0.18 }}
      variants={reveal}
      transition={{ duration: reduceMotion ? 0 : 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
};

const ProjectSMark = () => (
  <span
    aria-hidden="true"
    className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white"
    style={{ backgroundColor: lavender }}
  >
    <span className="h-3 w-3 rounded-[3px] border-2 border-white" />
    <span className="absolute right-[7px] top-[7px] h-1.5 w-1.5 rounded-full bg-[#c9c2ff]" />
  </span>
);

const Header = () => (
  <header className="relative z-30 border-b border-black/10 bg-[#f4f3ef]">
    <div className="mx-auto flex min-h-16 w-full max-w-[1440px] items-center justify-between gap-5 px-5 sm:px-8 lg:px-12">
      <Link
        to="/"
        aria-label="Project S home"
        className="flex min-h-11 items-center gap-2.5 rounded-sm font-semibold tracking-[-0.03em] outline-none focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef]"
      >
        <ProjectSMark />
        <span className="text-[17px]">Project S</span>
      </Link>

      <nav aria-label="Concept navigation" className="hidden items-center gap-7 md:flex">
        <a
          href="#product"
          className="rounded-sm text-sm text-black/65 outline-none transition-colors hover:text-black focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef]"
        >
          Product
        </a>
        <a
          href="#authority"
          className="rounded-sm text-sm text-black/65 outline-none transition-colors hover:text-black focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef]"
        >
          Authority
        </a>
        <a
          href="#ownership"
          className="rounded-sm text-sm text-black/65 outline-none transition-colors hover:text-black focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef]"
        >
          Self-hosting
        </a>
      </nav>

      <div className="flex items-center gap-2">
        <span className="hidden border-l border-black/15 pl-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-black/65 lg:block">
          Design study C
        </span>
        <Link
          to="/demo"
          className="hidden min-h-11 items-center gap-2 rounded-full bg-[#171716] px-5 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#343330] focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef] sm:inline-flex"
        >
          Authority demo
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <a
          href="#product"
          aria-label="Jump to product preview"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-black/15 outline-none hover:border-black/35 focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef] sm:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </a>
      </div>
    </div>
  </header>
);

interface MiniCalendarProps {
  month: string;
  selectedDate: string;
  onPreviousMonth(): void;
  onNextMonth(): void;
  onSelectDate(date: string): void;
}

const MiniCalendar = ({
  month,
  selectedDate,
  onPreviousMonth,
  onNextMonth,
  onSelectDate,
}: MiniCalendarProps) => {
  const days = [
    { weekday: 'MON', date: '24' },
    { weekday: 'TUE', date: '25' },
    { weekday: 'WED', date: '26' },
    { weekday: 'THU', date: '27' },
    { weekday: 'FRI', date: '28' },
  ];

  return (
    <div className="min-w-0 border-t border-black/10 pt-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={onPreviousMonth}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-full border border-black/10 text-black/55 outline-none hover:border-black/30 focus-visible:ring-2 focus-visible:ring-[#6857d9]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <p aria-live="polite" className="text-xs font-semibold tracking-tight text-black/75">{month}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={onNextMonth}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-full border border-black/10 text-black/55 outline-none hover:border-black/30 focus-visible:ring-2 focus-visible:ring-[#6857d9]"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-5 gap-1" aria-label="Fictional date preview">
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            aria-pressed={day.date === selectedDate}
            onClick={() => onSelectDate(day.date)}
            className={`flex min-h-[54px] min-w-0 flex-col items-center justify-center rounded-lg border text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#6857d9] ${
              day.date === selectedDate
                ? 'border-[#6857d9] bg-[#6857d9] text-white'
                : 'border-transparent text-black/55 hover:border-black/15 hover:text-black'
            }`}
          >
            <span className="text-[8px] font-semibold tracking-[0.08em]">{day.weekday}</span>
            <span className="mt-1 text-[13px] font-semibold">{day.date}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const BookingPagePreview = () => {
  const reduceMotion = useReducedMotion();
  const months = ['July 2026', 'August 2026', 'September 2026'];
  const [monthIndex, setMonthIndex] = useState(1);
  const [selectedDate, setSelectedDate] = useState('26');
  const [selectedTime, setSelectedTime] = useState('10:30 AM');

  return (
    <motion.div
      className="relative z-10 w-full min-w-0 overflow-hidden rounded-[20px] border border-black/15 bg-white shadow-[0_24px_70px_rgba(23,23,22,0.12)]"
      initial={reduceMotion ? false : { y: 16 }}
      animate={{ y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
    <div className="flex h-10 items-center gap-1.5 border-b border-black/10 bg-[#fafaf8] px-4" aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-black/15" />
      <span className="h-2 w-2 rounded-full bg-black/15" />
      <span className="h-2 w-2 rounded-full bg-black/15" />
      <span className="ml-3 truncate rounded bg-black/[0.035] px-3 py-1 text-[8px] text-black/65">
        project-s.local/book/demo-host
      </span>
    </div>

    <div className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[#6857d9]">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-[0.14em]">Booking page</span>
          </div>
          <h2 className="mt-3 text-[21px] font-semibold leading-tight tracking-[-0.04em] text-[#171716]">
            Book time with Demo Host
          </h2>
          <p className="mt-1.5 text-[11px] leading-5 text-black/65">
            Times shown in America/Halifax
          </p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#efedf9] text-[11px] font-bold text-[#6857d9]">
          DH
        </span>
      </div>

      <div className="mt-6 flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-[#6857d9] bg-[#f7f6ff] p-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#6857d9] text-white">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-[#171716]">Intro call</span>
          <span className="mt-0.5 block text-[10px] text-black/65">30 minutes · synthetic fixture</span>
        </span>
        <Check className="h-4 w-4 shrink-0 text-[#6857d9]" aria-hidden="true" />
      </div>

      <MiniCalendar
        month={months[monthIndex]}
        selectedDate={selectedDate}
        onPreviousMonth={() => setMonthIndex((current) => (current + months.length - 1) % months.length)}
        onNextMonth={() => setMonthIndex((current) => (current + 1) % months.length)}
        onSelectDate={setSelectedDate}
      />

      <div className="mt-4 grid grid-cols-3 gap-2">
        {['9:00 AM', '10:30 AM', '1:00 PM'].map((time) => (
          <button
            key={time}
            type="button"
            aria-pressed={time === selectedTime}
            onClick={() => setSelectedTime(time)}
            className={`min-h-10 min-w-0 rounded-lg border px-1 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#6857d9] ${
              time === selectedTime
                ? 'border-[#6857d9] bg-[#6857d9] text-white'
                : 'border-black/10 text-black/65 hover:border-black/30'
            }`}
          >
            {time}
          </button>
        ))}
      </div>
    </div>
    </motion.div>
  );
};

const DashboardPreview = () => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="relative w-full min-w-0 overflow-hidden rounded-[18px] border border-black/15 bg-[#191918] text-white shadow-[0_24px_70px_rgba(23,23,22,0.18)] lg:ml-[-34px] lg:mt-24"
      initial={reduceMotion ? false : { x: 18 }}
      animate={{ x: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.55, delay: reduceMotion ? 0 : 0.12, ease: [0.22, 1, 0.36, 1] }}
    >
    <div className="flex h-12 items-center justify-between border-b border-white/10 px-4">
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-4 w-4 text-[#aaa0ff]" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/65">Host view</span>
      </div>
      <span className="h-7 w-7 rounded-full border border-white/15 bg-white/5" />
    </div>

    <div className="p-4 sm:p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/65">Your next booking</p>
          <p className="mt-2 text-[20px] font-semibold tracking-[-0.04em]">Wednesday</p>
        </div>
        <span className="rounded-full border border-[#aaa0ff]/35 bg-[#aaa0ff]/10 px-2.5 py-1 text-[9px] font-semibold text-[#cbc5ff]">
          Confirmed
        </span>
      </div>

      <div className="mt-5 border-l-2 border-[#8d7df3] pl-4">
        <p className="text-[11px] font-semibold">Intro call</p>
        <p className="mt-1 text-[10px] text-white/50">10:30 AM – 11:00 AM</p>
        <p className="mt-3 flex items-center gap-1.5 text-[9px] text-white/60">
          <CircleUserRound className="h-3.5 w-3.5" aria-hidden="true" />
          Synthetic Guest
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10">
        <div className="bg-[#191918] p-3">
          <p className="text-[9px] uppercase tracking-[0.12em] text-white/65">Meeting types</p>
          <p className="mt-2 text-lg font-semibold">1</p>
        </div>
        <div className="bg-[#191918] p-3">
          <p className="text-[9px] uppercase tracking-[0.12em] text-white/65">Time zone</p>
          <p className="mt-2 truncate text-[10px] font-semibold">America/Halifax</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[9px] text-white/65">Public booking page</p>
          <p className="mt-0.5 truncate text-[10px] font-medium text-white/75">/book/demo-host</p>
        </div>
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#aaa0ff]" aria-hidden="true" />
      </div>
    </div>
    </motion.div>
  );
};

const ProductStage = () => (
  <div className="relative min-w-0 lg:pl-5">
    <div
      aria-hidden="true"
      className="absolute -left-5 top-10 h-[72%] w-[calc(100%+2.5rem)] rounded-[32px] border border-[#6857d9]/15 bg-[#ebe9f6]"
    />
    <div className="relative grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:gap-0">
      <BookingPagePreview />
      <DashboardPreview />
    </div>
    <p className="relative mt-4 text-center text-[10px] font-semibold uppercase tracking-[0.13em] text-black/65">
      Fictional local fixture · product interface study
    </p>
  </div>
);

const Hero = () => (
  <section className="border-b border-black/10" aria-labelledby="own-flow-title">
    <div className="mx-auto grid w-full max-w-[1440px] gap-14 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-16 lg:px-12 lg:py-24 xl:gap-24">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.19em] text-[#6857d9]">
          Open-source scheduling infrastructure
        </p>
        <h1
          id="own-flow-title"
          className="mt-6 max-w-[690px] text-[clamp(3.25rem,7vw,6.9rem)] font-semibold leading-[0.89] tracking-[-0.07em] text-[#171716]"
        >
          A booking system that belongs to you.
        </h1>
        <p className="mt-7 max-w-xl text-base leading-7 text-black/62 sm:text-lg sm:leading-8">
          Publish availability on your own terms. Give people a clear way to book, give software a typed way to participate, and keep every final scheduling decision inside Project S’s deterministic authority.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/book/demo-host"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#6857d9] px-6 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#5747c3] focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef]"
          >
            Open the booking page
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            to="/demo"
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-black/20 px-6 text-sm font-semibold text-[#171716] outline-none transition-colors hover:border-black/45 focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#f4f3ef]"
          >
            See the authority boundary
          </Link>
        </div>
        <p className="mt-5 flex max-w-lg items-start gap-2 text-xs leading-5 text-black/65">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#6857d9]" aria-hidden="true" />
          Self-hostable. No calendar sync, outbound email, or model reasoning is implied by this preview.
        </p>
      </div>

      <ProductStage />
    </div>
  </section>
);

const ProductSection = () => (
  <section id="product" className="scroll-mt-20 border-b border-black/10 bg-white" aria-labelledby="product-title">
    <div className="mx-auto w-full max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
      <Reveal className="grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6857d9]">Useful before it is technical</p>
          <h2 id="product-title" className="mt-4 max-w-lg text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-[#171716] sm:text-5xl lg:text-6xl">
            Familiar for guests. Direct for hosts.
          </h2>
        </div>
        <div className="grid gap-px border-y border-black/15 bg-black/15 sm:grid-cols-3">
          {[
            {
              number: '01',
              title: 'Publish real availability',
              copy: 'Define meeting types, weekly hours, date overrides, notice, and booking windows. Project S derives the slots it can actually accept.',
            },
            {
              number: '02',
              title: 'Let guests choose clearly',
              copy: 'A public booking page presents server-generated times in the guest’s selected IANA time zone, then collects the booking details.',
            },
            {
              number: '03',
              title: 'Keep the host in control',
              copy: 'Authenticated hosts see private booking state and use the version-checked cancellation contract. Public clients do not inherit that authority.',
            },
          ].map((item) => (
            <article key={item.number} className="bg-white px-0 py-7 sm:px-5 lg:px-7">
              <p className="font-mono text-[10px] text-black/65">{item.number}</p>
              <h3 className="mt-8 text-xl font-semibold tracking-[-0.035em] text-[#171716]">{item.title}</h3>
              <p className="mt-4 text-sm leading-6 text-black/58">{item.copy}</p>
            </article>
          ))}
        </div>
      </Reveal>
    </div>
  </section>
);

const transportItems = [
  { label: 'Web app', icon: MousePointer2 },
  { label: 'HTTP API', icon: Code2 },
  { label: 'TypeScript SDK', icon: TerminalSquare },
  { label: 'MCP server', icon: Bot },
];

const ContractDiagram = () => {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative min-w-0 border border-white/15 bg-[#20201e] p-5 sm:p-7 lg:p-9">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">One scheduling truth</p>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {transportItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={item.label}
              className="flex min-h-[94px] min-w-0 flex-col justify-between border border-white/10 bg-[#181817] p-3"
              initial={reduceMotion ? false : { y: 8 }}
              whileInView={{ y: 0 }}
              viewport={{ once: true, amount: 0.7 }}
              transition={{ duration: reduceMotion ? 0 : 0.32, delay: reduceMotion ? 0 : index * 0.08 }}
            >
              <Icon className="h-4 w-4 text-[#aaa0ff]" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-white/75">{item.label}</span>
            </motion.div>
          );
        })}
      </div>

      <div className="relative mx-auto h-14 w-px bg-white/15" aria-hidden="true">
        <motion.span
          className="absolute left-[-2px] top-0 h-1.5 w-1.5 rounded-full bg-[#aaa0ff]"
          animate={reduceMotion ? undefined : { y: [2, 48] }}
          transition={reduceMotion ? undefined : { duration: 1.4, repeat: 1, ease: 'easeInOut', repeatDelay: 0.2 }}
        />
      </div>

      <div className="border border-[#aaa0ff]/35 bg-[#aaa0ff]/10 p-5 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[#8d7df3] text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mt-3 text-sm font-semibold">Shared application contracts</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-white/50">
          The transport changes. Slot validation, preparation, confirmation, idempotency, and authority rules do not.
        </p>
      </div>

      <div className="mx-auto h-10 w-px bg-white/15" aria-hidden="true" />

      <div className="flex min-w-0 items-center gap-4 border border-white/10 bg-[#181817] p-4 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15">
          <Database className="h-5 w-5 text-[#aaa0ff]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">Postgres remains authoritative</p>
          <p className="mt-1 text-[11px] leading-5 text-white/65">Final checks and insert run under the host lock.</p>
        </div>
      </div>
    </div>
  );
};

const FoundationSection = () => (
  <section className="bg-[#171716] text-white" aria-labelledby="foundation-title">
    <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:gap-20 lg:px-12 lg:py-28">
      <Reveal>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#aaa0ff]">The technical foundation</p>
        <h2 id="foundation-title" className="mt-5 max-w-xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
          People and software use the same door.
        </h2>
        <p className="mt-6 max-w-xl text-base leading-7 text-white/60">
          The browser is not a privileged scheduling engine, and the agent is not a special one. The web app, HTTP API, TypeScript SDK, and MCP server converge on the same contracts and database authority.
        </p>
        <p className="mt-6 border-l-2 border-[#8d7df3] pl-4 text-sm leading-6 text-white/72">
          Agent access expands who can prepare a request. It does not expand who can approve it—or what the database will commit.
        </p>
      </Reveal>

      <Reveal delay={0.08}>
        <ContractDiagram />
      </Reveal>
    </div>
  </section>
);

const authoritySteps = [
  {
    number: '01',
    label: 'Prepared',
    title: 'Software proposes an exact booking',
    copy: 'The request is bound to one host, meeting type, slot, time zone, and guest payload. The slot is not held.',
    icon: Bot,
    state: 'NOT HELD',
    tone: 'neutral',
  },
  {
    number: '02',
    label: 'Blocked',
    title: 'Create stops at the authority boundary',
    copy: 'Calling create before browser approval returns the real reason code. A boolean approval flag cannot substitute for the grant.',
    icon: LockKeyhole,
    state: 'CONFIRMATION_REQUIRED',
    tone: 'blocked',
  },
  {
    number: '03',
    label: 'Approved',
    title: 'A person reviews those exact details',
    copy: 'Human authority enters through the browser confirmation flow and remains bound to the prepared request.',
    icon: UserCheck,
    state: 'HUMAN AUTHORITY',
    tone: 'approved',
  },
  {
    number: '04',
    label: 'Committed',
    title: 'Project S checks again under the host lock',
    copy: 'Current time, policy, availability, confirmation, and authority are rechecked before the booking is inserted.',
    icon: Database,
    state: 'CONFIRMED',
    tone: 'committed',
  },
];

const AuthoritySequence = () => {
  const reduceMotion = useReducedMotion();

  return (
    <ol className="mt-12 grid border-l border-t border-black/15 sm:grid-cols-2 lg:grid-cols-4 lg:border-l-0">
      {authoritySteps.map((step, index) => {
        const Icon = step.icon;
        return (
          <motion.li
            key={step.label}
            className="relative min-w-0 border-b border-r border-black/15 bg-[#f4f3ef] p-5 sm:p-6 lg:min-h-[370px]"
            initial={reduceMotion ? false : { y: 12 }}
            whileInView={{ y: 0 }}
            viewport={{ once: true, amount: 0.7 }}
            transition={{ duration: reduceMotion ? 0 : 0.35, delay: reduceMotion ? 0 : index * 0.13 }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] text-black/65">{step.number}</span>
              <span
                className={`rounded-full border px-2.5 py-1 font-mono text-[8px] font-semibold tracking-[0.08em] ${
                  step.tone === 'blocked'
                    ? 'border-[#b85e45]/35 bg-[#b85e45]/5 text-[#8c3e2a]'
                    : step.tone === 'approved'
                      ? 'border-[#6857d9]/35 bg-[#6857d9]/5 text-[#5948c6]'
                      : step.tone === 'committed'
                        ? 'border-[#2f7657]/35 bg-[#2f7657]/5 text-[#285f49]'
                        : 'border-black/15 text-black/65'
                }`}
              >
                {step.state}
              </span>
            </div>
            <span className="mt-12 flex h-11 w-11 items-center justify-center rounded-full border border-black/15 bg-white">
              <Icon className="h-5 w-5 text-[#6857d9]" aria-hidden="true" />
            </span>
            <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.16em] text-black/65">{step.label}</p>
            <h3 className="mt-3 text-xl font-semibold leading-tight tracking-[-0.035em] text-[#171716]">{step.title}</h3>
            <p className="mt-4 text-sm leading-6 text-black/55">{step.copy}</p>
            {index < authoritySteps.length - 1 && (
              <span className="absolute -right-3 top-[93px] z-10 hidden h-6 w-6 items-center justify-center rounded-full border border-black/15 bg-[#f4f3ef] lg:flex" aria-hidden="true">
                <ArrowRight className="h-3 w-3 text-black/65" />
              </span>
            )}
          </motion.li>
        );
      })}
    </ol>
  );
};

const AuthoritySection = () => (
  <section id="authority" className="scroll-mt-20 border-b border-black/10" aria-labelledby="authority-title">
    <div className="mx-auto w-full max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
      <Reveal className="grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-20">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#6857d9]">The authority boundary</p>
          <h2 id="authority-title" className="mt-5 max-w-3xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-[#171716] sm:text-5xl lg:text-6xl">
            Automation can ask. It cannot quietly decide.
          </h2>
        </div>
        <p className="max-w-xl text-base leading-7 text-black/58 lg:pb-1">
          Project S separates preparation from permission. The refusal before confirmation is intentional, visible, and enforced by the same system that ultimately commits the booking.
        </p>
      </Reveal>

      <AuthoritySequence />

      <Reveal className="mt-8 flex flex-col justify-between gap-5 border border-black/15 bg-white p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <RefreshCcw className="mt-0.5 h-5 w-5 shrink-0 text-[#6857d9]" aria-hidden="true" />
          <div>
            <h3 className="font-semibold tracking-[-0.02em]">An ambiguous retry stays singular.</h3>
            <p className="mt-1 text-sm leading-6 text-black/55">
              Repeating the identical preparation token and idempotency key returns the immutable original result instead of creating a duplicate.
            </p>
          </div>
        </div>
        <span className="shrink-0 self-start rounded-full border border-black/15 px-3 py-1.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-black/65 sm:self-auto">
          EXACT REPLAY
        </span>
      </Reveal>
    </div>
  </section>
);

const ownershipItems = [
  {
    icon: ServerCog,
    title: 'Run the application',
    copy: 'Project S is self-hostable scheduling infrastructure. Your deployment configuration decides where the app and its supported Supabase/Postgres backend run.',
  },
  {
    icon: KeyRound,
    title: 'Control the private boundary',
    copy: 'Public contracts expose the narrow data required to discover and book. Authenticated host operations and row-level security protect private booking state.',
  },
  {
    icon: ShieldCheck,
    title: 'Keep authority deterministic',
    copy: 'Availability and consent are validated by application and database rules—not inferred from a chat response or delegated to model reasoning.',
  },
];

const OwnershipSection = () => (
  <section id="ownership" className="scroll-mt-20 bg-[#e9e7e0]" aria-labelledby="ownership-title">
    <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20 lg:px-12 lg:py-28">
      <Reveal>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#5948c6]">Own the flow</p>
        <h2 id="ownership-title" className="mt-5 max-w-xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-[#171716] sm:text-5xl lg:text-6xl">
          Infrastructure, not a promise from someone else’s platform.
        </h2>
        <p className="mt-6 max-w-lg text-base leading-7 text-black/58">
          Inspect the contracts, run the tests, seed a fictional local host, and verify the authority boundary end to end. The current v1 stays deliberately narrow.
        </p>
        <Link
          to="/demo"
          className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-full border border-black/25 px-6 text-sm font-semibold text-[#171716] outline-none transition-colors hover:border-black/55 focus-visible:ring-2 focus-visible:ring-[#6857d9] focus-visible:ring-offset-4 focus-visible:ring-offset-[#e9e7e0]"
        >
          Run the local demo
          <TerminalSquare className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Reveal>

      <div className="border-t border-black/20">
        {ownershipItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.title} delay={index * 0.05}>
              <article className="grid gap-4 border-b border-black/20 py-7 sm:grid-cols-[48px_0.7fr_1.3fr] sm:items-start sm:gap-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-black/20 bg-[#f4f3ef]">
                  <Icon className="h-5 w-5 text-[#6857d9]" aria-hidden="true" />
                </span>
                <h3 className="text-lg font-semibold tracking-[-0.035em] text-[#171716] sm:pt-2">{item.title}</h3>
                <p className="text-sm leading-6 text-black/58 sm:pt-2">{item.copy}</p>
              </article>
            </Reveal>
          );
        })}
      </div>
    </div>
  </section>
);

const GuaranteeRow = ({ icon: Icon, title, copy }: { icon: typeof CheckCircle2; title: string; copy: string }) => (
  <div className="grid gap-4 border-t border-white/15 py-6 sm:grid-cols-[48px_0.75fr_1.25fr] sm:items-start sm:gap-6">
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15">
      <Icon className="h-4 w-4 text-[#aaa0ff]" aria-hidden="true" />
    </span>
    <h3 className="text-base font-semibold sm:pt-2">{title}</h3>
    <p className="text-sm leading-6 text-white/52 sm:pt-2">{copy}</p>
  </div>
);

const FinalSection = () => (
  <section className="bg-[#171716] text-white" aria-labelledby="verified-title">
    <div className="mx-auto w-full max-w-[1440px] px-5 py-20 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
      <Reveal className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#aaa0ff]">Built to be verified</p>
          <h2 id="verified-title" className="mt-5 max-w-xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-5xl lg:text-6xl">
            Trust the boundary because you can see it fail closed.
          </h2>
        </div>
        <div className="border-b border-white/15">
          <GuaranteeRow
            icon={X}
            title="Preparation is not a reservation"
            copy="Other clients can still take the slot. Final availability is checked again at commit time."
          />
          <GuaranteeRow
            icon={LockKeyhole}
            title="Approval cannot be improvised"
            copy="Create requires the real, bound confirmation path. The pre-approval refusal remains a first-class result."
          />
          <GuaranteeRow
            icon={Database}
            title="The database has the last word"
            copy="The authoritative transaction serializes by host and enforces conflict and idempotency constraints when the booking commits."
          />
        </div>
      </Reveal>

      <Reveal className="mt-20 border-t border-white/15 pt-12 sm:mt-24 sm:pt-16">
        <div className="flex flex-col justify-between gap-9 lg:flex-row lg:items-end">
          <div>
            <p className="text-sm font-semibold text-[#aaa0ff]">Project S v1 developer preview</p>
            <p className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl lg:text-5xl">
              See one prepared request cross the human and database authority boundaries.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
            <Link
              to="/demo"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#6857d9] px-6 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#5948c6] focus-visible:ring-2 focus-visible:ring-[#aaa0ff] focus-visible:ring-offset-4 focus-visible:ring-offset-[#171716]"
            >
              Open the authority demo
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              to="/book/demo-host"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/25 px-6 text-sm font-semibold text-white outline-none transition-colors hover:border-white/55 focus-visible:ring-2 focus-visible:ring-[#aaa0ff] focus-visible:ring-offset-4 focus-visible:ring-offset-[#171716]"
            >
              Try the booking page
            </Link>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
);

const Footer = () => (
  <footer className="border-t border-white/10 bg-[#171716] text-white">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-5 py-8 text-xs text-white/65 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
      <div className="flex items-center gap-2.5 text-white/75">
        <ProjectSMark />
        <span className="font-semibold">Project S</span>
      </div>
      <p>Open-source scheduling infrastructure for humans, software, and agents.</p>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em]">Noindex review concept</p>
    </div>
  </footer>
);

const OwnBookingFlow = () => {
  useEffect(() => {
    const previousTitle = document.title;
    const existingRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobots = existingRobots?.getAttribute('content');
    const robots = existingRobots ?? document.createElement('meta');

    document.title = 'Own Your Booking Flow — Project S design study';
    robots.setAttribute('name', 'robots');
    robots.setAttribute('content', 'noindex, nofollow');

    if (!existingRobots) {
      document.head.appendChild(robots);
    }

    return () => {
      document.title = previousTitle;
      if (existingRobots) {
        if (previousRobots == null) {
          existingRobots.removeAttribute('content');
        } else {
          existingRobots.setAttribute('content', previousRobots);
        }
      } else {
        robots.remove();
      }
    };
  }, []);

  return (
    <div
      className="min-h-screen overflow-x-clip bg-[#f4f3ef] font-sans text-[#171716] selection:bg-[#c9c2ff] selection:text-[#171716]"
      style={{ color: ink, backgroundColor: paper }}
    >
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-50 -translate-y-24 rounded-md bg-[#171716] px-4 py-3 text-sm font-semibold text-white outline-none transition-transform focus:translate-y-0 focus:ring-2 focus:ring-[#aaa0ff]"
      >
        Skip to content
      </a>
      <Header />
      <main id="main-content">
        <Hero />
        <ProductSection />
        <FoundationSection />
        <AuthoritySection />
        <OwnershipSection />
        <FinalSection />
      </main>
      <Footer />
    </div>
  );
};

export default OwnBookingFlow;
