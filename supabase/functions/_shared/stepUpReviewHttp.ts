import {
  v2ProblemEnvelopeSchema, v2StepUpReviewResponseSchema, v2UuidNode,
  type V2ProblemCode,
} from './.generated/contracts/dist/v2/index.js';
import {
  ActorCredentialError, authenticatePrincipal,
  type AuthorityBinding, type AuthorityRpc, type PrincipalAuth,
} from './actorCredentials.ts';
import { getStepUpReview } from './mandateControls.ts';

// Unwired, server-only transport foundation. No entrypoint imports or serves
// this handler. Its dependencies must come from trusted server configuration,
// never a request body, cookie, caller-supplied context or object reference.
interface StepUpReviewHttpOptions {
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
  AUTHORITY_BUSY: { status: 503, detail: 'The authority service is busy. Retry the same request.' },
  INTERNAL_ERROR: { status: 500, detail: 'The authority service could not complete the request.' },
} as const satisfies Partial<Record<V2ProblemCode, { status: number; detail: string }>>;
type RefusalCode = keyof typeof refusals;
const refuse: (code: RefusalCode) => never = (code) => {
  const refusal = refusals[code];
  throw new ActorCredentialError(code, refusal.status, refusal.detail);
};
const json = (body: unknown, status: number, mediaType: string, retry = false) => new Response(
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

/** Reads one pending issuer review; this cannot approve, revoke or book. */
export const createStepUpReviewHandler = ({ binding, auth, rpc, now }: StepUpReviewHttpOptions) =>
  async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      const path = /^\/api\/v2\/authority\/step-ups\/([^/]+)(?![\s\S])/.exec(url.pathname);
      if (request.method !== 'GET' || !path) refuse('NOT_FOUND');
      // There are no query/context/body inputs on this reviewed GET operation.
      // Reject even an empty query marker instead of silently dropping input.
      if (request.url.includes('?') || url.hash || request.body !== null) refuse('VALIDATION_ERROR');
      const review = v2UuidNode.zod.safeParse(path[1]);
      if (!review.success) refuse('VALIDATION_ERROR');

      // Bearer-authenticated non-browser clients may omit Origin. Browser
      // requests must use the configured app origin; there is no CORS grant.
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== binding.audience) refuse('FORBIDDEN');
      const context = await authenticatePrincipal({
        authorization: request.headers.get('authorization'),
        requestId, transport: 'http', binding, auth, now,
      });
      // SQL independently checks ownership, current authority and expiry under
      // its principal fence. A URL UUID or cached session is never authority.
      const data = await getStepUpReview({ context, reviewId: review.data, binding, rpc });
      const body = v2StepUpReviewResponseSchema.parse({ contractVersion: 2, requestId, data });
      return json(body, 200, 'application/vnd.project-s.v2+json');
    } catch (error) {
      // Only canonical codes may cross the boundary. Ignore the exception's
      // status/message/cause: upstream diagnostics can contain private data.
      const code: RefusalCode = error instanceof ActorCredentialError &&
        Object.hasOwn(refusals, error.code) ? error.code as RefusalCode : 'INTERNAL_ERROR';
      const { status, detail } = refusals[code];
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
      return json(body, status, 'application/problem+json', retry);
    }
  };
