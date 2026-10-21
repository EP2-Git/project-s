import { useEffect, useReducer, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  FlaskConical,
  History,
  KeyRound,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  UserRound,
  XCircle,
} from 'lucide-react';
import DeploymentHeader from '@/components/deployment/DeploymentHeader';
import DeploymentFooter from '@/components/deployment/DeploymentFooter';
import Container from '@/components/ui/container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { createLabState, labTime, transitionLab } from '@/features/authority-lab/model';
import type { LabDecision, LabIntent, LabLimits, LabScenario } from '@/features/authority-lab/types';

const defaultLimits: LabLimits = {
  windowEndMinute: 90,
  maxDurationMinutes: 30,
  lifetimeMinutes: 20,
};

const scenarios: { value: LabScenario; label: string; description: string }[] = [
  {
    value: 'within_scope',
    label: 'Within permission',
    description: 'A 30-minute introduction with demo-host at 14:00 UTC.',
  },
  {
    value: 'outside_window',
    label: 'Outside the booking window',
    description: 'The same introduction at 15:00 UTC. A narrower window needs your approval.',
  },
  {
    value: 'other_host',
    label: 'A different host',
    description: 'A request for another-host instead of the host you permitted.',
  },
  {
    value: 'wrong_caller',
    label: 'An unrecognized agent',
    description: 'A different agent attempts to use the simulated guest agent’s permission.',
  },
];

const decisionTitles: Record<LabDecision['kind'], string> = {
  idle: 'Ready when you are',
  prepared: 'Prepared for your next step',
  approval_required: 'Your approval is needed',
  confirmed: 'Simulated booking confirmed',
  replayed: 'Same request, same booking',
  refused: 'Request stopped at the boundary',
  updated: 'Simulation updated',
};

const selectStyle = 'min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const actionStyle = 'h-auto min-h-10 whitespace-normal text-left';

function IntentDetails({ intent }: { intent: LabIntent }) {
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div className="min-w-0">
        <dt className="text-muted-foreground">Host</dt>
        <dd className="mt-0.5 break-words font-medium">{intent.hostId}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">Meeting</dt>
        <dd className="mt-0.5 break-words font-medium">{intent.meetingTypeId}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">Starts</dt>
        <dd className="mt-0.5 font-medium">{labTime(intent.startMinute)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Duration</dt>
        <dd className="mt-0.5 font-medium">{intent.durationMinutes} minutes</dd>
      </div>
    </dl>
  );
}

