import { createClient } from '@supabase/supabase-js';
import {
  ProjectSApplication,
  ProjectSApplicationError,
  isProjectSApplicationError,
  type AbuseResource,
  type ConfirmationResult,
  type PreparationPreview,
} from '@project-s/application';
import {
  createBookingResponseSchema,
  executionContextSchema,
  getBookingPageResponseSchema,
  listFreeSlotsResponseSchema,
  prepareBookingResponseSchema,
  PROJECT_S_CONTRACT_MEDIA_TYPE,
  PROJECT_S_PROBLEM_MEDIA_TYPE,
  projectSProblemSchema,
  type ExecutionContext,
  type ProjectSProblem,
  type ProjectSProblemCode,
  type ProjectSOperationId,
  type ProjectSScope,
} from '@project-s/contracts';
import {
  SupabaseAbuseGuard,
  SupabaseAuditSink,
  SupabaseSchedulingAuthority,
} from '../_shared/supabaseAuthority.ts';

const jsonHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

const env = (name: string) => Deno.env.get(name)?.trim();

const requiredEnv = (name: string) => {
  const value = env(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const supabaseUrl = requiredEnv('SUPABASE_URL');
const runtimeEnvironment = env('PROJECT_S_ENVIRONMENT') ?? 'production';
if (!['development', 'production'].includes(runtimeEnvironment)) {
  throw new Error('PROJECT_S_ENVIRONMENT must be development or production');
}
const developmentMode = runtimeEnvironment === 'development';
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const configuredPublicAppUrl = env('PROJECT_S_PUBLIC_APP_URL');
if (!developmentMode && !configuredPublicAppUrl) {
  throw new Error('PROJECT_S_PUBLIC_APP_URL is required outside local development');
}
const publicAppUrl = new URL(
  configuredPublicAppUrl ?? 'http://127.0.0.1:8080',
).origin;
const publicAppHostname = new URL(publicAppUrl).hostname;
const publicAppIsLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(
  publicAppHostname,
);
if (developmentMode && !publicAppIsLoopback) {
  throw new Error('Development confirmation is restricted to a loopback app URL');
}
if (!developmentMode && !publicAppUrl.startsWith('https://')) {
  throw new Error('PROJECT_S_PUBLIC_APP_URL must use HTTPS outside local development');
}
const allowedOrigins = new Set(
  (
    env('PROJECT_S_ALLOWED_ORIGINS') ??
    (developmentMode
      ? 'http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:4173,http://localhost:4173'
      : publicAppUrl)
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin),
);
const trustProxyHeaders = env('PROJECT_S_TRUST_PROXY_HEADERS') === 'true';
if (!developmentMode && !trustProxyHeaders) {
  throw new Error(
    'PROJECT_S_TRUST_PROXY_HEADERS=true is required after verifying the production proxy chain',
  );
}
const hmacSecret =
  env('PROJECT_S_RATE_LIMIT_HMAC_SECRET') ??
  (developmentMode ? 'project-s-local-development-rate-secret' : undefined);
if (!developmentMode && !hmacSecret) {
  throw new Error('PROJECT_S_RATE_LIMIT_HMAC_SECRET is required in production');
}
const challengeProvider =
  env('PROJECT_S_CHALLENGE_PROVIDER') ??
  (developmentMode ? 'development' : undefined);
const turnstileSecret = env('PROJECT_S_TURNSTILE_SECRET_KEY');
const allowedTurnstileHostnames = new Set(
  (env('PROJECT_S_TURNSTILE_HOSTNAMES') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
if (
  !developmentMode &&
  (challengeProvider !== 'turnstile' ||
    !turnstileSecret ||
    allowedTurnstileHostnames.size === 0)
) {
  throw new Error(
    'Production requires Turnstile, PROJECT_S_TURNSTILE_SECRET_KEY, and PROJECT_S_TURNSTILE_HOSTNAMES',
  );
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'x-project-s-authority': 'api-v1' } },
});

const authority = new SupabaseSchedulingAuthority(
  client,
  (token) =>
    `${publicAppUrl}/booking/confirm#preparation=${encodeURIComponent(token)}`,
);
const abuseGuard = new SupabaseAbuseGuard(client);
const auditSink = new SupabaseAuditSink(client);
const application = new ProjectSApplication({
  authority,
  abuseGuard,
  audit: auditSink,
});

const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const hmac = async (value: string) => {
  if (!hmacSecret) {
    throw new ProjectSApplicationError({
      status: 503,
      code: 'INTERNAL_ERROR',
      detail: 'Public booking protection is not configured.',
    });
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hmacSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)),
  );
};

