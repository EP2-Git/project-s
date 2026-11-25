import {
  PROJECT_S_V2_CONTRACT_MEDIA_TYPE, v2DelegatedStepUpResponseSchema, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { authenticateActor } from './actorCredentials.ts';
import { getDelegatedStepUp } from './delegatedPreparations.ts';
import {
  refuseStepUpHttp, stepUpHttpJson, stepUpHttpProblem, type StepUpHttpOptions,
} from './stepUpHttpResponses.ts';

// Constructed by trusted server code. Importing this factory serves no route.
export const createDelegatedStepUpHandler = ({
  binding, rpc, now,
}: Pick<StepUpHttpOptions, 'binding' | 'rpc' | 'now'>) =>
  async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      const path = /^\/api\/v2\/delegated\/step-ups\/([^/]+)(?![\s\S])/.exec(url.pathname);
      if (request.method !== 'GET' || !path) refuseStepUpHttp('NOT_FOUND');
      const length = request.headers.get('content-length');
      if (request.url.includes('?') || request.url.includes('#') || request.body !== null ||
          request.headers.has('transfer-encoding') || (length !== null && length !== '0')) {
        refuseStepUpHttp('VALIDATION_ERROR');
      }
      const review = v2UuidNode.zod.safeParse(path[1]);
      if (!review.success) refuseStepUpHttp('VALIDATION_ERROR');

      const origin = request.headers.get('origin');
      if (origin !== null && origin !== binding.audience) refuseStepUpHttp('FORBIDDEN');
      const context = await authenticateActor({
        authorization: request.headers.get('authorization'),
        requestId, transport: 'http', binding, rpc, now,
      });
      const data = await getDelegatedStepUp({ context, reviewId: review.data, binding, rpc });
      const body = v2DelegatedStepUpResponseSchema.parse({ contractVersion: 2, requestId, data });
      return stepUpHttpJson(body, 200, PROJECT_S_V2_CONTRACT_MEDIA_TYPE);
    } catch (error) {
      return stepUpHttpProblem(error, requestId);
    }
  };
