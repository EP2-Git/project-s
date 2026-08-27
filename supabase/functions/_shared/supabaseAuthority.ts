import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ProjectSApplicationError,
  type ApplicationAuditEvent,
  type AbuseCheck,
  type AbuseGuard,
  type AuditSink,
  type BookingConfirmationAuthority,
  type ConfirmationResult,
  type PreparationPreview,
  type SchedulingAuthority,
} from '@project-s/application';
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
  ProjectSProblemCode,
} from '@project-s/contracts';

interface RpcFailure {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

interface RpcResult {
  data: unknown;
  error: RpcFailure | null;
}

type RpcClient = Pick<SupabaseClient, 'rpc'>;

const codeFromRpcFailure = (
  failure: RpcFailure,
): { code: ProjectSProblemCode; status: number; retryAction?: 'retry' | 'choose_alternative' | 'prepare_again' | 'confirm_in_browser' } => {
  const value = [failure.code, failure.message, failure.details, failure.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (value.includes('CONFIRMATION_REQUIRED')) {
    return { code: 'CONFIRMATION_REQUIRED', status: 428, retryAction: 'confirm_in_browser' };
  }
  if (value.includes('PREPARATION_EXPIRED')) {
    return { code: 'PREPARATION_EXPIRED', status: 410, retryAction: 'prepare_again' };
  }
  if (value.includes('PREPARATION_MISMATCH')) {
    return { code: 'PREPARATION_MISMATCH', status: 409, retryAction: 'prepare_again' };
  }
  if (value.includes('PREPARATION_STALE')) {
    return { code: 'PREPARATION_STALE', status: 409, retryAction: 'prepare_again' };
  }
  if (value.includes('PREPARATION_ALREADY_COMMITTED')) {
    return { code: 'PREPARATION_ALREADY_COMMITTED', status: 409 };
  }
  if (value.includes('IDEMPOTENCY_KEY_REUSED')) {
    return { code: 'IDEMPOTENCY_KEY_REUSED', status: 409 };
  }
  if (value.includes('SLOT_UNAVAILABLE') || value.includes('23P01')) {
    return { code: 'SLOT_UNAVAILABLE', status: 409, retryAction: 'choose_alternative' };
  }
  if (value.includes('MEETING_TYPE_UNAVAILABLE')) {
    return { code: 'MEETING_TYPE_UNAVAILABLE', status: 404 };
  }
  if (value.includes('OUTSIDE_BOOKING_WINDOW')) {
    return { code: 'OUTSIDE_BOOKING_WINDOW', status: 409, retryAction: 'choose_alternative' };
  }
  if (value.includes('INVALID_TIME_ZONE')) {
    return { code: 'INVALID_TIME_ZONE', status: 400 };
  }
  if (value.includes('RATE_LIMIT')) {
    return { code: 'RATE_LIMITED', status: 429, retryAction: 'retry' };
  }
  if (failure.code === 'PT404' || value.includes('NOT_FOUND')) {
    return { code: 'NOT_FOUND', status: 404 };
  }
  if (failure.code === 'PT401') {
    return { code: 'AUTHENTICATION_REQUIRED', status: 401 };
  }
  if (failure.code === 'PT403' || value.includes('FORBIDDEN')) {
    return { code: 'FORBIDDEN', status: 403 };
  }
  if (
    failure.code === 'PT400' ||
    failure.code === '22023' ||
    value.includes('VALIDATION_ERROR')
  ) {
    return { code: 'VALIDATION_ERROR', status: 400 };
  }
  return { code: 'INTERNAL_ERROR', status: 500 };
};

const safeDetailFor = (code: ProjectSProblemCode): string => {
  switch (code) {
    case 'CONFIRMATION_REQUIRED':
      return 'Open the confirmation URL and approve this booking before retrying.';
    case 'PREPARATION_EXPIRED':
      return 'This booking preparation expired. Prepare the booking again.';
    case 'PREPARATION_MISMATCH':
      return 'The booking request does not match its preparation.';
    case 'PREPARATION_STALE':
      return 'The host schedule changed. Prepare the booking again.';
    case 'PREPARATION_ALREADY_COMMITTED':
      return 'This preparation has already been used.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'This idempotency key belongs to a different request.';
    case 'SLOT_UNAVAILABLE':
      return 'That time is no longer available.';
    case 'MEETING_TYPE_UNAVAILABLE':
    case 'NOT_FOUND':
      return 'The requested public booking resource is unavailable.';
    case 'OUTSIDE_BOOKING_WINDOW':
      return 'That time is outside the host booking window.';
    case 'INVALID_TIME_ZONE':
      return 'The requested time zone is invalid.';
    case 'RATE_LIMITED':
      return 'Too many requests were made. Wait before trying again.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Authentication is required for this operation.';
    case 'FORBIDDEN':
    case 'INSUFFICIENT_SCOPE':
      return 'The verified caller is not allowed to perform this operation.';
    case 'VALIDATION_ERROR':
      return 'The request does not match the Project S v1 contract.';
    default:
      return 'Project S could not complete the request.';
  }
};

const assertObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectSApplicationError({
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'The scheduling authority returned an invalid response.',
    });
  }
  return value as Record<string, unknown>;
};