const networkSourceFor = (request: Request) => {
  if (!trustProxyHeaders) return 'unavailable';
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unavailable'
  );
};

const sourceFor = (request: Request): ExecutionContext['provenance']['source'] => {
  const source = request.headers.get('x-project-s-source');
  if (source === 'project_s_ui' || source === 'project_s_mcp') return source;
  return 'project_s_sdk';
};

const contextFor = async (
  request: Request,
  scope: ProjectSScope,
  overrides: Partial<ExecutionContext> = {},
): Promise<ExecutionContext> => {
  const userAgent = request.headers.get('user-agent') ?? 'unavailable';
  const context: ExecutionContext = {
    requestId: crypto.randomUUID(),
    actorKind: 'anonymous',
    transport: 'http',
    clientId:
      request.headers.get('x-project-s-client')?.slice(0, 128) || undefined,
    scopes: [scope],
    provenance: {
      source: sourceFor(request),
      clientVersion:
        request.headers.get('x-project-s-client-version')?.slice(0, 64) ||
        undefined,
      userAgentHash: await hmac(userAgent),
      networkKeyHash: await hmac(networkSourceFor(request)),
    },
    ...overrides,
  };
  return executionContextSchema.parse(context);
};

const corsHeadersFor = (request: Request) => {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  if (!allowedOrigins.has(origin)) {
    throw new ProjectSApplicationError({
      status: 403,
      code: 'FORBIDDEN',
      detail: 'This browser origin is not allowed to call Project S.',
    });
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers':
      'authorization, apikey, content-type, x-client-info, x-project-s-client, x-project-s-client-version, x-project-s-source',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-expose-headers': 'x-request-id, retry-after',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
};

const responseJson = (
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extraHeaders: Record<string, string> = {},
  mediaType = PROJECT_S_CONTRACT_MEDIA_TYPE,
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      'content-type': `${mediaType}; charset=utf-8`,
      ...(body &&
      typeof body === 'object' &&
      'requestId' in body &&
      typeof body.requestId === 'string'
        ? { 'x-request-id': body.requestId }
        : {}),
      ...cors,
      ...extraHeaders,
    },
  });

const parseBody = async (request: Request): Promise<unknown> => {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > 16_384) {
    throw new ProjectSApplicationError({
      status: 413,
      code: 'VALIDATION_ERROR',
      detail: 'The request body is too large.',
    });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) {
    throw new ProjectSApplicationError({
      status: 413,
      code: 'VALIDATION_ERROR',
      detail: 'The request body is too large.',
    });
  }
  try {
    return JSON.parse(text || '{}');
  } catch (cause) {
    throw new ProjectSApplicationError({
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'The request body must be valid JSON.',
      cause,
    });
  }
};

const titleFor = (code: ProjectSProblemCode) =>
  code
    .toLowerCase()
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');

const problemFor = (
  error: unknown,
  requestId: string,
): { problem: ProjectSProblem; status: number; retryAfter?: string } => {
  const applicationError = isProjectSApplicationError(error)
    ? error
    : new ProjectSApplicationError({
        status: 500,
        code: 'INTERNAL_ERROR',
        detail: 'Project S could not complete the request.',
        cause: error,
      });
  const problem = projectSProblemSchema.parse({
    type: `https://project-s.local/problems/${applicationError.code.toLowerCase().replaceAll('_', '-')}`,
    title: titleFor(applicationError.code),
    status: applicationError.status,
    code: applicationError.code,
    detail: applicationError.message,
    requestId,
    ...(applicationError.retryAction
      ? { retry: { action: applicationError.retryAction, afterSeconds: applicationError.afterSeconds } }
      : {}),
    ...(applicationError.fieldErrors
      ? { fieldErrors: applicationError.fieldErrors }
      : {}),
    ...(applicationError.alternatives
      ? { alternatives: applicationError.alternatives }
      : {}),
  });
  return {
    problem,
    status: applicationError.status,
    retryAfter: applicationError.afterSeconds?.toString(),
  };
};

const appendSupportAudit = async (
  operationId: ProjectSOperationId,
  context: ExecutionContext,
  outcome: 'success' | 'rejected' | 'failure',
  code?: ProjectSProblemCode,
) =>
  auditSink.append(
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
      occurredAt: new Date().toISOString(),
    },
    context,
  );

