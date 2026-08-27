import {
  ProjectSApiError,
  ProjectSProtocolError,
  ProjectSTransportError,
  createProjectSClient,
  parseProjectSProblem,
} from '@project-s/sdk';
import {
  isoInstantSchema,
  prepareBookingInputSchema,
  preparedBookingSummarySchema,
  preparationTokenSchema,
  projectSProblemCodeSchema,
  uuidSchema,
  type ProjectSProblemCode,
} from '@project-s/contracts';
import { z } from 'zod';
import { env } from '@/config/env';
import {
  PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE,
  PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE,
  messageForPublicBookingProblem,
} from '@/lib/publicBookingErrorMessage';
import type {
  CreatePublicBookingRequest,
  CreatePublicBookingResponse,
  FreeSlotsResponse,
  IanaTimeZone,
  LocalDate,
  PreparePublicBookingRequest,
  PreparePublicBookingResponse,
  PublicBookingPageDto,
} from '@/types/publicBooking';

export class PublicBookingError extends Error {
  constructor(
    public readonly code: ProjectSProblemCode,
    message: string,
    public readonly cause?: unknown,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'PublicBookingError';
  }
}

const asPublicBookingError = (error: unknown): PublicBookingError => {
  if (error instanceof PublicBookingError) return error;
  if (error instanceof ProjectSApiError) {
    return new PublicBookingError(
      error.problem.code,
      messageForPublicBookingProblem(error.problem.code, error.problem.detail),
      error,
      error.problem.retry?.afterSeconds,
    );
  }
  if (error instanceof ProjectSTransportError) {
    return new PublicBookingError(
      'INTERNAL_ERROR',
      PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE,
      error,
    );
  }
  if (error instanceof ProjectSProtocolError || error instanceof z.ZodError) {
    return new PublicBookingError(
      'INTERNAL_ERROR',
      PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE,
      error,
    );
  }
  return new PublicBookingError(
    'INTERNAL_ERROR',
    messageForPublicBookingProblem('INTERNAL_ERROR'),
    error,
  );
};

const baseHeaders = Object.freeze({
  apikey: env.supabasePublishableKey,
  authorization: `Bearer ${env.supabasePublishableKey}`,
  'x-project-s-client': 'project-s-web',
  'x-project-s-client-version': '0.1.0-prealpha',
  'x-project-s-source': 'project_s_ui',
});

const client = createProjectSClient({
  baseUrl: env.projectSApiUrl,
  credentials: 'omit',
  headers: baseHeaders,
});

const preparationPreviewSchema = z
  .object({
    preparationId: uuidSchema,
    expiresAt: isoInstantSchema,
    notHeld: z.literal(true),
    summary: preparedBookingSummarySchema,
  })
  .strict();

const confirmationResultSchema = z
  .object({
    preparationId: uuidSchema,
    grantId: uuidSchema,
    confirmedAt: isoInstantSchema,
    method: z.enum(['human_browser', 'verified_challenge']),
  })
  .strict();

const supportEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
  z
    .object({
      contractVersion: z.literal(1),
      requestId: z.string().min(8).max(128),
      data,
    })
    .strict();

export type PreparationPreview = z.infer<typeof preparationPreviewSchema>;
export type ConfirmationResult = z.infer<typeof confirmationResultSchema>;

const supportRequest = async <T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(`${env.projectSApiUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        ...baseHeaders,
        accept: 'application/vnd.project-s.v1+json, application/problem+json',
        'content-type': 'application/vnd.project-s.v1+json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw asPublicBookingError(error);
  }

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const problem = parseProjectSProblem(payload);
    throw asPublicBookingError(
      problem ? new ProjectSApiError(problem, response.status) : payload,
    );
  }
  const parsed = supportEnvelopeSchema(schema).safeParse(payload);
  if (!parsed.success) throw asPublicBookingError(parsed.error);
  return parsed.data.data as T;
};

const withPublicErrors = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw asPublicBookingError(error);
  }
};

export const publicBookingService = {
  getPage(username: string): Promise<PublicBookingPageDto> {
    return withPublicErrors(async () =>
      (await client.public.getBookingPage({ username })).data,
    );
  },

  listFreeSlots(input: {
    username: string;
    meetingTypeId: string;
    date: LocalDate;
    displayTimeZone: IanaTimeZone;
  }): Promise<FreeSlotsResponse> {
    return withPublicErrors(async () =>
      (await client.public.listFreeSlots(input)).data,
    );
  },

  prepare(
    input: PreparePublicBookingRequest,
  ): Promise<PreparePublicBookingResponse> {
    const request = prepareBookingInputSchema.parse(input);
    return withPublicErrors(async () =>
      (await client.public.prepareBooking(request)).data,
    );
  },

  create(input: CreatePublicBookingRequest): Promise<CreatePublicBookingResponse> {
    return withPublicErrors(async () =>
      (await client.public.createBooking(input)).data,
    );
  },

  getPreparation(preparationToken: string): Promise<PreparationPreview> {
    return supportRequest(
      '/api/v1/public/booking-preparations/preview',
      { preparationToken: preparationTokenSchema.parse(preparationToken) },
      preparationPreviewSchema,
    );
  },

  confirmPreparation(input: {
    preparationToken: string;
    challengeToken?: string;
  }): Promise<ConfirmationResult> {
    return supportRequest(
      '/api/v1/public/booking-preparations/confirm',
      {
        preparationToken: preparationTokenSchema.parse(input.preparationToken),
        ...(input.challengeToken ? { challengeToken: input.challengeToken } : {}),
      },
      confirmationResultSchema,
    );
  },
};

export const isPublicBookingErrorCode = (
  value: unknown,
): value is ProjectSProblemCode => projectSProblemCodeSchema.safeParse(value).success;
