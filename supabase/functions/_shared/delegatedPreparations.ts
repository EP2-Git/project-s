import { z } from 'zod';
import {
  v2ActorContextSchema, v2PrepareBookingDataSchema, v2PrepareBookingInputSchema,
  v2ProblemStepUpSchema, v2RevisionNode, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { ActorCredentialError, type AuthorityBinding, type AuthorityRpc } from './actorCredentials.ts';

// Internal adapter only: freshly authenticateActor before calling it. Context
// parsing is not authentication. SQL revalidates the current caller and policy
// after its final lock wait. No public route, commit or issuer control is wired.
const bindingSchema = z.object({
  instanceId: v2UuidNode.zod, epoch: v2RevisionNode.zod, audience: z.string(),
}).strict();
const outcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prepared'), data: v2PrepareBookingDataSchema }).strict(),
  z.object({ kind: z.literal('step_up_required'), stepUp: v2ProblemStepUpSchema }).strict(),
]);
const failure = (code: string, status: number, message: string) => new ActorCredentialError(code, status, message);
const invalid = () => failure('VALIDATION_ERROR', 400, 'The booking preparation request is invalid.');
const denied = () => failure('AUTHENTICATION_REQUIRED', 401, 'Authentication is required.');
const internal = () => failure('INTERNAL_ERROR', 500, 'The authority service could not complete the request.');

const actorFor = (context: unknown, input: AuthorityBinding) => {
  const binding = bindingSchema.safeParse(input);
  const actor = v2ActorContextSchema.safeParse(context);
  if (!binding.success || !actor.success || actor.data.instanceId !== binding.data.instanceId ||
      actor.data.epoch !== binding.data.epoch) throw denied();
  try {
    const origin = new URL(binding.data.audience);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
    if (origin.origin !== binding.data.audience || origin.username || origin.password ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) throw denied();
  } catch { throw denied(); }
  return actor.data;
};

const invoke = async (rpc: AuthorityRpc, args: Record<string, unknown>) => {
  let result;
  try { result = await rpc('project_s_prepare_delegated_booking_v2', args); } catch { throw internal(); }
  if (!result || result.error) {
    const code = result?.error?.code;
    if (['PT503', '55P03', '57014', '40P01', '40001'].includes(code ?? '')) {
      throw Object.assign(failure('AUTHORITY_BUSY', 503, 'The authority service is busy. Retry the same request.'),
        { retry: { action: 'retry_after' as const, afterSeconds: 1 } });
    }
    if (code === 'PT400') throw invalid();
    if (code === 'PT401') throw denied();
    if (code === 'PT403') throw failure('FORBIDDEN', 403, 'This operation is not permitted.');
    if (code === 'PT404') throw failure('MEETING_TYPE_UNAVAILABLE', 404, 'The meeting type is unavailable.');
    if (code === 'PT410') throw failure('MANDATE_EXPIRED', 410, 'The booking permission has expired.');
    if (code === 'PT429') throw failure('RATE_LIMITED', 429, 'The authority request limit has been reached.');
    if (code === 'PT409') {
      const messages: Record<string, string> = {
        VERSION_CONFLICT: 'The authority state has changed.',
        SLOT_UNAVAILABLE: 'The selected slot is unavailable.',
        OUTSIDE_BOOKING_WINDOW: "The meeting is outside the host's booking window.",
      };
      const canonical = result?.error?.message;
      if (canonical && Object.hasOwn(messages, canonical)) throw failure(canonical, 409, messages[canonical]);
    }
    throw internal();
  }
  return result.data;
};

export const prepareDelegatedBooking = async ({ context, input, binding, rpc }: {
  context: unknown; input: unknown; binding: AuthorityBinding; rpc: AuthorityRpc;
}) => {
  const actor = actorFor(context, binding);
  const parsed = v2PrepareBookingInputSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const raw = await invoke(rpc, {
    p_context: actor, p_request: parsed.data,
    p_preparation_id: crypto.randomUUID(), p_step_up_id: crypto.randomUUID(),
  });
  const result = outcomeSchema.safeParse(raw);
  if (!result.success) throw internal();
  if (result.data.kind === 'prepared') {
    const summary = result.data.data.summary;
    if (summary.username !== parsed.data.username || summary.meetingTypeId !== parsed.data.meetingTypeId ||
        summary.startAt !== parsed.data.startAt) throw internal();
    // SQL may reconcile to an existing private ID; accepting that response
    // never gives the reference bearer authority or creates another budget.
  } else if (new URL(result.data.stepUp.reviewUrl).origin !== binding.audience) throw internal();
  // Tagged internal output is not an HTTP envelope or provider grant. A future
  // transport must build the reviewed v2 success/problem shapes and remain
  // unavailable until the full commit/step-up/retention/enablement gates pass.
  return result.data;
};