const runSupportOperation = async <T>(
  operationId: ProjectSOperationId,
  context: ExecutionContext,
  resource: AbuseResource,
  invoke: () => Promise<T>,
  auditContextFor: () => ExecutionContext = () => context,
): Promise<T> => {
  try {
    await abuseGuard.assertAllowed({ operationId, context, resource });
    const data = await invoke();
    await appendSupportAudit(operationId, auditContextFor(), 'success');
    return data;
  } catch (error) {
    const applicationError = isProjectSApplicationError(error)
      ? error
      : new ProjectSApplicationError({
          status: 500,
          code: 'INTERNAL_ERROR',
          detail: 'Project S could not complete the request.',
          cause: error,
        });
    await appendSupportAudit(
      operationId,
      auditContextFor(),
      applicationError.status < 500 ? 'rejected' : 'failure',
      applicationError.code,
    ).catch(() => undefined);
    throw applicationError;
  }
};

const exactBody = (
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectSApplicationError({
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'The request does not match the Project S v1 contract.',
    });
  }
  const body = value as Record<string, unknown>;
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !(key in body)) ||
    Object.keys(body).some((key) => !allowedKeys.has(key))
  ) {
    throw new ProjectSApplicationError({
      status: 400,
      code: 'VALIDATION_ERROR',
      detail: 'The request does not match the Project S v1 contract.',
    });
  }
  return body;
};

const pathFor = (request: Request) => {
  const path = new URL(request.url).pathname;
  const marker = '/api-v1';
  const markerIndex = path.indexOf(marker);
  return markerIndex >= 0 ? path.slice(markerIndex + marker.length) || '/' : path;
};

const challengeConfirmation = async (
  request: Request,
  challengeToken: string | undefined,
  expectedPreparationId: string,
): Promise<NonNullable<ExecutionContext['confirmationGrant']>> => {
  const confirmedAt = new Date().toISOString();

  if (challengeProvider === 'development') {
    if (!developmentMode || challengeToken !== 'project-s-local-confirmation') {
      throw new ProjectSApplicationError({
        status: 403,
        code: 'FORBIDDEN',
        detail: 'Human confirmation could not be verified.',
      });
    }
    return {
      grantId: crypto.randomUUID(),
      confirmedAt,
      method: 'human_browser',
      challengeId: `local-${crypto.randomUUID()}`,
    };
  }

  if (
    challengeProvider !== 'turnstile' ||
    !challengeToken ||
    !turnstileSecret ||
    allowedTurnstileHostnames.size === 0
  ) {
    throw new ProjectSApplicationError({
      status: 503,
      code: 'INTERNAL_ERROR',
      detail: 'Human confirmation protection is not configured.',
    });
  }

  const form = new FormData();
  form.set('secret', turnstileSecret);
  form.set('response', challengeToken);
  const remoteIp = trustProxyHeaders ? networkSourceFor(request) : undefined;
  if (remoteIp && remoteIp !== 'unavailable') form.set('remoteip', remoteIp);
  form.set('idempotency_key', crypto.randomUUID());
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form },
  );
  const result = (await response.json()) as {
    success?: boolean;
    action?: string;
    hostname?: string;
    cdata?: string;
  };
  if (
    !response.ok ||
    result.success !== true ||
    result.action !== 'project_s_booking_confirmation' ||
    result.cdata !== expectedPreparationId ||
    !result.hostname ||
    !allowedTurnstileHostnames.has(result.hostname)
  ) {
    throw new ProjectSApplicationError({
      status: 403,
      code: 'FORBIDDEN',
      detail: 'Human confirmation could not be verified.',
    });
  }
  return {
    grantId: crypto.randomUUID(),
    confirmedAt,
    method: 'verified_challenge',
    challengeId: result.cdata,
  };
};

