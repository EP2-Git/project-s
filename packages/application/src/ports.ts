import type {
  CreateBookingData,
  CreateBookingInput,
  ExecutionContext,
  GetBookingPageData,
  GetBookingPageInput,
  ListFreeSlotsData,
  ListFreeSlotsInput,
  PrepareBookingData,
  PrepareBookingInput,
  ProjectSOperationId,
  ProjectSProblemCode,
} from '@project-s/contracts';

export interface SchedulingAuthority {
  getBookingPage(
    input: GetBookingPageInput,
    context: ExecutionContext,
  ): Promise<GetBookingPageData>;
  listFreeSlots(
    input: ListFreeSlotsInput,
    context: ExecutionContext,
  ): Promise<ListFreeSlotsData>;
  prepareBooking(
    input: PrepareBookingInput,
    context: ExecutionContext,
  ): Promise<PrepareBookingData>;
  createBooking(
    input: CreateBookingInput,
    context: ExecutionContext,
  ): Promise<CreateBookingData>;
}

export interface PreparationPreview {
  preparationId: string;
  expiresAt: string;
  notHeld: true;
  summary: PrepareBookingData['summary'];
}

export interface ConfirmationResult {
  preparationId: string;
  grantId: string;
  confirmedAt: string;
  method: 'human_browser' | 'verified_challenge';
}

export interface BookingConfirmationAuthority {
  getPreparation(
    input: { preparationToken: string },
    context: ExecutionContext,
  ): Promise<PreparationPreview>;
  confirmPreparation(
    input: { preparationToken: string; challengeToken?: string },
    context: ExecutionContext,
  ): Promise<ConfirmationResult>;
}

export interface AbuseResource {
  username?: string;
  meetingTypeId?: string;
  date?: string;
  supportRoute?: 'preparation_preview' | 'preparation_confirm';
}

export interface AbuseCheck {
  operationId: ProjectSOperationId;
  context: ExecutionContext;
  resource: AbuseResource;
}

export interface AbuseGuard {
  assertAllowed(check: AbuseCheck): Promise<void>;
}

export interface AuthorizationPort {
  assertAuthorized(
    operationId: ProjectSOperationId,
    context: ExecutionContext,
  ): void | Promise<void>;
}

export interface ApplicationAuditEvent {
  requestId: string;
  operationId: ProjectSOperationId;
  actorKind: ExecutionContext['actorKind'];
  transport: ExecutionContext['transport'];
  principalId?: string;
  subjectId?: string;
  delegationId?: string;
  outcome: 'success' | 'rejected' | 'failure';
  code?: ProjectSProblemCode;
  occurredAt: string;
}

export interface AuditSink {
  append(
    event: ApplicationAuditEvent,
    context: ExecutionContext,
  ): Promise<void>;
}

export interface Clock {
  now(): Date;
}
