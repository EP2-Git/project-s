import {
  createBookingDataSchema,
  createBookingInputSchema,
  executionContextSchema,
  getBookingPageDataSchema,
  getBookingPageInputSchema,
  listFreeSlotsDataSchema,
  listFreeSlotsInputSchema,
  prepareBookingDataSchema,
  prepareBookingInputSchema,
  type CreateBookingData,
  type CreateBookingInput,
  type ExecutionContext,
  type GetBookingPageData,
  type GetBookingPageInput,
  type ListFreeSlotsData,
  type ListFreeSlotsInput,
  type PrepareBookingData,
  type PrepareBookingInput,
  type ProjectSOperationId,
  type ProjectSScope,
} from '@project-s/contracts';
import { ProjectSApplicationError } from './errors.js';
import type {
  AbuseGuard,
  AbuseResource,
  AuditSink,
  AuthorizationPort,
  Clock,
  SchedulingAuthority,
} from './ports.js';

interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

interface ExecuteOptions<TInput, TData> {
  operationId: ProjectSOperationId;
  inputSchema: RuntimeSchema<TInput>;
  dataSchema: RuntimeSchema<TData>;
  input: unknown;
  context: unknown;
  resourceFrom(input: TInput): AbuseResource;
  invoke(input: TInput, context: ExecutionContext): Promise<TData>;
}

const requiredScopes: Record<ProjectSOperationId, ProjectSScope> = {
  'project-s.public.get_booking_page.v1': 'booking_page:read',
  'project-s.public.list_free_slots.v1': 'slots:read',
  'project-s.public.prepare_booking.v1': 'bookings:prepare',
  'project-s.public.create_booking.v1': 'bookings:create',
};

const safeValidationFields = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('issues' in error)) return undefined;
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.slice(0, 12).map((issue) => {
    const candidate = issue as { path?: unknown[]; message?: unknown };
    return {
      path: Array.isArray(candidate.path)
        ? `/${candidate.path.join('/')}`
        : '/request',
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : 'Invalid value',
    };
  });
};

export class PublicV1Authorizer implements AuthorizationPort {
  assertAuthorized(
    operationId: ProjectSOperationId,
    context: ExecutionContext,
  ): void {
    const required = requiredScopes[operationId];
    if (!context.scopes.includes(required)) {
      throw new ProjectSApplicationError({
        status: context.actorKind === 'anonymous' ? 401 : 403,
        code:
          context.actorKind === 'anonymous'
            ? 'AUTHENTICATION_REQUIRED'
            : 'INSUFFICIENT_SCOPE',
        detail: 'The verified caller is not allowed to perform this operation.',
      });
    }

    if (
      context.actorKind === 'anonymous' &&
      (context.principalId ||
        context.subjectId ||
        context.onBehalfOf ||
        context.delegationId ||
        context.confirmationGrant)
    ) {
      throw new ProjectSApplicationError({
        status: 403,
        code: 'FORBIDDEN',
        detail: 'Anonymous execution context cannot carry delegated identity.',
      });
    }

    if (
      context.actorKind === 'delegated_agent' &&
      (!context.principalId ||
        !context.subjectId ||
        !context.onBehalfOf ||
        !context.delegationId)
    ) {
      throw new ProjectSApplicationError({
        status: 403,
        code: 'FORBIDDEN',
        detail: 'Delegated execution requires a verified grant and subject.',
      });
    }
  }
}

const noAbuseGuard: AbuseGuard = {
  async assertAllowed() {},
};

const noAuditSink: AuditSink = {
  async append() {},
};

const systemClock: Clock = {
  now: () => new Date(),
};

export interface ProjectSApplicationDependencies {
  authority: SchedulingAuthority;
  authorizer?: AuthorizationPort;
  abuseGuard?: AbuseGuard;
  audit?: AuditSink;
  clock?: Clock;
}

export class ProjectSApplication {
  private readonly authority: SchedulingAuthority;
  private readonly authorizer: AuthorizationPort;
  private readonly abuseGuard: AbuseGuard;
  private readonly audit: AuditSink;
  private readonly clock: Clock;

  constructor(dependencies: ProjectSApplicationDependencies) {
    this.authority = dependencies.authority;
    this.authorizer = dependencies.authorizer ?? new PublicV1Authorizer();
    this.abuseGuard = dependencies.abuseGuard ?? noAbuseGuard;
    this.audit = dependencies.audit ?? noAuditSink;
    this.clock = dependencies.clock ?? systemClock;
  }

  getBookingPage(
    input: unknown,
    context: unknown,
  ): Promise<GetBookingPageData> {
    return this.execute({
      operationId: 'project-s.public.get_booking_page.v1',
      inputSchema: getBookingPageInputSchema,
      dataSchema: getBookingPageDataSchema,
      input,
      context,
      resourceFrom: (value) => ({ username: value.username }),
      invoke: (value, execution) =>
        this.authority.getBookingPage(value, execution),
    });
  }