Deno.serve(async (request) => {
  let requestId = crypto.randomUUID();
  let cors: Record<string, string> = {};
  try {
    cors = corsHeadersFor(request);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    const path = pathFor(request);

    if (request.method === 'GET' && path === '/health') {
      return responseJson({ status: 'ok', contractVersion: 1 }, 200, cors);
    }

    const pageMatch = /^\/public\/booking-pages\/([^/]+)$/.exec(path);
    if (request.method === 'GET' && pageMatch) {
      const context = await contextFor(request, 'booking_page:read');
      requestId = context.requestId;
      const data = await application.getBookingPage(
        { username: decodeURIComponent(pageMatch[1]) },
        context,
      );
      const envelope = getBookingPageResponseSchema.parse({
        contractVersion: 1,
        requestId,
        data,
      });
      return responseJson(envelope, 200, cors);
    }

    if (request.method === 'POST' && path === '/public/free-slots/search') {
      const context = await contextFor(request, 'slots:read');
      requestId = context.requestId;
      const data = await application.listFreeSlots(await parseBody(request), context);
      const envelope = listFreeSlotsResponseSchema.parse({
        contractVersion: 1,
        requestId,
        data,
      });
      return responseJson(envelope, 200, cors);
    }

    if (request.method === 'POST' && path === '/public/bookings/prepare') {
      const context = await contextFor(request, 'bookings:prepare');
      requestId = context.requestId;
      const data = await application.prepareBooking(await parseBody(request), context);
      const envelope = prepareBookingResponseSchema.parse({
        contractVersion: 1,
        requestId,
        data,
      });
      return responseJson(envelope, 200, cors);
    }

    if (request.method === 'POST' && path === '/public/bookings') {
      const context = await contextFor(request, 'bookings:create');
      requestId = context.requestId;
      const data = await application.createBooking(await parseBody(request), context);
      const envelope = createBookingResponseSchema.parse({
        contractVersion: 1,
        requestId,
        data,
      });
      return responseJson(envelope, 201, cors);
    }

    if (
      request.method === 'POST' &&
      path === '/public/booking-preparations/preview'
    ) {
      const context = await contextFor(request, 'bookings:prepare');
      requestId = context.requestId;
      const data = await runSupportOperation(
        'project-s.public.prepare_booking.v1',
        context,
        { supportRoute: 'preparation_preview' },
        async (): Promise<PreparationPreview> => {
          const body = exactBody(await parseBody(request), [
            'preparationToken',
          ]);
          if (
            typeof body.preparationToken !== 'string' ||
            body.preparationToken.length === 0
          ) {
            throw new ProjectSApplicationError({
              status: 400,
              code: 'VALIDATION_ERROR',
              detail: 'A preparation token is required.',
            });
          }
          return authority.getPreparation(
            { preparationToken: body.preparationToken },
            context,
          );
        },
      );
      return responseJson({ contractVersion: 1, requestId, data }, 200, cors);
    }

    if (
      request.method === 'POST' &&
      path === '/public/booking-preparations/confirm'
    ) {
      const rateContext = await contextFor(request, 'bookings:create');
      requestId = rateContext.requestId;
      let auditContext = rateContext;
      const data = await runSupportOperation(
        'project-s.public.create_booking.v1',
        rateContext,
        { supportRoute: 'preparation_confirm' },
        async (): Promise<ConfirmationResult> => {
          const body = exactBody(
            await parseBody(request),
            ['preparationToken', 'challengeToken'],
          );
          if (
            typeof body.preparationToken !== 'string' ||
            body.preparationToken.length === 0 ||
            typeof body.challengeToken !== 'string' ||
            body.challengeToken.length === 0
          ) {
            throw new ProjectSApplicationError({
              status: 400,
              code: 'VALIDATION_ERROR',
              detail: 'A valid preparation and challenge token are required.',
            });
          }
          const previewContext = await contextFor(request, 'bookings:prepare', {
            requestId,
          });
          const preview = await authority.getPreparation(
            { preparationToken: body.preparationToken },
            previewContext,
          );
          const confirmationGrant = await challengeConfirmation(
            request,
            body.challengeToken,
            preview.preparationId,
          );
          const context = await contextFor(request, 'bookings:create', {
            requestId,
            actorKind: 'human',
            confirmationGrant,
          });
          auditContext = context;
          return authority.confirmPreparation(
            {
              preparationToken: body.preparationToken,
              challengeToken: body.challengeToken,
            },
            context,
          );
        },
        () => auditContext,
      );
      return responseJson({ contractVersion: 1, requestId, data }, 200, cors);
    }

    throw new ProjectSApplicationError({
      status: 404,
      code: 'NOT_FOUND',
      detail: 'No Project S v1 endpoint matches this request.',
    });
  } catch (error) {
    const { problem, status, retryAfter } = problemFor(error, requestId);
    return responseJson(
      problem,
      status,
      cors,
      retryAfter ? { 'retry-after': retryAfter } : {},
      PROJECT_S_PROBLEM_MEDIA_TYPE,
    );
  }
});
