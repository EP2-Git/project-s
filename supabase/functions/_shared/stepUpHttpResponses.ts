import { v2ProblemEnvelopeSchema, type V2ProblemCode } from './.generated/contracts/dist/v2/index.js';
import {
  ActorCredentialError,
  type AuthorityBinding, type AuthorityRpc, type PrincipalAuth,
} from './actorCredentials.ts';

// Trusted server dependencies only. A read handler and an action handler must
// be constructed explicitly; neither a request body nor a cookie supplies them.
export interface StepUpHttpOptions {
  binding: AuthorityBinding;
  auth: PrincipalAuth;
  rpc: AuthorityRpc;
  now?: () => Date;
}

const responseHeaders = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'vary': 'Authorization, Origin',
};
const refusals = {
  AUTHENTICATION_REQUIRED: { status: 401, detail: 'Authentication is required.' },
  FORBIDDEN: { status: 403, detail: 'This operation is not permitted.' },
  VALIDATION_ERROR: { status: 400, detail: 'The review request is invalid.' },
  NOT_FOUND: { status: 404, detail: 'No review endpoint matches this request.' },
  VERSION_CONFLICT: { status: 409, detail: 'The authority state has changed.' },
  SLOT_UNAVAILABLE: { status: 409, detail: 'The selected slot is unavailable.' },
  OUTSIDE_BOOKING_WINDOW: { status: 409, detail: "The meeting is outside the host's booking window." },
  AUTHORITY_BUSY: { status: 503, detail: 'The authority service is busy. Retry the same request.' },
  INTERNAL_ERROR: { status: 500, detail: 'The authority service could not complete the request.' },
} as const satisfies Partial<Record<V2ProblemCode, { status: number; detail: string }>>;
type RefusalCode = keyof typeof refusals;
export const refuseStepUpHttp: (code: RefusalCode) => never = (code) => {
  const refusal = refusals[code];
  throw new ActorCredentialError(code, refusal.status, refusal.detail);
};

export const stepUpHttpJson = (body: unknown, status: number, mediaType: string, retry = false) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: {
      ...responseHeaders,
      'content-type': mediaType,
      ...(retry ? { 'retry-after': '1' } : {}),
    },
  },
);

export const stepUpHttpProblem = (error: unknown, requestId: string): Response => {
  // Never reflect status, message or cause from Auth/RPC/parser diagnostics.
  // The one alternate validation status is the existing bounded-body refusal.
  const code: RefusalCode = error instanceof ActorCredentialError &&
    Object.hasOwn(refusals, error.code) ? error.code as RefusalCode : 'INTERNAL_ERROR';
  const tooLarge = error instanceof ActorCredentialError && code === 'VALIDATION_ERROR' && error.status === 413;
  const { status, detail } = tooLarge
    ? { status: 413, detail: 'The request body is too large.' }
    : refusals[code];
  const retry = code === 'AUTHORITY_BUSY';
  const body = v2ProblemEnvelopeSchema.parse({
    contractVersion: 2,
    requestId,
    error: {
      code, status, requestId, detail,
      title: 'Project S review request failed',
      type: `https://project-s.local/problems/${code.toLowerCase().replaceAll('_', '-')}`,
      ...(retry ? { retry: { action: 'retry_after', afterSeconds: 1 } } : {}),
    },
  });
  return stepUpHttpJson(body, status, 'application/problem+json', retry);
};
