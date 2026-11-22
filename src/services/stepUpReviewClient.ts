import { readBoundedText } from '@project-s/contracts';
import {
  v2ProblemEnvelopeSchema,
  v2StepUpApproveInputSchema,
  v2StepUpApprovedResponseSchema,
  v2StepUpReviewResponseSchema,
  v2StepUpRevokeInputSchema,
  v2StepUpRevokedResponseSchema,
  v2UuidSchema,
  type V2StepUpApproveInput,
  type V2StepUpApprovedData,
  type V2StepUpReviewData,
  type V2StepUpRevokeInput,
  type V2StepUpRevokedData,
} from '@project-s/contracts/v2';

export interface StepUpReviewClient {
  getReview(reviewId: string, signal?: AbortSignal): Promise<V2StepUpReviewData>;
  approve(reviewId: string, input: V2StepUpApproveInput, signal?: AbortSignal): Promise<V2StepUpApprovedData>;
  decline(reviewId: string, input: V2StepUpRevokeInput, signal?: AbortSignal): Promise<V2StepUpRevokedData>;
}

type ErrorKind = 'authentication' | 'unavailable' | 'busy' | 'slot_unavailable' |
  'outside_booking_window' | 'uncertain';
const messages: Record<ErrorKind, string> = {
  authentication: 'Sign in to review this request.',
  unavailable: 'This request is not available. Ask your agent to check its current permission.',
  busy: 'The service is busy. Retry the same request shortly.',
  slot_unavailable: 'That time is no longer available. Ask your agent for another time.',
  outside_booking_window: 'That meeting is outside the booking window. Ask your agent for another time.',
  uncertain: 'We have not received a verified result yet.',
};

/** Fixed local copy only: never expose upstream problem text or diagnostics. */
export class StepUpReviewClientError extends Error {
  constructor(public readonly kind: ErrorKind, public readonly retryAfterSeconds?: number) {
    super(messages[kind]);
    this.name = 'StepUpReviewClientError';
  }
}

// A client transport budget for the current fixed server serializers, NOT a
// general bound derived from the v2 schema (difference text has no maxLength).
// common.ts bounds the snapshot scalars. The preparation SQL constructs each
// difference from usernames (30), meeting titles (160), two 32-char instants
// plus separator (67), or a four-digit duration; 160 covers each source value.
// Include all four differences, envelope strings, JSON structure and worst-case
// six-byte escaping per UTF-16 code unit. Fixed action/problem serializers fit
// inside this larger read budget. Reassess if these server producers change.
const snapshotCodeUnits = 30 + 120 + 36 + 160 + 2 * 32 + 2 * 255 + 120 + 320;
const differenceCodeUnits = 4 * (16 + 2 * 160);
const envelopeCodeUnits = 128 + 36 + 64 + 32;
export const STEP_UP_REVIEW_RESPONSE_MAX_BYTES = 2_048 +
  6 * (snapshotCodeUnits + differenceCodeUnits + envelopeCodeUnits);
export const STEP_UP_REVIEW_TIMEOUT_MS = 30_000;

interface ClientOptions {
  /** Trusted configured app origin; never derive this from a review link. */
  baseUrl: string;
  /** Account bearer for this client/session; never a publishable key fallback. */
  accessToken: string;
  fetch?: typeof fetch;
}

