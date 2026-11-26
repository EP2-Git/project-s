import { BodyTooLargeError, PROJECT_S_PUBLIC_REQUEST_MAX_BYTES, readBoundedText } from '@project-s/contracts';
import {
  PROJECT_S_V2_CONTRACT_MEDIA_TYPE, v2CreateBookingResponseSchema, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { ActorCredentialError, authenticateActor } from './actorCredentials.ts';
import { commitDelegatedBooking, readDelegatedBookingReceipt } from './delegatedPreparations.ts';
import {
  delegatedBookingHttpProblem, refuseStepUpHttp, stepUpHttpJson, type StepUpHttpOptions,
} from './stepUpHttpResponses.ts';

type ActorBookingHttpOptions = Pick<StepUpHttpOptions, 'binding' | 'rpc' | 'now'>;

const authenticateBookingActor = (request: Request, requestId: string, options: ActorBookingHttpOptions) => {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== options.binding.audience) refuseStepUpHttp('FORBIDDEN');
  return authenticateActor({
    ...options, authorization: request.headers.get('authorization'), requestId, transport: 'http',
  });
};

const readCommitInput = async (request: Request): Promise<unknown> => {
  let text: string;
  try {
    text = await readBoundedText(request.body, PROJECT_S_PUBLIC_REQUEST_MAX_BYTES, {
      declaredLength: request.headers.get('content-length'), signal: request.signal,
    });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new ActorCredentialError('VALIDATION_ERROR', 413, 'The request body is too large.');
    }
    throw error;
  }

  let input: unknown;
  try { input = JSON.parse(text); }
  catch { refuseStepUpHttp('VALIDATION_ERROR'); }
  // A valid commit is a flat object with exactly two string members. Counting
  // member separators in valid JSON before schema validation rejects
  // duplicate keys, including escaped aliases that JSON.parse would overwrite.
  const separators = text.replace(/"(?:[^"\\]|\\[\s\S])*"/g, '').match(/:/g);
  if (separators?.length !== 2) refuseStepUpHttp('VALIDATION_ERROR');
  return input;
};

const receiptResponse = (data: unknown, requestId: string, status: 200 | 201) =>
  stepUpHttpJson(v2CreateBookingResponseSchema.parse({ contractVersion: 2, requestId, data }),
    status, PROJECT_S_V2_CONTRACT_MEDIA_TYPE);

// Unwired factories, constructed only with trusted server dependencies.
export const createDelegatedBookingCommitHandler = (options: ActorBookingHttpOptions) =>
  async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/api/v2/delegated/bookings') {
        refuseStepUpHttp('NOT_FOUND');
      }
      if (request.url.includes('?') || request.url.includes('#')) refuseStepUpHttp('VALIDATION_ERROR');
      const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (mediaType !== 'application/json' && mediaType !== PROJECT_S_V2_CONTRACT_MEDIA_TYPE) {
        refuseStepUpHttp('VALIDATION_ERROR');
      }

      const context = await authenticateBookingActor(request, requestId, options);
      const input = await readCommitInput(request);
      // Send the exact input to the existing atomic commit. A status preflight
      // would reject a valid replay after the first commit spent the permission.
      const data = await commitDelegatedBooking({ context, input, binding: options.binding, rpc: options.rpc });
      return receiptResponse(data, requestId, 201);
    } catch (error) {
      return delegatedBookingHttpProblem(error, requestId);
    }
  };

export const createDelegatedBookingReceiptHandler = (options: ActorBookingHttpOptions) =>
  async (request: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      const path = /^\/api\/v2\/delegated\/receipts\/([^/]+)(?![\s\S])/.exec(url.pathname);
      if (request.method !== 'GET' || !path) refuseStepUpHttp('NOT_FOUND');
      const length = request.headers.get('content-length');
      if (request.url.includes('?') || request.url.includes('#') || request.body !== null ||
          request.headers.has('transfer-encoding') || (length !== null && length !== '0')) {
        refuseStepUpHttp('VALIDATION_ERROR');
      }
      const receipt = v2UuidNode.zod.safeParse(path[1]);
      if (!receipt.success) refuseStepUpHttp('VALIDATION_ERROR');

      const context = await authenticateBookingActor(request, requestId, options);
      const data = await readDelegatedBookingReceipt({
        context, receiptId: receipt.data, binding: options.binding, rpc: options.rpc,
      });
      return receiptResponse(data, requestId, 200);
    } catch (error) {
      return delegatedBookingHttpProblem(error, requestId);
    }
  };
