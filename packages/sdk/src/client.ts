import {
  PROJECT_S_CONTRACT_MEDIA_TYPE,
  PROJECT_S_PROBLEM_MEDIA_TYPE,
  createBookingInputSchema,
  createBookingResponseSchema,
  getBookingPageInputSchema,
  getBookingPageResponseSchema,
  listFreeSlotsInputSchema,
  listFreeSlotsResponseSchema,
  prepareBookingInputSchema,
  prepareBookingResponseSchema,
  requestIdSchema,
  projectSProblemEnvelopeSchema,
  projectSProblemSchema,
  type CreateBookingInput,
  type CreateBookingResponse,
  type GetBookingPageInput,
  type GetBookingPageResponse,
  type ListFreeSlotsInput,
  type ListFreeSlotsResponse,
  type PrepareBookingInput,
  type PrepareBookingResponse,
  type ProjectSProblem,
} from '@project-s/contracts';
import type { z } from 'zod';

export type ProjectSFetch = typeof globalThis.fetch;

export type ProjectSClientOptions = Readonly<{
  baseUrl: string;
  fetch?: ProjectSFetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Local fallback correlation only. Project S server request IDs remain server-derived. */
  requestId?: () => string;
  credentials?: RequestCredentials;
}>;

export type ProjectSRequestOptions = Readonly<{
  signal?: AbortSignal;
  headers?: HeadersInit;
}>;

export class ProjectSApiError extends Error {
  readonly name = 'ProjectSApiError';

  constructor(
    public readonly problem: ProjectSProblem,
    public readonly responseStatus: number,
  ) {
    super(problem.detail);
  }
}

export class ProjectSProtocolError extends Error {
  readonly name = 'ProjectSProtocolError';

  constructor(
    message: string,
    public readonly responseStatus: number,
    public readonly requestId: string | null,
    public readonly payload?: unknown,
  ) {
    super(message);
  }
}

export class ProjectSTransportError extends Error {
  readonly name = 'ProjectSTransportError';

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

const normalizeBaseUrl = (baseUrl: string): string => {
  const parsed = new URL(baseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new TypeError(
      'Project S baseUrl must use HTTPS, except for HTTP loopback development.',
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('Project S baseUrl must not contain credentials.');
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

const defaultRequestId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `project_s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const parseJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ProjectSProtocolError(
      'Project S returned a non-JSON response.',
      response.status,
      response.headers.get('x-request-id'),
      cause,
    );
  }
};

export const parseProjectSProblem = (payload: unknown): ProjectSProblem | null => {
  const envelope = projectSProblemEnvelopeSchema.safeParse(payload);
  if (envelope.success) return envelope.data.error;

  // HTTP uses a direct RFC 9457 problem. MCP uses the versioned envelope, so
  // accepting both keeps error normalization transport-neutral.
  const direct = projectSProblemSchema.safeParse(payload);
  return direct.success ? direct.data : null;
};

const resolveHeaders = async (
  configured: ProjectSClientOptions['headers'],
  perRequest: HeadersInit | undefined,
  hasBody: boolean,
): Promise<Headers> => {
  const headers = new Headers(
    typeof configured === 'function' ? await configured() : configured,
  );
  new Headers(perRequest).forEach((value, key) => headers.set(key, value));
  headers.set('accept', `${PROJECT_S_CONTRACT_MEDIA_TYPE}, ${PROJECT_S_PROBLEM_MEDIA_TYPE}`);
  if (hasBody) headers.set('content-type', PROJECT_S_CONTRACT_MEDIA_TYPE);
  return headers;
};

export type ProjectSPublicClient = Readonly<{
  getBookingPage(
    input: GetBookingPageInput,
    options?: ProjectSRequestOptions,
  ): Promise<GetBookingPageResponse>;
  listFreeSlots(
    input: ListFreeSlotsInput,
    options?: ProjectSRequestOptions,
  ): Promise<ListFreeSlotsResponse>;
  prepareBooking(
    input: PrepareBookingInput,
    options?: ProjectSRequestOptions,
  ): Promise<PrepareBookingResponse>;
  createBooking(
    input: CreateBookingInput,
    options?: ProjectSRequestOptions,
  ): Promise<CreateBookingResponse>;
}>;

export class ProjectSClient {
  readonly public: ProjectSPublicClient;

  readonly #baseUrl: string;
  readonly #fetch: ProjectSFetch;
  readonly #options: ProjectSClientOptions;

  constructor(options: ProjectSClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    if (!fetchImplementation) throw new TypeError('A fetch implementation is required.');
    this.#fetch = options.fetch ?? fetchImplementation.bind(globalThis);
    this.#options = options;

    this.public = Object.freeze({
      getBookingPage: async (input, requestOptions) => {
        const parsed = getBookingPageInputSchema.parse(input);
        return this.#request(
          'GET',
          `/api/v1/public/booking-pages/${encodeURIComponent(parsed.username)}`,
          undefined,
          getBookingPageResponseSchema,
          requestOptions,
        );
      },
      listFreeSlots: async (input, requestOptions) =>
        this.#request(
          'POST',
          '/api/v1/public/free-slots/search',
          listFreeSlotsInputSchema.parse(input),
          listFreeSlotsResponseSchema,
          requestOptions,
        ),
      prepareBooking: async (input, requestOptions) =>
        this.#request(
          'POST',
          '/api/v1/public/bookings/prepare',
          prepareBookingInputSchema.parse(input),
          prepareBookingResponseSchema,
          requestOptions,
        ),
      createBooking: async (input, requestOptions) =>
        this.#request(
          'POST',
          '/api/v1/public/bookings',
          createBookingInputSchema.parse(input),
          createBookingResponseSchema,
          requestOptions,
        ),
    });
  }

  async #request<TSchema extends z.ZodTypeAny>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    responseSchema: TSchema,
    requestOptions: ProjectSRequestOptions | undefined,
  ): Promise<z.infer<TSchema>> {
    const requestId = requestIdSchema.parse(
      (this.#options.requestId ?? defaultRequestId)(),
    );
    const headers = await resolveHeaders(
      this.#options.headers,
      requestOptions?.headers,
      body !== undefined,
    );

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        credentials: this.#options.credentials ?? 'same-origin',
        signal: requestOptions?.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      if (cause instanceof ProjectSApiError || cause instanceof ProjectSProtocolError) {
        throw cause;
      }
      throw new ProjectSTransportError('Could not reach the Project S service.', cause);
    }

    const payload = await parseJson(response);
    if (!response.ok) {
      const problem = parseProjectSProblem(payload);
      if (problem) throw new ProjectSApiError(problem, response.status);
      throw new ProjectSProtocolError(
        'Project S returned an invalid problem response.',
        response.status,
        response.headers.get('x-request-id') ?? requestId,
        payload,
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ProjectSProtocolError(
        'Project S returned a response that does not match the public contract.',
        response.status,
        response.headers.get('x-request-id') ?? requestId,
        parsed.error,
      );
    }
    return parsed.data;
  }
}

export const createProjectSClient = (options: ProjectSClientOptions): ProjectSClient =>
  new ProjectSClient(options);
