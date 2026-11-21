import {
  v2StepUpReviewResponseSchema, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { authenticatePrincipal } from './actorCredentials.ts';
import { getStepUpReview } from './mandateControls.ts';
import {
  refuseStepUpHttp, stepUpHttpJson, stepUpHttpProblem, type StepUpHttpOptions,
} from './stepUpHttpResponses.ts';

// Unwired, server-only transport foundation. No entrypoint imports or serves
// this handler. Its dependencies must come from trusted server configuration,
// never a request body, cookie, caller-supplied context or object reference.
/** Reads one pending issuer review; this cannot approve, revoke or book. */
export const createStepUpReviewHandler = ({ binding, auth, rpc, now }: StepUpHttpOptions) =>
  async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      const path = /^\/api\/v2\/authority\/step-ups\/([^/]+)(?![\s\S])/.exec(url.pathname);
      if (request.method !== 'GET' || !path) refuseStepUpHttp('NOT_FOUND');
      // There are no query/context/body inputs on this reviewed GET operation.
      // Reject even an empty query marker instead of silently dropping input.
      if (request.url.includes('?') || url.hash || request.body !== null) refuseStepUpHttp('VALIDATION_ERROR');
      const review = v2UuidNode.zod.safeParse(path[1]);
      if (!review.success) refuseStepUpHttp('VALIDATION_ERROR');

      // Bearer-authenticated non-browser clients may omit Origin. Browser
      // requests must use the configured app origin; there is no CORS grant.
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== binding.audience) refuseStepUpHttp('FORBIDDEN');
      const context = await authenticatePrincipal({
        authorization: request.headers.get('authorization'),
        requestId, transport: 'http', binding, auth, now,
      });
      // SQL independently checks ownership, current authority and expiry under
      // its principal fence. A URL UUID or cached session is never authority.
      const data = await getStepUpReview({ context, reviewId: review.data, binding, rpc });
      const body = v2StepUpReviewResponseSchema.parse({ contractVersion: 2, requestId, data });
      return stepUpHttpJson(body, 200, 'application/vnd.project-s.v2+json');
    } catch (error) {
      return stepUpHttpProblem(error, requestId);
    }
  };
