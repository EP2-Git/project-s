/**
 * Deterministic, synthetic UI teaching model. No real identity, credential,
 * reservation or booking exists here. NEVER reuse this as production
 * authorization: real authority requires verified identities and SQL proofs.
 */
import type {
  LabCaller,
  LabCommand,
  LabDecision,
  LabEvent,
  LabIntent,
  LabLimits,
  LabReasonCode,
  LabScenario,
  LabState,
} from './types';

const BASE_TIME = Date.UTC(2026, 10, 2, 13);
const MAX_CLOCK_MINUTE = 525_600;
const HISTORY_LIMIT = 64;
const ORIGINAL_HOST = 'demo-host';
const MEETING_TYPE = 'intro-30';
const FIXTURE_DURATION = 30;
const DEFAULT_CALLER: LabCaller = {
  actorId: 'guest-agent',
  credentialId: 'synthetic-key-1',
  audience: 'authority-lab:synthetic',
  epoch: 1,
};
const SCENARIOS: readonly LabScenario[] = [
  'within_scope', 'outside_window', 'other_host', 'wrong_caller',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const integerIn = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

const reference = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

const sameCaller = (left: LabCaller, right: LabCaller) =>
  left.actorId === right.actorId && left.credentialId === right.credentialId &&
  left.audience === right.audience && left.epoch === right.epoch;

const sameIntent = (left: LabIntent, right: LabIntent) =>
  left.hostId === right.hostId && left.meetingTypeId === right.meetingTypeId &&
  left.startMinute === right.startMinute && left.durationMinutes === right.durationMinutes;

const validIntent = (intent: LabIntent) =>
  isRecord(intent) && hasOnly(intent, ['hostId', 'meetingTypeId', 'startMinute', 'durationMinutes']) &&
  [ORIGINAL_HOST, 'another-host'].includes(intent.hostId) && intent.meetingTypeId === MEETING_TYPE &&
  integerIn(intent.startMinute, 0, MAX_CLOCK_MINUTE - FIXTURE_DURATION) &&
  intent.durationMinutes === FIXTURE_DURATION;

const record = (
  state: LabState,
  code: LabReasonCode,
  kind: LabDecision['kind'],
  title: string,
  detail: string,
  actor: LabEvent['actor'] = 'agent',
): LabState => {
  const sequence = state.sequence + 1;
  const event: LabEvent = {
    id: sequence,
    atMinute: state.now,
    actor,
    code,
    outcome: kind === 'refused' ? 'blocked' : kind === 'approval_required' ? 'needs_approval'
      : kind === 'confirmed' || kind === 'prepared' ? 'allowed' : 'info',
    title,
    detail,
  };
  return {
    ...state,
    sequence,
    events: [...state.events, event].slice(-HISTORY_LIMIT),
    decision: { code, kind, message: detail },
  };
};

const refuse = (state: LabState, code: LabReasonCode, message: string) =>
  record(state, code, 'refused', 'Request refused', message);

const invalid = (state: LabState) =>
  refuse(state, 'INVALID_REQUEST', 'The simulation could not understand this request. No booking was created.');

const resolveCaller = (value: unknown): LabCaller | null => {
  if (value === undefined) return { ...DEFAULT_CALLER };
  if (!isRecord(value) || !hasOnly(value, ['actorId', 'credentialId', 'audience', 'epoch'])) return null;
  for (const field of ['actorId', 'credentialId', 'audience'] as const) {
    if (field in value && !reference(value[field])) return null;
  }
  if ('epoch' in value && !integerIn(value.epoch, 1, Number.MAX_SAFE_INTEGER)) return null;
  return { ...DEFAULT_CALLER, ...value };
};

const authenticated = (state: LabState, caller: LabCaller) =>
  state.credential.status === 'active' && state.now < state.credential.expiresAt &&
  caller.actorId === state.credential.actorId && caller.credentialId === state.credential.id &&
  caller.audience === state.audience && caller.epoch === state.epoch;

const authFailure = (state: LabState) => refuse(
  state, 'AUTHENTICATION_REQUIRED',
  'This simulated agent no longer has an active credential for this instance. It cannot book or read a receipt.',
);

const permissionFailure = (state: LabState): LabState | null => {
  if (state.permission.status !== 'active') {
    return refuse(state, 'FORBIDDEN', 'The original permission is revoked or has been replaced by an exact approval.');
  }
  if (state.now >= state.permission.expiresAt) {
    return refuse(state, 'MANDATE_EXPIRED', 'The booking permission has expired. A person must issue fresh permission.');
  }
  if (state.permission.remainingUses === 0 || state.bookingCount >= 1 || state.receipt) {
    return refuse(state, 'EVIDENCE_USED', 'This permission has already funded its one booking. It cannot fund another.');
  }
  return null;
};

const scopeDifferences = (state: LabState, intent: LabIntent): string[] => {
  const differences: string[] = [];
  if (intent.hostId !== ORIGINAL_HOST) differences.push('host');
  if (intent.meetingTypeId !== MEETING_TYPE) differences.push('meeting type');
  if (intent.startMinute < 60 || intent.startMinute + intent.durationMinutes > state.permission.limits.windowEndMinute) {
    differences.push('meeting window');
  }
  if (intent.durationMinutes > state.permission.limits.maxDurationMinutes) differences.push('duration');
  return differences;
};

const scenarioIntent = (scenario: LabScenario): LabIntent => ({
  hostId: scenario === 'other_host' ? 'another-host' : ORIGINAL_HOST,
  meetingTypeId: MEETING_TYPE,
  startMinute: scenario === 'outside_window' ? 120 : 60,
  durationMinutes: FIXTURE_DURATION,
});

export const createLabState = (): LabState => record({
  now: 0,
  permission: {
    status: 'active',
    limits: { windowEndMinute: 90, maxDurationMinutes: 30, lifetimeMinutes: 20 },
    expiresAt: 20,
    remainingUses: 1,
    revision: 1,
  },
  credential: { id: DEFAULT_CALLER.credentialId, actorId: DEFAULT_CALLER.actorId, status: 'active', expiresAt: 10_080 },
  audience: DEFAULT_CALLER.audience,
  epoch: DEFAULT_CALLER.epoch,
  preparation: null,
  approval: null,
  receipt: null,
  slotAvailable: true,
  bookingCount: 0,
  sequence: 0,
  events: [],
  decision: { kind: 'idle', code: 'READY', message: '' },
}, 'READY', 'idle', 'Synthetic permission ready',
'One fictional agent may book one 30-minute meeting within the displayed limits. This simulation creates no real booking.', 'system');

/** A fixed synthetic UTC clock; never reads wall-clock time or the local zone. */
export const labTime = (minute: number): string => {
  if (!integerIn(minute, 0, MAX_CLOCK_MINUTE)) return 'Invalid simulation time';
  const instant = new Date(BASE_TIME + minute * 60_000);
  const clock = `${String(instant.getUTCHours()).padStart(2, '0')}:${String(instant.getUTCMinutes()).padStart(2, '0')} UTC`;
  if (instant.getUTCDate() === 2 && instant.getUTCMonth() === 10 && instant.getUTCFullYear() === 2026) return clock;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][instant.getUTCMonth()]} ${instant.getUTCDate()}, ${instant.getUTCFullYear()} ${clock}`;
};

const configure = (state: LabState, limits: LabLimits): LabState => {
  if (!isRecord(limits) || !hasOnly(limits, ['windowEndMinute', 'maxDurationMinutes', 'lifetimeMinutes']) ||
    !integerIn(limits.windowEndMinute, 61, 1_500) || !integerIn(limits.maxDurationMinutes, 5, 1_440) ||
    !integerIn(limits.lifetimeMinutes, 1, 1_440)) return invalid(state);
  if (state.preparation || state.approval || state.receipt || state.permission.status !== 'active' ||
    state.permission.remainingUses !== 1 || state.credential.status !== 'active') {
    return refuse(state, 'RESET_REQUIRED', 'Reset the simulation before changing a permission that has already been used for a request or revoked.');
  }
  if (state.now >= state.credential.expiresAt) return authFailure(state);
  return record({
    ...state,
    permission: {
      ...state.permission,
      limits: { ...limits },
      expiresAt: Math.min(state.now + limits.lifetimeMinutes, state.credential.expiresAt),
      revision: state.permission.revision + 1,
    },
  }, 'LIMITS_UPDATED', 'updated', 'Synthetic limits updated',
  'These limits apply to the next fictional request. Nothing has been reserved.', 'person');
};

const prepare = (state: LabState, command: Extract<LabCommand, { type: 'prepare' }>): LabState => {
  if (!SCENARIOS.includes(command.scenario)) return invalid(state);
  const caller = resolveCaller(command.caller);
  if (!caller) return invalid(state);
  if (command.scenario === 'wrong_caller') caller.actorId = 'another-agent';
  if (!authenticated(state, caller)) return authFailure(state);
  const permissionRefusal = permissionFailure(state);
  if (permissionRefusal) return permissionRefusal;
  const intent = scenarioIntent(command.scenario);
  if (intent.startMinute <= state.now) return refuse(state, 'SLOT_UNAVAILABLE', 'This fictional meeting has already started. A fresh permission cannot make a past slot bookable.');
  if (!state.slotAvailable) return refuse(state, 'SLOT_UNAVAILABLE', 'The fictional host has made this slot unavailable. No permission was spent.');
  const differences = scopeDifferences(state, intent);
  if (differences.length) {
    const prior = state.approval;
    const approval = prior?.status === 'pending' && prior.policyRevision === state.permission.revision &&
      state.now < prior.expiresAt && sameIntent(prior.intent, intent)
      ? prior : {
        id: `review-${state.sequence + 1}`,
        intent: { ...intent },
        expiresAt: Math.min(state.now + 5, state.permission.expiresAt, state.credential.expiresAt),
        status: 'pending' as const,
        policyRevision: state.permission.revision,
        differences,
      };
    return record({ ...state, preparation: null, approval }, 'STEP_UP_REQUIRED', 'approval_required',
      'A person must approve this exact request',
      `The request is outside the approved ${differences.join(' and ')}. The agent cannot book it on its own.`);
  }
  const preparation = {
    id: `preparation-${state.sequence + 1}`,
    intent,
    expiresAt: Math.min(state.now + 10, state.permission.expiresAt, state.credential.expiresAt),
    source: 'mandate' as const,
    caller,
    policyRevision: state.permission.revision,
  };
  return record({ ...state, preparation, approval: null }, 'PREPARED', 'prepared', 'Request prepared within permission',
    'The full derived 30-minute meeting fits the limits. Preparation reserves nothing; commit will check again.');
};

const approve = (state: LabState, approvalId: string | undefined): LabState => {
  if (!authenticated(state, DEFAULT_CALLER)) return authFailure(state);
  const approval = state.approval;
  if (!approval || (approvalId !== undefined && approvalId !== approval.id)) {
    return refuse(state, 'APPROVAL_REQUIRED', 'There is no matching exact request awaiting approval.');
  }
  if (approval.status === 'approved' && state.preparation?.id === approval.preparationId) {
    return record(state, 'APPROVAL_RECORDED', 'updated', 'Exact approval already recorded',
      'This is the same approval and preparation, not a second booking allowance.', 'person');
  }
  const permissionRefusal = permissionFailure(state);
  if (permissionRefusal) return permissionRefusal;
  if (approval.status !== 'pending' || approval.policyRevision !== state.permission.revision || !validIntent(approval.intent)) {
    return refuse(state, 'FORBIDDEN', 'The approval is revoked or stale. It cannot authorize this request.');
  }
  if (approval.intent.startMinute <= state.now) return refuse(state, 'SLOT_UNAVAILABLE', 'The fictional meeting has already started. Approving it cannot make a past slot bookable.');
  if (state.now >= approval.expiresAt) {
    return refuse(state, 'APPROVAL_EXPIRED', 'The exact review expired. Request a new review while the original permission is still usable.');
  }
  if (!state.slotAvailable) return refuse(state, 'SLOT_UNAVAILABLE', 'This fictional slot is no longer available. Approval did not reserve it.');
  const revision = state.permission.revision + 1;
  const preparationId = `preparation-${state.sequence + 1}`;
  const expiresAt = Math.min(state.now + 5, state.permission.expiresAt, state.credential.expiresAt);
  return record({
    ...state,
    permission: { ...state.permission, status: 'replaced', revision },
    approval: { ...approval, status: 'approved', policyRevision: revision, preparationId, expiresAt },
    preparation: {
      id: preparationId,
      intent: { ...approval.intent },
      source: 'step_up',
      approvalId: approval.id,
      expiresAt,
      caller: { ...DEFAULT_CALLER },
      policyRevision: revision,
    },
  }, 'APPROVAL_RECORDED', 'prepared', 'One exact approval replaces the original permission',
  'The old permission cannot also book. This new one-use request expires in at most five minutes and still holds no slot.', 'person');
};

const commit = (state: LabState, command: Extract<LabCommand, { type: 'commit' }>): LabState => {
  const caller = resolveCaller(command.caller);
  if (!caller) return invalid(state);
  if (!authenticated(state, caller)) return authFailure(state);
  const preparationId = command.preparationId ?? state.preparation?.id ?? state.receipt?.preparationId;
  if (!preparationId) return refuse(state, 'PREPARATION_REQUIRED', 'Prepare a fictional request before asking the agent to commit.');
  const idempotencyKey = command.idempotencyKey ?? `lab-key-${preparationId}`;
  const receipt = state.receipt;

  // An eligible committed retry is a read, even after mandate expiry/revoke/use.
  // Current credential binding is checked above; it is never bypassed by replay.
  if (receipt?.idempotencyKey === idempotencyKey) {
    if (receipt.preparationId !== preparationId ||
      (state.preparation?.id === preparationId && !sameIntent(state.preparation.intent, receipt.intent))) {
      return refuse(state, 'IDEMPOTENCY_CONFLICT', 'That request key already refers to a different preparation or meeting. No new booking was created.');
    }
    if (!sameCaller(receipt.caller, caller)) return refuse(state, 'FORBIDDEN', 'Only the original simulated caller can read this receipt.');
    if (receipt.status === 'cancelled') return refuse(state, 'SLOT_UNAVAILABLE', 'The fictional host cancelled this booking. Retrying cannot recreate it.');
    if (state.now >= receipt.expiresAt) return refuse(state, 'RECEIPT_UNAVAILABLE', 'The receipt access period ended. Retrying must not create another booking.');
    return record(state, 'REPLAYED', 'replayed', 'Same booking returned',
      'The original confirmed receipt was returned. No second booking or permission use was recorded.');
  }
  if (receipt || state.bookingCount >= 1 || state.permission.remainingUses === 0) {
    return refuse(state, 'EVIDENCE_USED', 'The one booking allowance is spent. A different request key cannot spend it again.');
  }
  const preparation = state.preparation;
  if (!preparation || preparation.id !== preparationId) return refuse(state, 'PREPARATION_REQUIRED', 'The referenced preparation is not the current fictional request.');
  if (!sameCaller(preparation.caller, caller) || !validIntent(preparation.intent) ||
    preparation.policyRevision !== state.permission.revision) {
    return refuse(state, 'FORBIDDEN', 'The prepared request no longer matches this caller or permission revision.');
  }
  if (state.permission.status === 'revoked') return refuse(state, 'FORBIDDEN', 'Permission was revoked before this first write. No booking was created.');
  if (state.now >= state.permission.expiresAt) return refuse(state, 'MANDATE_EXPIRED', 'Permission expired before this first write. No booking was created.');
  if (preparation.intent.startMinute <= state.now) return refuse(state, 'SLOT_UNAVAILABLE', 'The fictional meeting has already started. The final availability check refuses a new booking.');
  if (preparation.source === 'step_up') {
    const approval = state.approval;
    if (state.permission.status !== 'replaced' || approval?.status !== 'approved' ||
      approval.id !== preparation.approvalId || approval.preparationId !== preparation.id ||
      approval.policyRevision !== state.permission.revision || !sameIntent(approval.intent, preparation.intent)) {
      return refuse(state, 'FORBIDDEN', 'The exact approval is revoked, stale or belongs to a different request.');
    }
    if (state.now >= approval.expiresAt) return refuse(state, 'APPROVAL_EXPIRED', 'The five-minute exact approval expired. The old permission does not become active again.');
  } else if (state.permission.status !== 'active' || scopeDifferences(state, preparation.intent).length) {
    return refuse(state, 'FORBIDDEN', 'The current prepared meeting is outside its original permission.');
  }
  if (state.now >= preparation.expiresAt) return refuse(state, 'PREPARATION_EXPIRED', 'Preparation expired before commit. Prepare again while permission remains usable.');
  if (!state.slotAvailable) return refuse(state, 'SLOT_UNAVAILABLE', 'Availability changed after preparation. No booking or permission use was recorded; the same request can be retried.');
  return record({
    ...state,
    permission: { ...state.permission, remainingUses: 0 },
    bookingCount: 1,
    receipt: {
      id: `receipt-${state.sequence + 1}`,
      bookingId: `fictional-booking-${state.sequence + 1}`,
      preparationId,
      idempotencyKey,
      intent: { ...preparation.intent },
      caller: { ...caller },
      // Receipt access bypasses mandate expiry, but never credential expiry.
      expiresAt: Math.min(state.now + 1_440, state.credential.expiresAt),
      status: 'confirmed',
    },
  }, 'CONFIRMED', 'confirmed', 'One fictional booking confirmed',
  'The model rechecked caller, permission, time and availability together, then consumed its one use. No real booking was created.');
};

/** Commands are runtime-checked even though the UI normally supplies typed ones. */
export const transitionLab = (state: LabState, command: LabCommand): LabState => {
  if (!isRecord(command) || !reference(command.type)) return invalid(state);
  switch (command.type) {
    case 'configure':
      return hasOnly(command, ['type', 'limits']) ? configure(state, command.limits) : invalid(state);
    case 'prepare':
      return hasOnly(command, ['type', 'scenario', 'caller']) ? prepare(state, command) : invalid(state);
    case 'commit':
      if (!hasOnly(command, ['type', 'preparationId', 'idempotencyKey', 'caller']) ||
        (command.preparationId !== undefined && !reference(command.preparationId)) ||
        (command.idempotencyKey !== undefined && !reference(command.idempotencyKey))) return invalid(state);
      return commit(state, command);
    case 'approve':
      if (!hasOnly(command, ['type', 'approvalId']) || (command.approvalId !== undefined && !reference(command.approvalId))) return invalid(state);
      return approve(state, command.approvalId);
    case 'advance_clock':
      if (!hasOnly(command, ['type', 'minutes']) || !integerIn(command.minutes, 1, MAX_CLOCK_MINUTE - state.now)) return invalid(state);
      return record({ ...state, now: state.now + command.minutes }, 'CLOCK_ADVANCED', 'updated', 'Synthetic clock advanced',
        'Only simulation time changed. Expired permission cannot be revived by moving this clock backwards.', 'system');
    case 'retry':
      if (!hasOnly(command, ['type', 'caller'])) return invalid(state);
      if (!state.receipt) {
        const caller = resolveCaller(command.caller);
        if (!caller) return invalid(state);
        if (!authenticated(state, caller)) return authFailure(state);
        return refuse(state, 'PREPARATION_REQUIRED', 'There is no committed fictional receipt to replay.');
      }
      return commit(state, { type: 'commit', preparationId: state.receipt.preparationId,
        idempotencyKey: state.receipt.idempotencyKey, caller: command.caller });
    case 'revoke_permission':
      if (!hasOnly(command, ['type'])) return invalid(state);
      return record({
        ...state,
        permission: { ...state.permission, status: 'revoked', revision: state.permission.revision + 1 },
        approval: state.approval ? { ...state.approval, status: 'revoked' } : null,
      }, 'PERMISSION_REVOKED', 'updated', 'Original permission and unused replacement revoked',
      'New bookings are blocked, including a linked exact approval. An eligible already-committed receipt remains readable with its original active credential.', 'person');
    case 'revoke_credential':
      if (!hasOnly(command, ['type'])) return invalid(state);
      return record({ ...state, credential: { ...state.credential, status: 'revoked' } }, 'CREDENTIAL_REVOKED', 'updated',
        'Synthetic agent credential revoked', 'The agent can no longer book or read its receipt, even if permission or receipt data remains.', 'person');
    case 'cancel_booking':
      if (!hasOnly(command, ['type'])) return invalid(state);
      if (!state.receipt) return refuse(state, 'RECEIPT_UNAVAILABLE', 'There is no fictional booking for the simulated host to cancel.');
      return record({ ...state, receipt: { ...state.receipt, status: 'cancelled' } }, 'BOOKING_CANCELLED', 'updated',
        'Host cancellation simulated', 'The fictional host cancelled this booking. Its spent permission is not restored.', 'person');
    case 'toggle_slot':
      if (!hasOnly(command, ['type'])) return invalid(state);
      return record({ ...state, slotAvailable: !state.slotAvailable }, 'SLOT_CHANGED', 'updated', 'Host availability change simulated',
        state.slotAvailable ? 'The fictional slot is now unavailable. A prepared request still has no hold.' : 'The fictional slot is available again. Commit must still satisfy every permission check.', 'system');
    case 'reset': {
      if (!hasOnly(command, ['type'])) return invalid(state);
      const fresh = createLabState();
      return record({ ...fresh, sequence: state.sequence, events: [] }, 'READY', 'idle', 'Synthetic scenario reset',
        'A fresh fictional permission replaces this simulation. No real booking, account or credential was changed.', 'person');
    }
    default:
      return invalid(state);
  }
};
