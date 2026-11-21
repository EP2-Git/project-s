import { ProjectSApplicationError } from '@project-s/application';
import {
  v2StepUpApprovedResponseSchema, v2StepUpRevokedResponseSchema, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { ActorCredentialError, authenticatePrincipal } from './actorCredentials.ts';
import { approveStepUpReview, revokeStepUpReview } from './mandateControls.ts';
import { parseRequestBody } from './requestBody.ts';
import {
  refuseStepUpHttp, stepUpHttpJson, stepUpHttpProblem, type StepUpHttpOptions,
} from './stepUpHttpResponses.ts';

// Unwired action factory, separate from the read-only review handler. These
// trusted server dependencies are never derived from request data. Importing
// this module does not serve a route or enable authority issuance or booking.
export const createStepUpActionHandler = ({ binding, auth, rpc, now }: StepUpHttpOptions) =>
  async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      const path = /^\/api\/v2\/authority\/step-ups\/([^/]+)\/(approve|revoke)(?![\s\S])/.exec(url.pathname);
      if (request.method !== 'POST' || !path) refuseStepUpHttp('NOT_FOUND');
      if (request.url.includes('?') || url.hash) refuseStepUpHttp('VALIDATION_ERROR');
      const review = v2UuidNode.zod.safeParse(path[1]);
      if (!review.success) refuseStepUpHttp('VALIDATION_ERROR');

      // Non-browser principal clients may omit Origin. A browser must match
      // the configured app origin; no cookie fallback or CORS grant exists.
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== binding.audience) refuseStepUpHttp('FORBIDDEN');
      const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (!['application/json', 'application/vnd.project-s.v2+json'].includes(mediaType)) {
        refuseStepUpHttp('VALIDATION_ERROR');
      }

      // Verify before reading the bounded body. Neither a prior review read
      // nor a caller-supplied identity/confirmation flag authorizes an action.
      const context = await authenticatePrincipal({
        authorization: request.headers.get('authorization'),
        requestId, transport: 'http', binding, auth, now,
      });
      let input: unknown;
      try {
        input = await parseRequestBody(request);
      } catch (error) {
        // Preserve only the parser's known validation statuses. Its message,
        // cause and raw JSON never become a public diagnostic.
        if (error instanceof ProjectSApplicationError && error.code === 'VALIDATION_ERROR' &&
            (error.status === 400 || error.status === 413)) {
          throw new ActorCredentialError('VALIDATION_ERROR', error.status,
            error.status === 413 ? 'The request body is too large.' : 'The review request is invalid.');
        }
        throw error;
      }

      // Action adapters validate the exact input and SQL revalidates live
      // ownership/state. Do not preflight through the pending-only GET: that
      // would reject eligible exact approval retries and valid revocations.
      if (path[2] === 'approve') {
        const data = await approveStepUpReview({ context, reviewId: review.data, input, binding, rpc });
        const body = v2StepUpApprovedResponseSchema.parse({ contractVersion: 2, requestId, data });
        return stepUpHttpJson(body, 200, 'application/vnd.project-s.v2+json');
      }
      const data = await revokeStepUpReview({ context, reviewId: review.data, input, binding, rpc });
      const body = v2StepUpRevokedResponseSchema.parse({ contractVersion: 2, requestId, data });
      return stepUpHttpJson(body, 200, 'application/vnd.project-s.v2+json');
    } catch (error) {
      return stepUpHttpProblem(error, requestId);
    }
  };
