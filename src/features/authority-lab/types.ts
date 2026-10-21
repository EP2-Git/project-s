/** Local synthetic UI model only. Never use these values as booking authority. */
export type LabScenario = 'within_scope' | 'outside_window' | 'other_host' | 'wrong_caller';

export interface LabLimits {
  /** Absolute minutes from the fixed demo clock; the window starts at minute 60. */
  windowEndMinute: number;
  maxDurationMinutes: number;
  lifetimeMinutes: number;
}

export interface LabCaller {
  actorId: string;
  credentialId: string;
  audience: string;
  epoch: number;
}

export interface LabIntent {
  hostId: string;
  meetingTypeId: string;
  startMinute: number;
  /** Derived by the model from its fixed meeting-type fixture, never a caller override. */
  durationMinutes: number;
}

export interface LabPermission {
  status: 'active' | 'replaced' | 'revoked';
  limits: LabLimits;
  expiresAt: number;
  remainingUses: 0 | 1;
  revision: number;
}

export interface LabPreparation {
  id: string;
  intent: LabIntent;
  expiresAt: number;
  source: 'mandate' | 'step_up';
  approvalId?: string;
  caller: LabCaller;
  policyRevision: number;
}

export interface LabApproval {
  id: string;
  intent: LabIntent;
  expiresAt: number;
  status: 'pending' | 'approved' | 'revoked';
  policyRevision: number;
  preparationId?: string;
  differences: readonly string[];
}

export interface LabReceipt {
  id: string;
  bookingId: string;
  preparationId: string;
  idempotencyKey: string;
  intent: LabIntent;
  caller: LabCaller;
  expiresAt: number;
  status: 'confirmed' | 'cancelled';
}

export type LabReasonCode =
  | 'READY' | 'LIMITS_UPDATED' | 'PREPARED' | 'CONFIRMED' | 'REPLAYED'
  | 'STEP_UP_REQUIRED' | 'APPROVAL_RECORDED' | 'PERMISSION_REVOKED'
  | 'CREDENTIAL_REVOKED' | 'CLOCK_ADVANCED' | 'SLOT_CHANGED' | 'BOOKING_CANCELLED'
  | 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'MANDATE_EXPIRED'
  | 'PREPARATION_REQUIRED' | 'PREPARATION_EXPIRED' | 'APPROVAL_REQUIRED'
  | 'APPROVAL_EXPIRED' | 'EVIDENCE_USED' | 'IDEMPOTENCY_CONFLICT'
  | 'SLOT_UNAVAILABLE' | 'RECEIPT_UNAVAILABLE' | 'INVALID_REQUEST' | 'RESET_REQUIRED';

export interface LabDecision {
  kind: 'idle' | 'prepared' | 'approval_required' | 'confirmed' | 'replayed' | 'refused' | 'updated';
  code: LabReasonCode;
  message: string;
}

export interface LabEvent {
  id: number;
  code: LabReasonCode;
  atMinute: number;
  actor: 'person' | 'agent' | 'system';
  outcome: 'info' | 'allowed' | 'blocked' | 'needs_approval';
  title: string;
  detail: string;
}

export interface LabState {
  /** Monotonic integer minutes from 2026-11-02 13:00 UTC; no wall-clock access. */
  now: number;
  permission: LabPermission;
  credential: { id: string; actorId: string; status: 'active' | 'revoked'; expiresAt: number };
  audience: string;
  epoch: number;
  preparation: LabPreparation | null;
  approval: LabApproval | null;
  receipt: LabReceipt | null;
  slotAvailable: boolean;
  bookingCount: number;
  sequence: number;
  events: readonly LabEvent[];
  decision: LabDecision;
}

export type LabCommand =
  | { type: 'configure'; limits: LabLimits }
  | { type: 'prepare'; scenario: LabScenario; caller?: Partial<LabCaller> }
  | { type: 'commit'; preparationId?: string; idempotencyKey?: string; caller?: Partial<LabCaller> }
  | { type: 'approve'; approvalId?: string }
  | { type: 'revoke_permission' }
  | { type: 'revoke_credential' }
  | { type: 'advance_clock'; minutes: number }
  | { type: 'retry'; caller?: Partial<LabCaller> }
  | { type: 'cancel_booking' }
  | { type: 'toggle_slot' }
  | { type: 'reset' };