  listFreeSlots(
    input: unknown,
    context: unknown,
  ): Promise<ListFreeSlotsData> {
    return this.execute({
      operationId: 'project-s.public.list_free_slots.v1',
      inputSchema: listFreeSlotsInputSchema,
      dataSchema: listFreeSlotsDataSchema,
      input,
      context,
      resourceFrom: (value) => ({
        username: value.username,
        meetingTypeId: value.meetingTypeId,
        date: value.date,
      }),
      invoke: (value, execution) =>
        this.authority.listFreeSlots(value, execution),
    });
  }

  prepareBooking(
    input: unknown,
    context: unknown,
  ): Promise<PrepareBookingData> {
    return this.execute({
      operationId: 'project-s.public.prepare_booking.v1',
      inputSchema: prepareBookingInputSchema,
      dataSchema: prepareBookingDataSchema,
      input,
      context,
      resourceFrom: (value) => ({
        username: value.username,
        meetingTypeId: value.meetingTypeId,
      }),
      invoke: (value, execution) =>
        this.authority.prepareBooking(value, execution),
    });
  }

  createBooking(
    input: unknown,
    context: unknown,
  ): Promise<CreateBookingData> {
    return this.execute({
      operationId: 'project-s.public.create_booking.v1',
      inputSchema: createBookingInputSchema,
      dataSchema: createBookingDataSchema,
      input,
      context,
      resourceFrom: () => ({}),
      invoke: (value, execution) =>
        this.authority.createBooking(value, execution),
    });
  }

  private async execute<TInput, TData>(
    options: ExecuteOptions<TInput, TData>,
  ): Promise<TData> {
    let execution: ExecutionContext;
    let parsedInput: TInput;

    try {
      execution = executionContextSchema.parse(options.context);
    } catch (error) {
      throw new ProjectSApplicationError({
        status: 400,
        code: 'VALIDATION_ERROR',
        detail: 'The request does not match the Project S v1 contract.',
        fieldErrors: safeValidationFields(error),
        cause: error,
      });
    }

    try {
      parsedInput = options.inputSchema.parse(options.input);
    } catch (error) {
      const applicationError = new ProjectSApplicationError({
        status: 400,
        code: 'VALIDATION_ERROR',
        detail: 'The request does not match the Project S v1 contract.',
        fieldErrors: safeValidationFields(error),
        cause: error,
      });
      await this.recordAuditBestEffort(
        options.operationId,
        execution,
        'rejected',
        applicationError.code,
      );
      throw applicationError;
    }

    try {
      await this.authorizer.assertAuthorized(options.operationId, execution);
      await this.abuseGuard.assertAllowed({
        operationId: options.operationId,
        context: execution,
        resource: options.resourceFrom(parsedInput),
      });
      const result = options.dataSchema.parse(
        await options.invoke(parsedInput, execution),
      );
      await this.recordAudit(options.operationId, execution, 'success');
      return result;
    } catch (error) {
      const applicationError =
        error instanceof ProjectSApplicationError
          ? error
          : new ProjectSApplicationError({
              status: 500,
              code: 'INTERNAL_ERROR',
              detail: 'Project S could not complete the request.',
              cause: error,
            });
      await this.recordAuditBestEffort(
        options.operationId,
        execution,
        applicationError.status < 500 ? 'rejected' : 'failure',
        applicationError.code,
      );
      throw applicationError;
    }
  }

  private async recordAudit(
    operationId: ProjectSOperationId,
    context: ExecutionContext,
    outcome: 'success' | 'rejected' | 'failure',
    code?: Parameters<AuditSink['append']>[0]['code'],
  ) {
    await this.audit.append(
      {
        requestId: context.requestId,
        operationId,
        actorKind: context.actorKind,
        transport: context.transport,
        principalId: context.principalId,
        subjectId: context.subjectId,
        delegationId: context.delegationId,
        outcome,
        code,
        occurredAt: this.clock.now().toISOString(),
      },
      context,
    );
  }

  private async recordAuditBestEffort(
    operationId: ProjectSOperationId,
    context: ExecutionContext,
    outcome: 'success' | 'rejected' | 'failure',
    code?: Parameters<AuditSink['append']>[0]['code'],
  ) {
    try {
      await this.recordAudit(operationId, context, outcome, code);
    } catch {
      // Rejection/failure audit must never replace the canonical caller error.
    }
  }
}

export type PublicBookingApplication = Pick<
  ProjectSApplication,
  'getBookingPage' | 'listFreeSlots' | 'prepareBooking' | 'createBooking'
>;

export type PublicBookingInputs =
  | GetBookingPageInput
  | ListFreeSlotsInput
  | PrepareBookingInput
  | CreateBookingInput;
