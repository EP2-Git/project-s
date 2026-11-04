import { z } from 'zod';
import {
  v2BookerProfileCreateInputNode, v2DigestNode, v2InstantNode, v2InstantToEpochMicroseconds, v2MandateApproveInputSchema,
  v2MandateApprovedDataSchema, v2MandateReviewDataSchema, v2MandateReviewInputSchema,
  v2MandateRevokeInputSchema, v2MandateRevokedDataSchema, v2PrincipalContextSchema,
  v2PreparedBookingSummarySchema, v2RevisionNode, v2StepUpApproveInputSchema, v2StepUpApprovedDataSchema,
  v2StepUpRevokeInputSchema, v2StepUpRevokedDataSchema, v2UuidNode,
} from './.generated/contracts/dist/v2/index.js';
import { ActorCredentialError, type AuthorityBinding, type AuthorityRpc } from './actorCredentials.ts';

// Server-only, unexposed principal controls. Call authenticatePrincipal freshly
// before invoking these adapters; SQL independently rechecks live ownership and
// supporting state under the principal fence. No actor context is accepted.
const bindingSchema = z.object({
  instanceId: v2UuidNode.zod, epoch: v2RevisionNode.zod, audience: z.string(),
}).strict();
const failure = (code: string, status: number, message: string) => new ActorCredentialError(code, status, message);
const invalid = () => failure('VALIDATION_ERROR', 400, 'The mandate request is invalid.');
const denied = () => failure('AUTHENTICATION_REQUIRED', 401, 'Authentication is required.');
const internal = () => failure('INTERNAL_ERROR', 500, 'The authority service could not complete the request.');
const principalFor = (context: unknown, binding: AuthorityBinding) => {
  const config = bindingSchema.safeParse(binding);
  const principal = v2PrincipalContextSchema.safeParse(context);
  if (!config.success || !principal.success || principal.data.instanceId !== config.data.instanceId ||
      principal.data.epoch !== config.data.epoch) throw denied();
  try {
    const origin = new URL(config.data.audience);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
    if (origin.origin !== config.data.audience || origin.username || origin.password ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback))) throw denied();
  } catch { throw denied(); }
  return principal.data;
};
const invoke = async (rpc: AuthorityRpc, name: string, args: Record<string, unknown>, schedulingErrors = false) => {
  let result;
  try { result = await rpc(name, args); } catch { throw internal(); }
  if (!result || result.error) {
    const code = result?.error?.code;
    if (['PT503', '55P03', '57014', '40P01', '40001'].includes(code ?? '')) {
      throw failure('AUTHORITY_BUSY', 503, 'The authority service is busy. Retry the same request.');
    }
    if (code === 'PT400') throw invalid();
    if (code === 'PT401') throw denied();
    if (code === 'PT403') throw failure('FORBIDDEN', 403, 'This operation is not permitted.');
    if (code === 'PT409') {
      if (schedulingErrors && result?.error?.message === 'SLOT_UNAVAILABLE') {
        throw failure('SLOT_UNAVAILABLE', 409, 'The selected slot is unavailable.');
      }
      if (schedulingErrors && result?.error?.message === 'OUTSIDE_BOOKING_WINDOW') {
        throw failure('OUTSIDE_BOOKING_WINDOW', 409, "The meeting is outside the host's booking window.");
      }
      throw failure('VERSION_CONFLICT', 409, 'The authority state has changed.');
    }
    throw internal();
  }
  return result.data;
};
type PrincipalControl = { context: unknown; binding: AuthorityBinding; rpc: AuthorityRpc };

export const createMandateReview = async ({ context, input, binding, rpc }: PrincipalControl & { input: unknown }) => {
  const principal = principalFor(context, binding);
  const parsed = v2MandateReviewInputSchema.safeParse(input);
  if (!parsed.success) throw invalid();
  const reviewId = crypto.randomUUID();
  const raw = await invoke(rpc, 'project_s_create_mandate_review_v2', {
    p_context: principal, p_review_id: reviewId, p_policy: parsed.data,
  });
  const result = v2MandateReviewDataSchema.safeParse(raw);
  if (!result.success || result.data.reviewId !== reviewId || result.data.revision !== 1) throw internal();
  // The summary's display/profile fields are server resolved. Every submitted
  // policy field must be the exact normalized value, never silently broadened.
  for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
    if (result.data.policySummary[key] !== parsed.data[key]) throw internal();
  }
  if (v2InstantToEpochMicroseconds(result.data.expiresAt) > v2InstantToEpochMicroseconds(parsed.data.expiresAt)) throw internal();
  return result.data;
};

export const approveMandate = async ({ context, reviewId, input, binding, rpc }: PrincipalControl & {
  reviewId: string; input: unknown;
}) => {
  const principal = principalFor(context, binding);
  const review = v2UuidNode.zod.safeParse(reviewId);
  const parsed = v2MandateApproveInputSchema.safeParse(input);
  if (!review.success || !parsed.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_approve_mandate_v2', {
    p_context: principal, p_review_id: review.data, p_mandate_id: crypto.randomUUID(),
    p_expected_revision: parsed.data.expectedRevision, p_summary_digest: parsed.data.summaryDigest,
  });
  const result = v2MandateApprovedDataSchema.safeParse(raw);
  // An exact retry returns the original mandate, even though this invocation
  // proposed a fresh internal identity. SQL never issues a second permission.
  if (!result.success || result.data.revision !== 1) throw internal();
  return result.data;
};