export default function AuthorityLab() {
  const [state, dispatch] = useReducer(transitionLab, undefined, createLabState);
  const [limits, setLimits] = useState<LabLimits>(defaultLimits);
  const [scenario, setScenario] = useState<LabScenario>('within_scope');

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Authority Lab | Project S';
    return () => { document.title = previousTitle; };
  }, []);

  const selectedScenario = scenarios.find((item) => item.value === scenario) ?? scenarios[0];
  const configurationLocked = Boolean(
    state.preparation || state.approval || state.receipt
    || state.permission.status !== 'active' || state.credential.status !== 'active',
  );
  const unappliedLimits = limits.windowEndMinute !== state.permission.limits.windowEndMinute
    || limits.maxDurationMinutes !== state.permission.limits.maxDurationMinutes
    || limits.lifetimeMinutes !== state.permission.limits.lifetimeMinutes;
  const permissionExpired = state.now >= state.permission.expiresAt;
  const permissionLabel = state.permission.status === 'revoked'
    ? 'Revoked'
    : state.permission.status === 'replaced'
      ? 'Replaced by exact approval'
      : permissionExpired
        ? 'Expired'
        : state.permission.remainingUses === 0 ? 'Used' : 'Active';
  const pendingApproval = state.approval?.status === 'pending' ? state.approval : null;
  const reviewExpired = Boolean(pendingApproval && state.now >= pendingApproval.expiresAt);
  const canApprove = Boolean(
    pendingApproval && !reviewExpired && state.now < state.credential.expiresAt
    && state.permission.status !== 'revoked' && state.credential.status === 'active',
  );
  const approval = state.approval;
  const preparation = state.preparation;
  const receipt = state.receipt;
  const decisionPositive = ['prepared', 'confirmed', 'replayed'].includes(state.decision.kind);
  const DecisionIcon = state.decision.kind === 'refused'
    ? XCircle : state.decision.kind === 'approval_required' ? UserRound : decisionPositive ? CheckCircle2 : ShieldCheck;

  function applyLimits(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatch({ type: 'configure', limits });
  }

  function resetSimulation() {
    dispatch({ type: 'reset' });
    setLimits(defaultLimits);
    setScenario('within_scope');
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <DeploymentHeader />
      <main className="flex-1" id="main-content">
        <Container className="max-w-7xl py-8 sm:py-12">
          <div className="mb-7 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
            <FlaskConical aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 font-medium">Synthetic simulation — no real booking or agent credential is created</p>
            <Badge variant="outline" className="shrink-0 bg-background">Local to this page</Badge>
          </div>

          <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-foreground">A person sets the boundaries. An agent works within them.</p>
              <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Authority Lab</h1>
              <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
                Try a permission, inspect an agent’s request, and see exactly when a person needs to step in.
                You control every action in this simulation.
              </p>
            </div>
            <div className="flex w-fit items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm">
              <UserRound aria-hidden="true" className="h-4 w-4 text-primary" />
              <span>Person</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <Bot aria-hidden="true" className="h-4 w-4 text-primary" />
              <span>Simulated agent</span>
            </div>
          </div>

          <dl className="mb-6 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
            <div className="border-b border-r border-border p-4 sm:p-5 lg:border-b-0">
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Clock3 aria-hidden="true" className="h-3.5 w-3.5" />Demo clock · UTC</dt>
              <dd className="mt-2 font-display text-xl font-semibold tabular-nums">{labTime(state.now)}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">Starts 2 November 2026</dd>
            </div>
            <div className="border-b border-border p-4 sm:p-5 lg:border-b-0 lg:border-r">
              <dt className="text-xs font-medium text-muted-foreground">Permission</dt>
              <dd className="mt-2 text-sm font-semibold">{permissionLabel}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">Expires {labTime(state.permission.expiresAt)}</dd>
            </div>
            <div className="border-r border-border p-4 sm:p-5">
              <dt className="text-xs font-medium text-muted-foreground">Booking allowance</dt>
              <dd className="mt-2 font-display text-xl font-semibold tabular-nums">{state.permission.remainingUses}<span className="ml-1 text-sm font-normal text-muted-foreground">/ 1 remaining</span></dd>
              <dd className="mt-1 text-xs text-muted-foreground">One permitted booking</dd>
            </div>
            <div className="p-4 sm:p-5">
              <dt className="text-xs font-medium text-muted-foreground">Bookings created</dt>
              <dd data-testid="lab-booking-count" className="mt-2 font-display text-xl font-semibold tabular-nums">{state.bookingCount}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">Synthetic records only</dd>
            </div>
          </dl>

          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-12">
            <Card className="min-w-0 lg:col-span-4">
              <CardHeader className="border-b border-border pb-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserRound aria-hidden="true" className="h-5 w-5" /></span>
                  <Badge variant="secondary">01 · Person</Badge>
                </div>
                <h2 className="text-lg font-semibold">Set the permission</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">Choose what the agent may book without asking you again.</p>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <p className="font-medium">One introduction with demo-host</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Meeting type: intro-30 · 30 minutes. The simulated host sets the meeting duration.</p>
                </div>
                <form onSubmit={applyLimits} className="space-y-4">
                  <fieldset disabled={configurationLocked} className="min-w-0 space-y-4">
                    <legend className="sr-only">Permission limits</legend>
                    <div className="space-y-2">
                      <label htmlFor="lab-window" className="block text-sm font-medium">Booking window</label>
                      <select id="lab-window" className={selectStyle} value={limits.windowEndMinute} onChange={(event) => setLimits({ ...limits, windowEndMinute: Number(event.target.value) })}>
                        <option value={90}>14:00–14:30 UTC</option>
                        <option value={180}>14:00–16:00 UTC</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="lab-duration" className="block text-sm font-medium">Maximum duration</label>
                      <select id="lab-duration" className={selectStyle} value={limits.maxDurationMinutes} onChange={(event) => setLimits({ ...limits, maxDurationMinutes: Number(event.target.value) })}>
                        <option value={15}>15 minutes</option>
                        <option value={30}>30 minutes</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="lab-lifetime" className="block text-sm font-medium">Permission lifetime</label>
                      <select id="lab-lifetime" className={selectStyle} value={limits.lifetimeMinutes} onChange={(event) => setLimits({ ...limits, lifetimeMinutes: Number(event.target.value) })}>
                        <option value={5}>5 minutes from the demo clock</option>
                        <option value={20}>20 minutes from the demo clock</option>
                      </select>
                    </div>
                    <Button type="submit" variant="outline" className="w-full">Apply permission limits</Button>
                  </fieldset>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {configurationLocked ? 'Reset the simulation to change the original permission.' : unappliedLimits ? 'Apply your changed limits before preparing a request.' : 'Apply changes before preparing a request. These limits do not change the host’s meeting type.'}
                  </p>
                </form>
                <div className="space-y-3 border-t border-border pt-4">
                  <Button variant="outline" className={`${actionStyle} w-full justify-start`} disabled={state.permission.status === 'revoked'} onClick={() => dispatch({ type: 'revoke_permission' })}>
                    <ShieldOff aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />Revoke permission
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">Stops new use of the permission and its linked approval. It does not cancel an existing booking.</p>
                </div>
              </CardContent>
            </Card>

            <div className="min-w-0 space-y-6 lg:col-span-8">
              <Card className="min-w-0">
                <CardHeader className="pb-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Bot aria-hidden="true" className="h-5 w-5" /></span>
                    <Badge variant="secondary">02 · Simulated guest agent</Badge>
                  </div>
                  <h2 className="text-lg font-semibold">Inspect the request</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">Choose an example request. Preparation checks the boundary; commit attempts the booking.</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
                    <div className="space-y-2">
                      <label htmlFor="lab-scenario" className="block text-sm font-medium">Request scenario</label>
                      <select id="lab-scenario" className={selectStyle} value={scenario} onChange={(event) => setScenario(event.target.value as LabScenario)}>
                        {scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground sm:pt-7">{selectedScenario.description}</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button className={actionStyle} disabled={unappliedLimits && !configurationLocked} onClick={() => dispatch({ type: 'prepare', scenario })}>
                      Prepare request<ArrowRight aria-hidden="true" className="ml-2 h-4 w-4 shrink-0" />
                    </Button>
                    <Button variant="outline" className={actionStyle} disabled={!preparation} onClick={() => dispatch({ type: 'commit' })}>
                      Commit simulated booking
                    </Button>
                  </div>
                  {preparation && <p className="text-xs leading-relaxed text-muted-foreground">Commit uses the prepared intent shown below. Prepare again to request a different scenario.</p>}
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><LockKeyhole aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Preparation reserves nothing. The slot and permission are checked again at commit.</span></p>

                  <div data-testid="lab-decision" aria-live="polite" aria-atomic="true" className={`rounded-lg border p-4 ${state.decision.kind === 'refused' ? 'border-destructive/40 bg-destructive/5' : 'border-primary/25 bg-primary/5'}`}>
                    <div className="flex items-start gap-3">
                      <DecisionIcon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${state.decision.kind === 'refused' ? 'text-destructive' : 'text-primary'}`} />
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">{decisionTitles[state.decision.kind]}</h3>
                        <p className="mt-1 text-sm leading-relaxed">{state.decision.message}</p>
                        <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">{state.decision.code}</p>
                      </div>
                    </div>
                  </div>

                  {preparation && (
                    <div className="space-y-3 rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold">Prepared intent</h3>
                        <Badge variant="outline">{state.now >= preparation.expiresAt ? 'Preparation expired' : preparation.source === 'step_up' ? 'Exact approval' : 'Within permission'}</Badge>
                      </div>
                      <IntentDetails intent={preparation.intent} />
                      <p className="border-t border-border pt-3 text-xs text-muted-foreground">Preparation expires {labTime(preparation.expiresAt)} · {preparation.source === 'step_up' ? 'Only this approved request may be committed.' : 'No slot is held.'}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {approval && (
                <Card className="min-w-0 border-primary/35">
                  <CardHeader className="pb-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">03 · Person reviews</Badge>
                      <Badge variant="secondary">{approval.status === 'pending' ? reviewExpired ? 'Review expired' : 'Waiting for you' : approval.status === 'approved' ? state.now >= approval.expiresAt ? 'Exact approval expired' : 'Approval recorded' : 'Approval revoked'}</Badge>
                    </div>
                    <h2 className="text-lg font-semibold">Review this exact request</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">Approval covers the details below once. It replaces the unused original permission; it does not broaden that permission.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <IntentDetails intent={approval.intent} />
                    {approval.differences.length > 0 && (
                      <div className="rounded-md bg-muted/50 p-3">
                        <h3 className="text-xs font-semibold">Why the person needs to step in</h3>
                        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed">
                          {approval.differences.map((difference) => <li key={difference} className="flex items-start gap-2"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" /><span>{difference === 'host' ? 'This host is outside the original permission.' : difference === 'meeting window' ? 'This meeting falls outside the permitted booking window.' : difference === 'duration' ? 'The host’s meeting is longer than the permitted duration.' : difference === 'meeting type' ? 'This meeting type is outside the original permission.' : difference}</span></li>)}
                        </ul>
                      </div>
                    )}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-muted-foreground">{approval.status === 'pending' ? 'Review' : 'Exact approval'} expires {labTime(approval.expiresAt)}</p>
                      <Button className={actionStyle} disabled={!canApprove} onClick={() => dispatch({ type: 'approve', approvalId: approval.id })}><Check aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />Approve exact request</Button>
                    </div>
                    {reviewExpired && <p className="text-sm text-muted-foreground">This review has expired. Prepare the request again to request a fresh review.</p>}
                  </CardContent>
                </Card>
              )}

              {receipt && (
                <Card className="min-w-0">
                  <CardHeader className="pb-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant="outline">Simulated result</Badge><Badge variant={receipt.status === 'confirmed' ? 'default' : 'secondary'}>{receipt.status === 'confirmed' ? 'Confirmed' : 'Cancelled by host'}</Badge></div>
                    <h2 className="text-lg font-semibold">One booking. One receipt.</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">An eligible retry returns this booking instead of creating another. A cancelled booking cannot be replayed as confirmed.</p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <IntentDetails intent={receipt.intent} />
                    <dl className="space-y-2 rounded-md bg-muted/50 p-3 text-xs">
                      <div><dt className="text-muted-foreground">Synthetic booking ID</dt><dd className="mt-1 break-all font-mono">{receipt.bookingId}</dd></div>
                      <div><dt className="text-muted-foreground">Synthetic receipt ID</dt><dd data-testid="lab-receipt-id" className="mt-1 break-all font-mono">{receipt.id}</dd></div>
                    </dl>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button variant="outline" className={actionStyle} onClick={() => dispatch({ type: 'retry' })}><RotateCcw aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />Retry same request</Button>
                      <Button variant="outline" className={actionStyle} disabled={receipt.status === 'cancelled'} onClick={() => dispatch({ type: 'cancel_booking' })}>Simulate host cancellation</Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Receipt expires {labTime(receipt.expiresAt)}. A revoked agent key cannot retrieve it.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <section aria-labelledby="lab-controls-heading" className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <div className="mb-2 flex items-center gap-2"><SlidersHorizontal aria-hidden="true" className="h-4 w-4 text-primary" /><h2 id="lab-controls-heading" className="text-base font-semibold">Test a boundary</h2></div>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">Move the demo clock or change a fixture, then try the next action. These controls affect only this synthetic session.</p>
              </div>
              <Button variant="ghost" className={`${actionStyle} shrink-0 self-start`} onClick={resetSimulation}><RotateCcw aria-hidden="true" className="mr-2 h-4 w-4" />Reset simulation</Button>
            </div>
            <div className="mt-5 grid min-w-0 gap-5 border-t border-border pt-5 md:grid-cols-3">
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expiry</h3>
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 20].map((minutes) => <Button key={minutes} variant="outline" size="sm" className={actionStyle} onClick={() => dispatch({ type: 'advance_clock', minutes })}>Advance {minutes} {minutes === 1 ? 'minute' : 'minutes'}</Button>)}
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Availability</h3>
                <Button variant="outline" size="sm" className={actionStyle} onClick={() => dispatch({ type: 'toggle_slot' })}>Change slot availability</Button>
                <p className="mt-2 text-xs text-muted-foreground">Slot is {state.slotAvailable ? 'available' : 'unavailable'} in this fixture.</p>
              </div>
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent access</h3>
                <Button variant="outline" size="sm" className={actionStyle} disabled={state.credential.status === 'revoked'} onClick={() => dispatch({ type: 'revoke_credential' })}><KeyRound aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />Revoke agent key</Button>
                <p className="mt-2 text-xs text-muted-foreground">Simulated key: {state.credential.status}. No real credential is present.</p>
              </div>
            </div>
          </section>

          <section aria-labelledby="lab-activity-heading" className="mt-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><History aria-hidden="true" className="h-4 w-4 text-primary" /><h2 id="lab-activity-heading" className="text-lg font-semibold">Activity in this simulation</h2></div>
              <span className="text-xs text-muted-foreground">Newest first · up to 64 events</span>
            </div>
            <p className="mb-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">A record of requests and decisions, with no private agent reasoning. Resetting clears this page’s activity.</p>
            <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {[...state.events].reverse().map((event) => (
                <li key={event.id} className="grid min-w-0 gap-2 p-4 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:gap-4 sm:p-5">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground sm:block"><span className="font-mono tabular-nums">{labTime(event.atMinute)}</span><span className="sm:mt-1 sm:block">#{event.id}</span></div>
                  <div className="min-w-0"><p className="text-sm font-medium">{event.title}</p><p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{event.detail}</p><p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{event.code}</p></div>
                  <div className="flex items-center gap-2 self-start sm:flex-col sm:items-end"><Badge variant="outline" className="capitalize">{event.actor}</Badge><span className="text-xs text-muted-foreground">{event.outcome === 'needs_approval' ? 'Needs approval' : event.outcome === 'allowed' ? 'Allowed' : event.outcome === 'blocked' ? 'Blocked' : 'Information'}</span></div>
                </li>
              ))}
              {state.events.length === 0 && <li className="p-5 text-sm text-muted-foreground">Prepare a request to see the first decision.</li>}
            </ol>
          </section>

          <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><span>This lab explains the permission boundary. It does not enable delegated booking in Project S, connect a calendar, or represent independent agent evaluation.</span></p>
        </Container>
      </main>
      <DeploymentFooter />
    </div>
  );
}