/** Unwired browser client. Construction neither configures nor enables v2. */
export const createStepUpReviewClient = (options: ClientOptions): StepUpReviewClient => {
  let origin: string;
  try {
    const url = new URL(options.baseUrl);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        ![url.origin, `${url.origin}/`].includes(options.baseUrl)) throw new Error();
    origin = url.origin;
  } catch {
    throw new StepUpReviewClientError('unavailable');
  }
  const token = options.accessToken;
  if (!token || /\s/.test(token)) throw new StepUpReviewClientError('authentication');
  const send = options.fetch ?? globalThis.fetch;

  const request = async (
    reviewId: string,
    action: 'read' | 'approve' | 'decline',
    input?: V2StepUpApproveInput | V2StepUpRevokeInput,
    signal?: AbortSignal,
  ): Promise<V2StepUpReviewData | V2StepUpApprovedData | V2StepUpRevokedData> => {
    const parsedId = v2UuidSchema.safeParse(reviewId);
    const parsedInput = action === 'approve' ? v2StepUpApproveInputSchema.safeParse(input)
      : action === 'decline' ? v2StepUpRevokeInputSchema.safeParse(input) : null;
    if (!parsedId.success || (parsedInput !== null && !parsedInput.success)) {
      throw new StepUpReviewClientError('unavailable');
    }
    const path = `/api/v2/authority/step-ups/${parsedId.data}` +
      (action === 'read' ? '' : action === 'approve' ? '/approve' : '/revoke');
    const url = `${origin}${path}`;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timeout = setTimeout(cancel, STEP_UP_REVIEW_TIMEOUT_MS);
    try {
      const response = await send(url, {
        method: action === 'read' ? 'GET' : 'POST',
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.project-s.v2+json, application/problem+json',
          ...(action === 'read' ? {} : { 'content-type': 'application/vnd.project-s.v2+json' }),
        },
        ...(parsedInput?.success ? { body: JSON.stringify(parsedInput.data) } : {}),
      });
      // A supplied fetch must preserve the native no-redirect policy as well.
      if (response.redirected || response.type === 'opaqueredirect' ||
          (response.url && response.url !== url)) {
        await response.body?.cancel().catch(() => undefined);
        throw new StepUpReviewClientError('uncertain');
      }
      const text = await readBoundedText(response.body, STEP_UP_REVIEW_RESPONSE_MAX_BYTES, {
        declaredLength: response.headers.get('content-length'), signal: controller.signal,
      });
      const payload: unknown = JSON.parse(text);
      const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (!response.ok) {
        const problem = v2ProblemEnvelopeSchema.safeParse(payload);
        if (mediaType !== 'application/problem+json' || !problem.success ||
            problem.data.error.status !== response.status) throw new StepUpReviewClientError('uncertain');
        // Display only fixed local copy. Unknown/internal results may follow a
        // successful mutation; they must not unlock a different action.
        const { code } = problem.data.error;
        if (code === 'AUTHENTICATION_REQUIRED') throw new StepUpReviewClientError('authentication');
        if (code === 'AUTHORITY_BUSY') throw new StepUpReviewClientError('busy', 1);
        if (code === 'SLOT_UNAVAILABLE' && response.status === 409) throw new StepUpReviewClientError('slot_unavailable');
        if (code === 'OUTSIDE_BOOKING_WINDOW' && response.status === 409) throw new StepUpReviewClientError('outside_booking_window');
        const unavailableStatus = { FORBIDDEN: 403, NOT_FOUND: 404, VERSION_CONFLICT: 409, VALIDATION_ERROR: 400 };
        if ((Object.prototype.hasOwnProperty.call(unavailableStatus, code) &&
            unavailableStatus[code as keyof typeof unavailableStatus] === response.status) ||
            (code === 'VALIDATION_ERROR' && response.status === 413)) {
          throw new StepUpReviewClientError('unavailable');
        }
        throw new StepUpReviewClientError('uncertain');
      }
      if (response.status !== 200 || mediaType !== 'application/vnd.project-s.v2+json') {
        throw new StepUpReviewClientError('uncertain');
      }
      const schema = action === 'read' ? v2StepUpReviewResponseSchema
        : action === 'approve' ? v2StepUpApprovedResponseSchema : v2StepUpRevokedResponseSchema;
      const parsed = schema.safeParse(payload);
      if (!parsed.success || parsed.data.data.reviewId !== parsedId.data) {
        throw new StepUpReviewClientError('uncertain');
      }
      if (action === 'decline' && ('revision' in parsed.data.data) &&
          parsedInput?.success && parsed.data.data.revision !== parsedInput.data.expectedRevision + 1) {
        throw new StepUpReviewClientError('uncertain');
      }
      return parsed.data.data;
    } catch (error) {
      if (error instanceof StepUpReviewClientError) throw error;
      throw new StepUpReviewClientError('uncertain');
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }
  };

  return {
    getReview: (reviewId, signal) => request(reviewId, 'read', undefined, signal) as Promise<V2StepUpReviewData>,
    approve: (reviewId, input, signal) => request(reviewId, 'approve', input, signal) as Promise<V2StepUpApprovedData>,
    decline: (reviewId, input, signal) => request(reviewId, 'decline', input, signal) as Promise<V2StepUpRevokedData>,
  };
};