// Internal RPC output validation only; no new public contract or GET route.
const mandateStateSchema = z.object({
  mandateId: v2UuidNode.zod, revision: v2RevisionNode.zod,
  state: z.enum(['active', 'revoked', 'expired']),
  issuedAt: v2InstantNode.zod, expiresAt: v2InstantNode.zod,
  remainingUses: z.number().int().min(0).max(1),
}).strict().superRefine((value, ctx) => {
  if (!v2InstantNode.zod.safeParse(value.issuedAt).success || !v2InstantNode.zod.safeParse(value.expiresAt).success) return;
  const lifetime = v2InstantToEpochMicroseconds(value.expiresAt) - v2InstantToEpochMicroseconds(value.issuedAt);
  if (lifetime <= 0n || lifetime > 24n * 60n * 60n * 1_000_000n ||
      (value.state !== 'active' && value.remainingUses !== 0)) ctx.addIssue({ code: 'custom', message: 'Invalid mandate state.' });
});
export const getMandate = async ({ context, mandateId, binding, rpc }: PrincipalControl & { mandateId: string }) => {
  const principal = principalFor(context, binding);
  const mandate = v2UuidNode.zod.safeParse(mandateId);
  if (!mandate.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_get_mandate_v2', { p_context: principal, p_mandate_id: mandate.data });
  const result = mandateStateSchema.safeParse(raw);
  if (!result.success || result.data.mandateId !== mandate.data) throw internal();
  return result.data;
};

const stepUpDifferenceSchema = z.object({
  field: z.enum(['host', 'meeting_type', 'meeting_window', 'duration']),
  proposed: z.string().min(1),
  reviewed: z.string().min(1),
}).strict();
const stepUpBookerSchema = z.strictObject({
  name: v2BookerProfileCreateInputNode.shape.name,
  email: v2BookerProfileCreateInputNode.shape.email,
});
const stepUpExactSummarySchema = z.unknown().transform((value, ctx) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid step-up booking snapshot.' });
    return z.NEVER;
  }
  const { name, email, ...snapshot } = value as Record<string, unknown>;
  const summary = v2PreparedBookingSummarySchema.safeParse(snapshot);
  const booker = stepUpBookerSchema.safeParse({ name, email });
  if (!summary.success || !booker.success) {
    ctx.addIssue({ code: 'custom', message: 'Invalid step-up booking snapshot.' });
    return z.NEVER;
  }
  return { ...summary.data, ...booker.data };
});
const stepUpReviewSchema = z.object({
  reviewId: v2UuidNode.zod,
  revision: z.literal(1),
  state: z.literal('pending'),
  summaryDigest: v2DigestNode.zod,
  expiresAt: v2InstantNode.zod,
  exactSummary: stepUpExactSummarySchema,
  differences: z.array(stepUpDifferenceSchema).min(1).max(4),
}).strict();

// The stored snapshot is for issuer review. Approval must revalidate current
// scheduling separately. Keep the private profile fields out of actor results.
export const getStepUpReview = async ({ context, reviewId, binding, rpc }: PrincipalControl & { reviewId: string }) => {
  const principal = principalFor(context, binding);
  const review = v2UuidNode.zod.safeParse(reviewId);
  if (!review.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_get_step_up_review_v2', { p_context: principal, p_review_id: review.data });
  const result = stepUpReviewSchema.safeParse(raw);
  if (!result.success || result.data.reviewId !== review.data) throw internal();
  return result.data;
};

export const approveStepUpReview = async ({ context, reviewId, input, binding, rpc }: PrincipalControl & {
  reviewId: string; input: unknown;
}) => {
  const principal = principalFor(context, binding);
  const review = v2UuidNode.zod.safeParse(reviewId);
  const parsed = v2StepUpApproveInputSchema.safeParse(input);
  if (!review.success || !parsed.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_approve_step_up_v2', {
    p_context: principal, p_review_id: review.data,
    p_preparation_id: crypto.randomUUID(), p_grant_id: crypto.randomUUID(),
    p_expected_revision: parsed.data.expectedRevision, p_summary_digest: parsed.data.summaryDigest,
  }, true);
  const result = v2StepUpApprovedDataSchema.safeParse(raw);
  // An eligible retry reconciles the original preparation and deadline.
  if (!result.success || result.data.reviewId !== review.data) throw internal();
  return result.data;
};

export const revokeStepUpReview = async ({ context, reviewId, input, binding, rpc }: PrincipalControl & {
  reviewId: string; input: unknown;
}) => {
  const principal = principalFor(context, binding);
  const review = v2UuidNode.zod.safeParse(reviewId);
  const parsed = v2StepUpRevokeInputSchema.safeParse(input);
  if (!review.success || !parsed.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_revoke_step_up_v2', {
    p_context: principal, p_review_id: review.data, p_expected_revision: parsed.data.expectedRevision,
  });
  const result = v2StepUpRevokedDataSchema.safeParse(raw);
  if (!result.success || result.data.reviewId !== review.data ||
      ![2, 3].includes(result.data.revision) ||
      result.data.revision !== parsed.data.expectedRevision + 1) throw internal();
  return result.data;
};

export const revokeMandate = async ({ context, mandateId, input, binding, rpc }: PrincipalControl & {
  mandateId: string; input: unknown;
}) => {
  const principal = principalFor(context, binding);
  const mandate = v2UuidNode.zod.safeParse(mandateId);
  const parsed = v2MandateRevokeInputSchema.safeParse(input);
  if (!mandate.success || !parsed.success) throw invalid();
  const raw = await invoke(rpc, 'project_s_revoke_mandate_v2', {
    p_context: principal, p_mandate_id: mandate.data, p_expected_revision: parsed.data.expectedRevision,
  });
  const result = v2MandateRevokedDataSchema.safeParse(raw);
  if (!result.success || result.data.mandateId !== mandate.data || result.data.revision !== 2) throw internal();
  return result.data;
};