export class SupabaseSchedulingAuthority
  implements SchedulingAuthority, BookingConfirmationAuthority
{
  constructor(
    private readonly client: RpcClient,
    private readonly confirmationUrlFor: (preparationToken: string) => string,
  ) {}

  async getBookingPage(
    input: GetBookingPageInput,
    context: ExecutionContext,
  ): Promise<GetBookingPageData> {
    return (await this.call('get_gateway_booking_page_v1', {
      p_request: input,
      p_context: context,
    })) as GetBookingPageData;
  }

  async listFreeSlots(
    input: ListFreeSlotsInput,
    _context: ExecutionContext,
  ): Promise<ListFreeSlotsData> {
    const raw = assertObject(
      await this.call('list_public_free_slots_v1', {
        p_username: input.username,
        p_meeting_type_id: input.meetingTypeId,
        p_date: input.date,
        p_display_time_zone: input.displayTimeZone,
      }),
    );
    return {
      username: input.username,
      meetingTypeId: input.meetingTypeId,
      date: String(raw.date ?? input.date),
      displayTimeZone: String(raw.displayTimeZone ?? input.displayTimeZone),
      generatedAt: String(raw.generatedAt ?? ''),
      slots: Array.isArray(raw.slots)
        ? raw.slots.map((candidate) => {
            const slot = assertObject(candidate);
            return {
              startAt: String(slot.startAt ?? ''),
              endAt: String(slot.endAt ?? ''),
            };
          })
        : [],
    };
  }

  async prepareBooking(
    input: PrepareBookingInput,
    context: ExecutionContext,
  ): Promise<PrepareBookingData> {
    const raw = assertObject(
      await this.call('prepare_public_booking_v1', {
        p_request: input,
        p_context: context,
      }),
    );
    const preparationToken = String(raw.preparationToken ?? '');
    return {
      preparationId: String(raw.preparationId ?? ''),
      preparationToken,
      expiresAt: String(raw.expiresAt ?? ''),
      notHeld: true,
      confirmationUrl: this.confirmationUrlFor(preparationToken),
      summary: raw.summary as PrepareBookingData['summary'],
    };
  }

  async createBooking(
    input: CreateBookingInput,
    context: ExecutionContext,
  ): Promise<CreateBookingData> {
    return (await this.call('commit_prepared_booking_v1', {
      p_request: input,
      p_context: context,
    })) as CreateBookingData;
  }

  async getPreparation(
    input: { preparationToken: string },
    context: ExecutionContext,
  ): Promise<PreparationPreview> {
    return (await this.call('get_public_booking_preparation_v1', {
      p_request: input,
      p_context: context,
    })) as PreparationPreview;
  }

  async confirmPreparation(
    input: { preparationToken: string; challengeToken?: string },
    context: ExecutionContext,
  ): Promise<ConfirmationResult> {
    return (await this.call('confirm_public_booking_preparation_v1', {
      p_request: { preparationToken: input.preparationToken },
      p_context: context,
    })) as ConfirmationResult;
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { data, error } = (await this.client.rpc(
      name as never,
      args as never,
    )) as unknown as RpcResult;
    if (!error) return data;
    const mapped = codeFromRpcFailure(error);
    throw new ProjectSApplicationError({
      ...mapped,
      detail: safeDetailFor(mapped.code),
      cause: error,
    });
  }
}

export class SupabaseAbuseGuard implements AbuseGuard {
  constructor(private readonly client: RpcClient) {}

  async assertAllowed(check: AbuseCheck): Promise<void> {
    const bucketMaterial = JSON.stringify({
      networkKeyHash: check.context.provenance.networkKeyHash ?? 'unavailable',
      resource: check.resource,
    });
    const raw = assertObject(
      await this.callRate({
        operationId: check.operationId,
        bucketMaterial,
      }, check.context),
    );
    if (raw.allowed === true) return;
    throw new ProjectSApplicationError({
      status: 429,
      code: 'RATE_LIMITED',
      detail: safeDetailFor('RATE_LIMITED'),
      retryAction: 'retry',
      afterSeconds:
        typeof raw.retryAfterSeconds === 'number'
          ? raw.retryAfterSeconds
          : undefined,
    });
  }

  private async callRate(
    request: { operationId: string; bucketMaterial: string },
    context: ExecutionContext,
  ): Promise<unknown> {
    const { data, error } = (await this.client.rpc(
      'consume_public_rate_limit_v1' as never,
      { p_request: request, p_context: context } as never,
    )) as unknown as RpcResult;
    if (!error) return data;
    const mapped = codeFromRpcFailure(error);
    throw new ProjectSApplicationError({
      ...mapped,
      detail: safeDetailFor(mapped.code),
      cause: error,
    });
  }
}

export class SupabaseAuditSink implements AuditSink {
  constructor(private readonly client: RpcClient) {}

  async append(
    event: ApplicationAuditEvent,
    context: ExecutionContext,
  ): Promise<void> {
    const { error } = (await this.client.rpc(
      'append_gateway_audit_event_v1' as never,
      {
        p_request: {
          operationId: event.operationId,
          outcome: event.outcome,
          ...(event.code ? { code: event.code } : {}),
        },
        p_context: context,
      } as never,
    )) as unknown as RpcResult;
    if (!error) return;
    const mapped = codeFromRpcFailure(error);
    throw new ProjectSApplicationError({
      ...mapped,
      detail: safeDetailFor(mapped.code),
      cause: error,
    });
  }
}
