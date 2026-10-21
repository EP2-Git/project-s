import { describe, expect, it } from 'vitest';

import { createLabState, labTime, transitionLab } from '@/features/authority-lab/model';
import type { LabCommand, LabLimits, LabState } from '@/features/authority-lab/types';

// MODEL evidence only. These vectors do not prove authentication, SQL locking,
// real concurrent writes, persistent audit, or live delegated booking.
const advance = (state: LabState, minutes: number) => transitionLab(state, { type: 'advance_clock', minutes });
const prepare = (state = createLabState()) => transitionLab(state, { type: 'prepare', scenario: 'within_scope' });
const book = () => transitionLab(prepare(), { type: 'commit' });
const requestStepUp = () => transitionLab(createLabState(), { type: 'prepare', scenario: 'outside_window' });
const approveStepUp = () => transitionLab(requestStepUp(), { type: 'approve' });
const defaultLimits: LabLimits = { windowEndMinute: 90, maxDurationMinutes: 30, lifetimeMinutes: 20 };

const freezeDeep = <T,>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(freezeDeep);
  }
  return value;
};

describe('Authority Lab synthetic model — no live authority proof', () => {
  it('uses a fixed explicit clock, one 30-minute fixture and a single-use default permission', () => {
    const state = createLabState();
    expect(state.now).toBe(0);
    expect(state.permission.limits).toEqual(defaultLimits);
    expect(state.permission.expiresAt).toBe(20);
    expect(state.permission.remainingUses).toBe(1);
    expect(state.credential.expiresAt).toBe(10_080);
    expect(labTime(0)).toBe('13:00 UTC');
    expect(labTime(60)).toBe('14:00 UTC');
    expect(labTime(1_440)).toBe('Nov 3, 2026 13:00 UTC');
    for (const value of [-1, 0.5, NaN, Infinity, 525_601]) expect(labTime(value)).toBe('Invalid simulation time');
  });

  it('prepares without reserving or consuming, then records only one fictional first write', () => {
    const initial = freezeDeep(createLabState());
    const initialSnapshot = JSON.stringify(initial);
    const prepared = transitionLab(initial, freezeDeep({ type: 'prepare', scenario: 'within_scope' } as const));
    expect(prepared.decision.code).toBe('PREPARED');
    expect(prepared.preparation?.intent).toEqual({ hostId: 'demo-host', meetingTypeId: 'intro-30', startMinute: 60, durationMinutes: 30 });
    expect(prepared.preparation?.expiresAt).toBe(10);
    expect(prepared.bookingCount).toBe(0);
    expect(prepared.permission.remainingUses).toBe(1);
    expect(prepared.receipt).toBeNull();
    const committed = transitionLab(freezeDeep(prepared), { type: 'commit' });
    expect(committed.decision.code).toBe('CONFIRMED');
    expect(committed.bookingCount).toBe(1);
    expect(committed.permission.remainingUses).toBe(0);
    expect(committed.receipt?.status).toBe('confirmed');
    expect(JSON.stringify(initial)).toBe(initialSnapshot);
    expect(prepared.receipt).toBeNull();
  });

  it('checks the whole derived meeting and its duration, not just its start', () => {
    const shortWindow = transitionLab(createLabState(), { type: 'configure', limits: { ...defaultLimits, windowEndMinute: 89 } });
    expect(prepare(shortWindow).decision.code).toBe('STEP_UP_REQUIRED');
    const shortDuration = transitionLab(createLabState(), { type: 'configure', limits: { ...defaultLimits, maxDurationMinutes: 29 } });
    expect(prepare(shortDuration).approval?.differences).toEqual(['duration']);
    expect(prepare().decision.code).toBe('PREPARED'); // End exactly at inclusive window boundary.
    const expanded = transitionLab(createLabState(), { type: 'configure', limits: { ...defaultLimits, windowEndMinute: 150 } });
    expect(transitionLab(expanded, { type: 'prepare', scenario: 'outside_window' }).decision.code).toBe('PREPARED');
  });

  it('permits configuration after clock/availability changes but locks it after meaningful authority activity', () => {
    const changed = transitionLab(advance(createLabState(), 2), { type: 'toggle_slot' });
    const configured = transitionLab(changed, { type: 'configure', limits: { ...defaultLimits, lifetimeMinutes: 30 } });
    expect(configured.decision.code).toBe('LIMITS_UPDATED');
    expect(configured.permission.expiresAt).toBe(32);
    for (const state of [prepare(), requestStepUp(), book(),
      transitionLab(createLabState(), { type: 'revoke_permission' }),
      transitionLab(createLabState(), { type: 'revoke_credential' })]) {
      const result = transitionLab(state, { type: 'configure', limits: defaultLimits });
      expect(result.decision.code).toBe('RESET_REQUIRED');
      expect(result.permission).toEqual(state.permission);
    }
  });

  it('fails closed for malformed numbers, unknown fields and unsupported commands without crashing', () => {
    const commands: unknown[] = [
      null, undefined, [], {}, { type: 'grant_unlimited' },
      { type: 'prepare', scenario: 'invented' },
      { type: 'prepare', scenario: 'within_scope', allowed: true },
      { type: 'prepare', scenario: 'within_scope', caller: { principalId: 'spoofed' } },
      { type: 'prepare', scenario: 'within_scope', caller: { actorId: '' } },
      { type: 'commit', preparationId: 1 }, { type: 'commit', idempotencyKey: '' },
      { type: 'commit', intent: { durationMinutes: 0 } }, { type: 'approve', approvalId: [] },
      { type: 'reset', confirmed: true },
    ];
    for (const minutes of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) commands.push({ type: 'advance_clock', minutes });
    for (const limits of [
      { ...defaultLimits, windowEndMinute: 60 }, { ...defaultLimits, maxDurationMinutes: 0 },
      { ...defaultLimits, lifetimeMinutes: 1_441 }, { ...defaultLimits, lifetimeMinutes: NaN },
      { ...defaultLimits, lifetimeMinutes: -1 }, { ...defaultLimits, maxDurationMinutes: Infinity },
      { ...defaultLimits, windowEndMinute: 100.1 }, { ...defaultLimits, unlimited: true }, null,
    ]) commands.push({ type: 'configure', limits });
    const initial = freezeDeep(createLabState());
    for (const command of commands) {
      const result = transitionLab(initial, command as LabCommand);
      expect(result.decision.code, JSON.stringify(command)).toBe('INVALID_REQUEST');
      expect(result.now).toBe(0);
      expect(result.bookingCount).toBe(0);
      expect(result.permission.remainingUses).toBe(1);
      expect(result.approval).toBeNull();
    }
  });

  it('requires the exact current caller/audience/epoch before preparation and never offers step-up for an invalid caller', () => {
    for (const caller of [
      { actorId: 'other-agent' }, { credentialId: 'other-key' },
      { audience: 'authority-lab:other' }, { epoch: 2 },
    ]) {
      const result = transitionLab(createLabState(), { type: 'prepare', scenario: 'outside_window', caller });
      expect(result.decision.code).toBe('AUTHENTICATION_REQUIRED');
      expect(result.approval).toBeNull();
    }
    const wrong = transitionLab(createLabState(), { type: 'prepare', scenario: 'wrong_caller', caller: { actorId: 'guest-agent' } });
    expect(wrong.decision.code).toBe('AUTHENTICATION_REQUIRED');
    expect(wrong.approval).toBeNull();
  });

  it('denies new writes exactly at permission expiry and clips preparations to remaining permission time', () => {
    expect(prepare(advance(createLabState(), 20)).decision.code).toBe('MANDATE_EXPIRED');
    const lastMinute = prepare(advance(createLabState(), 19));
    expect(lastMinute.preparation?.expiresAt).toBe(20);
    expect(transitionLab(lastMinute, { type: 'commit' }).decision.code).toBe('CONFIRMED');
    const expired = transitionLab(advance(lastMinute, 1), { type: 'commit' });
    expect(expired.decision.code).toBe('MANDATE_EXPIRED');
    expect(expired.permission.remainingUses).toBe(1);
    expect(expired.bookingCount).toBe(0);
  });

  it('refuses exactly at preparation expiry while permitting a still-live preparation', () => {
    expect(transitionLab(advance(prepare(), 9), { type: 'commit' }).decision.code).toBe('CONFIRMED');
    const expired = transitionLab(advance(prepare(), 10), { type: 'commit' });
    expect(expired.decision.code).toBe('PREPARATION_EXPIRED');
    expect(expired.permission.remainingUses).toBe(1);
  });

  it('refuses a past meeting at preparation, approval and first commit without blocking eligible replay', () => {
    const wide = transitionLab(createLabState(), { type: 'configure', limits: { ...defaultLimits, lifetimeMinutes: 240 } });
    const renewedAtStart = transitionLab(advance(createLabState(), 60), { type: 'configure', limits: defaultLimits });
    expect(prepare(renewedAtStart).decision.code).toBe('SLOT_UNAVAILABLE');
    expect(prepare(renewedAtStart).permission.remainingUses).toBe(1);
    const prepared = prepare(advance(wide, 55));
    expect(prepared.preparation?.expiresAt).toBe(65);
    const lateCommit = transitionLab(advance(prepared, 5), { type: 'commit' });
    expect(lateCommit.decision.code).toBe('SLOT_UNAVAILABLE');
    expect(lateCommit.bookingCount).toBe(0);
    const lateReview = transitionLab(advance(wide, 117), { type: 'prepare', scenario: 'outside_window' });
    expect(lateReview.approval?.expiresAt).toBe(122);
    expect(transitionLab(advance(lateReview, 3), { type: 'approve' }).decision.code).toBe('SLOT_UNAVAILABLE');
    expect(transitionLab(advance(book(), 120), { type: 'retry' }).decision.code).toBe('REPLAYED');
  });

  it('returns exact replay before mandate expiry/revoke/use checks without another authoritative success', () => {
    const committed = book();
    const revoked = transitionLab(advance(committed, 30), { type: 'revoke_permission' });
    const replayed = transitionLab(revoked, { type: 'retry' });
    expect(replayed.decision.code).toBe('REPLAYED');
    expect(replayed.receipt).toEqual(committed.receipt);
    expect(replayed.bookingCount).toBe(1);
    expect(replayed.events.filter((event) => event.code === 'CONFIRMED')).toHaveLength(1);
    expect(replayed.events.at(-1)?.outcome).toBe('info');
    const withoutPreparation = { ...revoked, preparation: null };
    expect(transitionLab(withoutPreparation, { type: 'retry' }).decision.code).toBe('REPLAYED');
  });

  it('denies replay for wrong identity, audience, epoch, revoked or expired credential before looking up the receipt', () => {
    const committed = book();
    for (const caller of [
      { actorId: 'other-agent' }, { credentialId: 'other-key' }, { audience: 'other-instance' }, { epoch: 2 },
    ]) expect(transitionLab(committed, { type: 'retry', caller }).decision.code).toBe('AUTHENTICATION_REQUIRED');
    const revoked = transitionLab(committed, { type: 'revoke_credential' });
    expect(transitionLab(revoked, { type: 'retry' }).decision.code).toBe('AUTHENTICATION_REQUIRED');
    expect(transitionLab(advance(committed, 10_080), { type: 'retry' }).decision.code).toBe('AUTHENTICATION_REQUIRED');
    expect(transitionLab({ ...committed, epoch: 2 }, { type: 'retry' }).decision.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('refuses receipt access at 24 hours and never funds a replacement booking', () => {
    const committed = book();
    expect(transitionLab(advance(committed, 1_439), { type: 'retry' }).decision.code).toBe('REPLAYED');
    const expired = transitionLab(advance(committed, 1_440), { type: 'retry' });
    expect(expired.decision.code).toBe('RECEIPT_UNAVAILABLE');
    expect(expired.bookingCount).toBe(1);
    expect(expired.permission.remainingUses).toBe(0);
  });

  it('refuses cancelled receipts, preserves spent budget and does not resurrect the meeting', () => {
    const cancelled = transitionLab(book(), { type: 'cancel_booking' });
    const retried = transitionLab(cancelled, { type: 'retry' });
    expect(retried.decision.code).toBe('SLOT_UNAVAILABLE');
    expect(retried.receipt?.status).toBe('cancelled');
    expect(retried.permission.remainingUses).toBe(0);
    expect(retried.bookingCount).toBe(1);
    expect(transitionLab(cancelled, { type: 'commit', idempotencyKey: 'new-key' }).decision.code).toBe('EVIDENCE_USED');
  });

  it('distinguishes a reused key with different preparation from a different key reusing spent evidence', () => {
    const committed = book();
    const key = committed.receipt!.idempotencyKey;
    expect(transitionLab(committed, { type: 'commit', preparationId: 'another-preparation', idempotencyKey: key }).decision.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(transitionLab(committed, { type: 'commit', idempotencyKey: 'another-key' }).decision.code).toBe('EVIDENCE_USED');
    expect(committed.bookingCount).toBe(1);
  });

  it('checks fresh availability at commit and allows the same unspent request to retry', () => {
    const prepared = prepare();
    const unavailable = transitionLab(prepared, { type: 'toggle_slot' });
    const refused = transitionLab(unavailable, { type: 'commit', idempotencyKey: 'stable-key' });
    expect(refused.decision.code).toBe('SLOT_UNAVAILABLE');
    expect(refused.permission.remainingUses).toBe(1);
    expect(refused.receipt).toBeNull();
    const restored = transitionLab(refused, { type: 'toggle_slot' });
    const committed = transitionLab(restored, { type: 'commit', idempotencyKey: 'stable-key' });
    expect(committed.decision.code).toBe('CONFIRMED');
    expect(committed.receipt?.preparationId).toBe(prepared.preparation?.id);
  });

  it('deduplicates a pending exact review and records which original limits were exceeded', () => {
    const pending = requestStepUp();
    expect(pending.decision.code).toBe('STEP_UP_REQUIRED');
    expect(pending.approval?.differences).toEqual(['meeting window']);
    expect(pending.approval?.expiresAt).toBe(5);
    const repeated = transitionLab(pending, { type: 'prepare', scenario: 'outside_window' });
    expect(repeated.approval?.id).toBe(pending.approval?.id);
    const otherHost = transitionLab(createLabState(), { type: 'prepare', scenario: 'other_host' });
    expect(otherHost.approval?.differences).toEqual(['host']);
  });

  it('atomically replaces unused original authority with one exact five-minute grant and fresh preparation', () => {
    const pending = freezeDeep(requestStepUp());
    const approved = transitionLab(pending, { type: 'approve' });
    expect(pending.permission.status).toBe('active');
    expect(approved.permission.status).toBe('replaced');
    expect(approved.permission.remainingUses).toBe(1);
    expect(approved.preparation?.source).toBe('step_up');
    expect(approved.preparation?.approvalId).toBe(pending.approval?.id);
    expect(approved.preparation?.expiresAt).toBe(5);
    const repeated = transitionLab(approved, { type: 'approve' });
    expect(repeated.preparation).toEqual(approved.preparation);
    const committed = transitionLab(repeated, { type: 'commit' });
    expect(committed.decision.code).toBe('CONFIRMED');
    expect(committed.receipt?.intent.startMinute).toBe(120);
    expect(committed.bookingCount).toBe(1);
    expect(transitionLab(committed, { type: 'commit', idempotencyKey: 'second-key' }).decision.code).toBe('EVIDENCE_USED');
  });

  it('rejects pending reviews at their exact deadline and clips approved grants to original expiry', () => {
    const expired = transitionLab(advance(requestStepUp(), 5), { type: 'approve' });
    expect(expired.decision.code).toBe('APPROVAL_EXPIRED');
    expect(expired.permission.status).toBe('active');
    const late = transitionLab(advance(createLabState(), 18), { type: 'prepare', scenario: 'outside_window' });
    const approved = transitionLab(late, { type: 'approve' });
    expect(approved.approval?.expiresAt).toBe(20);
    expect(approved.preparation?.expiresAt).toBe(20);
  });

  it('does not reactivate the old permission after exact approval expires', () => {
    const expired = advance(approveStepUp(), 5);
    expect(transitionLab(expired, { type: 'commit' }).decision.code).toBe('APPROVAL_EXPIRED');
    expect(prepare(expired).decision.code).toBe('FORBIDDEN');
    expect(expired.permission.status).toBe('replaced');
    expect(expired.permission.remainingUses).toBe(1);
  });

  it('rejects stale review references and stale policy revisions without widening permission', () => {
    const pending = requestStepUp();
    const changed = transitionLab(pending, { type: 'prepare', scenario: 'other_host' });
    expect(transitionLab(changed, { type: 'approve', approvalId: pending.approval!.id }).decision.code).toBe('APPROVAL_REQUIRED');
    const stale = { ...pending, approval: { ...pending.approval!, policyRevision: 99 } };
    expect(transitionLab(stale, { type: 'approve' }).decision.code).toBe('FORBIDDEN');
    const prepared = prepare();
    expect(transitionLab({ ...prepared, preparation: { ...prepared.preparation!, policyRevision: 99 } }, { type: 'commit' }).decision.code).toBe('FORBIDDEN');
  });

  it('original revoke invalidates a linked exact grant, including after original replacement', () => {
    const approved = approveStepUp();
    const revoked = transitionLab(approved, { type: 'revoke_permission' });
    expect(revoked.approval?.status).toBe('revoked');
    expect(transitionLab(revoked, { type: 'commit' }).decision.code).toBe('FORBIDDEN');
    expect(revoked.bookingCount).toBe(0);
    expect(revoked.permission.remainingUses).toBe(1);
  });

  it('models revoke-before-write and write-before-revoke as different ordered transitions', () => {
    const prepared = prepare();
    const revokedFirst = transitionLab(transitionLab(prepared, { type: 'revoke_permission' }), { type: 'commit' });
    expect(revokedFirst.bookingCount).toBe(0);
    const committedFirst = transitionLab(transitionLab(prepared, { type: 'commit' }), { type: 'revoke_permission' });
    expect(committedFirst.bookingCount).toBe(1);
    expect(transitionLab(committedFirst, { type: 'retry' }).decision.code).toBe('REPLAYED');
    expect(committedFirst.events.find((event) => event.code === 'CONFIRMED')!.id)
      .toBeLessThan(committedFirst.events.find((event) => event.code === 'PERMISSION_REVOKED')!.id);
  });

  it('hard denials cannot open a new step-up request', () => {
    const states = [
      advance(createLabState(), 20),
      transitionLab(createLabState(), { type: 'revoke_permission' }),
      transitionLab(createLabState(), { type: 'revoke_credential' }),
      book(),
    ];
    for (const state of states) {
      const refused = transitionLab(state, { type: 'prepare', scenario: 'outside_window' });
      expect(refused.decision.kind).toBe('refused');
      expect(refused.approval).toBeNull();
    }
  });

  it('rejects caller-overridden fixture facts and forged exact-preparation bindings', () => {
    const prepared = prepare();
    for (const intent of [
      { ...prepared.preparation!.intent, durationMinutes: 1 },
      { ...prepared.preparation!.intent, meetingTypeId: 'arbitrary-type' },
      { ...prepared.preparation!.intent, hostId: 'private-host' },
      { ...prepared.preparation!.intent, startMinute: 120 },
    ]) {
      const tampered = { ...prepared, preparation: { ...prepared.preparation!, intent } };
      expect(transitionLab(tampered, { type: 'commit' }).decision.code).toBe('FORBIDDEN');
    }
    const approved = approveStepUp();
    const tamperedExact = { ...approved, preparation: { ...approved.preparation!, intent: { ...approved.preparation!.intent, startMinute: 121 } } };
    expect(transitionLab(tamperedExact, { type: 'commit' }).decision.code).toBe('FORBIDDEN');
    const committed = book();
    const tamperedReplay = { ...committed, preparation: { ...committed.preparation!, intent: { ...committed.preparation!.intent, startMinute: 61 } } };
    expect(transitionLab(tamperedReplay, { type: 'retry' }).decision.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('bounds history, preserves event sequence and explicitly resets the fictional scenario', () => {
    let state = createLabState();
    for (let index = 0; index < 80; index += 1) state = transitionLab(state, { type: 'toggle_slot' });
    expect(state.events).toHaveLength(64);
    expect(state.sequence).toBe(81);
    expect(state.events.map((event) => event.id)).toEqual(Array.from({ length: 64 }, (_, index) => index + 18));
    const reset = transitionLab(state, { type: 'reset' });
    expect(reset.now).toBe(0);
    expect(reset.sequence).toBe(82);
    expect(reset.events).toHaveLength(1);
    expect(reset.events[0].id).toBe(82);
    expect(reset.permission.limits).toEqual(defaultLimits);
    expect(reset.bookingCount).toBe(0);
  });

  it('keeps at most one fictional first write across fixed-seed adversarial action sequences', () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      let random = seed;
      const next = () => {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        return random >>> 0;
      };
      let state = createLabState();
      let firstWritesSinceReset = 0;
      for (let index = 0; index < 128; index += 1) {
        const commands: LabCommand[] = [
          { type: 'prepare', scenario: 'within_scope' }, { type: 'prepare', scenario: 'outside_window' },
          { type: 'prepare', scenario: 'other_host' }, { type: 'prepare', scenario: 'wrong_caller' },
          { type: 'commit' }, { type: 'commit', idempotencyKey: `other-${index}` }, { type: 'approve' },
          { type: 'advance_clock', minutes: 1 + next() % 7 }, { type: 'retry' },
          { type: 'revoke_permission' }, { type: 'revoke_credential' },
          { type: 'cancel_booking' }, { type: 'toggle_slot' }, { type: 'reset' },
          { type: 'configure', limits: { ...defaultLimits, maxDurationMinutes: 5 + next() % 60 } },
        ];
        const command = commands[next() % commands.length];
        const previous = state;
        state = transitionLab(state, command);
        if (command.type === 'reset') firstWritesSinceReset = 0;
        if (state.decision.code === 'CONFIRMED') firstWritesSinceReset += 1;
        expect(state.bookingCount, `seed ${seed}, action ${index}`).toBeLessThanOrEqual(1);
        expect(state.bookingCount).toBeGreaterThanOrEqual(0);
        expect(state.bookingCount).toBe(firstWritesSinceReset);
        expect(state.events.filter((event) => event.code === 'CONFIRMED').length).toBeLessThanOrEqual(1);
        expect(state.sequence).toBe(previous.sequence + 1);
        if (command.type !== 'reset') expect(state.now).toBeGreaterThanOrEqual(previous.now);
        if (state.receipt) expect(state.permission.remainingUses).toBe(0);
        expect(state.events.length).toBeLessThanOrEqual(64);
      }
    }
  });
});
