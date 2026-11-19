import { z } from 'zod';

import { bookerNode, emailNode, ianaTimeZoneNode } from '../common.js';
import { arrayNode, contractEnum, contractLiteral, contractNode, contractString, objectNode } from '../schema.js';
import { v2MandateApproveInputNode, v2PreparedBookingSummaryNode, v2SuccessEnvelopeNode } from './operations.js';
import {
  v2DigestNode,
  v2InstantNode,
  v2InstantToEpochMicroseconds,
  v2RevisionNode,
  v2UuidNode,
} from './scalars.js';

// Strict, unavailable principal-control shapes only. Parsing does not verify an
// account, object ownership, approval, durable revocation or retention cleanup.
const actorLabelNode = contractNode(contractString({ trim: true, minLength: 1, maxLength: 80 }), {
  type: 'string',
  minLength: 1,
  maxLength: 80,
  'x-project-s-normalization': 'trim',
});

export const v2ActorRegisterInputNode = objectNode({
  label: actorLabelNode,
}, { title: 'V2ActorRegisterInput', description: 'A display label is not authentication or authority.' });
export const v2ActorRegisterInputSchema = v2ActorRegisterInputNode.zod;

export const v2ExpectedRevisionInputNode = objectNode({
  expectedRevision: v2RevisionNode,
}, { title: 'V2ExpectedRevisionInput', description: 'Compare-and-swap input; the server verifies current state and ownership.' });
export const v2ExpectedRevisionInputSchema = v2ExpectedRevisionInputNode.zod;

export const v2ActorRevokeInputNode = contractNode(v2ExpectedRevisionInputNode.zod, {
  ...v2ExpectedRevisionInputNode.jsonSchema, title: 'V2ActorRevokeInput',
});
export const v2ActorRevokeInputSchema = v2ActorRevokeInputNode.zod;

export const v2ActorRevokedDataNode = objectNode({
  actorId: v2UuidNode,
  revision: v2RevisionNode,
  state: contractNode(contractLiteral('revoked'), { type: 'string', const: 'revoked' }),
  revokedAt: v2InstantNode,
}, { title: 'V2ActorRevokedData' });
export const v2ActorRevokedDataSchema = v2ActorRevokedDataNode.zod;

const reviewedNameNode = contractNode(
  bookerNode.shape.name,
  (bookerNode.jsonSchema.properties as Record<string, Record<string, unknown>>).name,
);
export const v2BookerProfileCreateInputNode = objectNode({
  name: reviewedNameNode,
  email: emailNode,
  guestTimeZone: ianaTimeZoneNode,
}, { title: 'V2BookerProfileCreateInput', description: 'Principal-reviewed profile input; notes and caller identity are not accepted.' });
export const v2BookerProfileCreateInputSchema = v2BookerProfileCreateInputNode.zod;

const maximumProfileMicroseconds = 7n * 24n * 60n * 60n * 1_000_000n;
const v2BookerProfileCreatedDataBaseNode = objectNode({
  profileId: v2UuidNode,
  revision: v2RevisionNode,
  reviewedAt: v2InstantNode,
  expiresAt: v2InstantNode,
}, { title: 'V2BookerProfileCreatedData' });
export const v2BookerProfileCreatedDataNode = contractNode(
  v2BookerProfileCreatedDataBaseNode.zod.refine(({ reviewedAt, expiresAt }) => {
    // Failed scalar transforms must remain validation failures, not exceptions.
    if (!v2InstantNode.zod.safeParse(reviewedAt).success ||
        !v2InstantNode.zod.safeParse(expiresAt).success) return true;
    const lifetime = v2InstantToEpochMicroseconds(expiresAt) -
      v2InstantToEpochMicroseconds(reviewedAt);
    return lifetime > 0n && lifetime <= maximumProfileMicroseconds;
  }, { message: 'expiresAt must be after reviewedAt and at most seven days later.', path: ['expiresAt'] }),
  {
    ...v2BookerProfileCreatedDataBaseNode.jsonSchema,
    'x-project-s-refinements': ['0 < expiresAt - reviewedAt <= seven days, compared without losing microsecond precision; timestamps are server-derived.'],
  },
);
export const v2BookerProfileCreatedDataSchema = v2BookerProfileCreatedDataNode.zod;

export const v2BookerProfileDeleteInputNode = contractNode(v2ExpectedRevisionInputNode.zod, {
  ...v2ExpectedRevisionInputNode.jsonSchema, title: 'V2BookerProfileDeleteInput',
});
export const v2BookerProfileDeleteInputSchema = v2BookerProfileDeleteInputNode.zod;

export const v2BookerProfileDeletedDataNode = objectNode({
  profileId: v2UuidNode,
  state: contractNode(contractLiteral('deleted'), { type: 'string', const: 'deleted' }),
  deletedAt: v2InstantNode,
}, { title: 'V2BookerProfileDeletedData', description: 'A parsed acknowledgement does not prove atomic dependent-policy invalidation or PII removal.' });
export const v2BookerProfileDeletedDataSchema = v2BookerProfileDeletedDataNode.zod;

export const v2MandateRevokeInputNode = contractNode(v2ExpectedRevisionInputNode.zod, {
  ...v2ExpectedRevisionInputNode.jsonSchema, title: 'V2MandateRevokeInput',
});
export const v2MandateRevokeInputSchema = v2MandateRevokeInputNode.zod;

export const v2MandateRevokedDataNode = objectNode({
  mandateId: v2UuidNode,
  revision: v2RevisionNode,
  state: contractNode(contractLiteral('revoked'), { type: 'string', const: 'revoked' }),
  revokedAt: v2InstantNode,
}, { title: 'V2MandateRevokedData' });
export const v2MandateRevokedDataSchema = v2MandateRevokedDataNode.zod;

const stepUpDifferenceNode = objectNode({
  field: contractNode(contractEnum(['host', 'meeting_type', 'meeting_window', 'duration']), {
    type: 'string', enum: ['host', 'meeting_type', 'meeting_window', 'duration'],
  }),
  proposed: contractNode(contractString({ minLength: 1 }), { type: 'string', minLength: 1 }),
  reviewed: contractNode(contractString({ minLength: 1 }), { type: 'string', minLength: 1 }),
});
const stepUpBookerNode = objectNode({ name: reviewedNameNode, email: emailNode });
// Split only the issuer-only fields, then reuse the complete snapshot parser so
// its strictness, normalization and microsecond order refinement stay shared.
const stepUpExactSummaryNode = contractNode(
  z.unknown().transform((value, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid step-up booking snapshot.' });
      return z.NEVER;
    }
    const { name, email, ...snapshot } = value as Record<string, unknown>;
    const summary = v2PreparedBookingSummaryNode.zod.safeParse(snapshot);
    const booker = stepUpBookerNode.zod.safeParse({ name, email });
    if (!summary.success || !booker.success) {
      ctx.addIssue({ code: 'custom', message: 'Invalid step-up booking snapshot.' });
      return z.NEVER;
    }
    return { ...summary.data, ...booker.data };
  }),
  {
    ...v2PreparedBookingSummaryNode.jsonSchema,
    title: 'V2StepUpExactSummary',
    description: 'Issuer-only recorded booking snapshot with reviewed name/email; never an actor response.',
    properties: {
      ...(v2PreparedBookingSummaryNode.jsonSchema.properties as Record<string, unknown>),
      name: reviewedNameNode.jsonSchema,
      email: emailNode.jsonSchema,
    },
    required: [...(v2PreparedBookingSummaryNode.jsonSchema.required as string[]), 'name', 'email'],
  },
);
export const v2StepUpReviewDataNode = objectNode({
  reviewId: v2UuidNode,
  revision: contractNode(contractLiteral(1), { type: 'integer', const: 1 }),
  state: contractNode(contractLiteral('pending'), { type: 'string', const: 'pending' }),
  summaryDigest: v2DigestNode,
  expiresAt: v2InstantNode,
  exactSummary: stepUpExactSummaryNode,
  differences: arrayNode(stepUpDifferenceNode, { minItems: 1, maxItems: 4 }),
}, {
  title: 'V2StepUpReviewData',
  description: 'Principal-only pending review snapshot. Parsing verifies no caller, ownership, live state or authority.',
});
export const v2StepUpReviewDataSchema = v2StepUpReviewDataNode.zod;

export const v2StepUpApproveInputNode = contractNode(v2MandateApproveInputNode.zod, {
  ...v2MandateApproveInputNode.jsonSchema,
  title: 'V2StepUpApproveInput',
  description: 'Exact reviewed revision and digest; approval and one-use replacement require a server transaction.',
});
export const v2StepUpApproveInputSchema = v2StepUpApproveInputNode.zod;

export const v2StepUpApprovedDataNode = objectNode({
  reviewId: v2UuidNode,
  state: contractNode(contractLiteral('approved'), { type: 'string', const: 'approved' }),
  preparationId: v2UuidNode,
  expiresAt: v2InstantNode,
}, {
  title: 'V2StepUpApprovedData',
  description: 'A new preparation, not a held slot. The server enforces the five-minute ceiling and live supporting authority.',
});
export const v2StepUpApprovedDataSchema = v2StepUpApprovedDataNode.zod;

export const v2StepUpRevokeInputNode = contractNode(v2ExpectedRevisionInputNode.zod, {
  ...v2ExpectedRevisionInputNode.jsonSchema, title: 'V2StepUpRevokeInput',
});
export const v2StepUpRevokeInputSchema = v2StepUpRevokeInputNode.zod;

export const v2StepUpRevokedDataNode = objectNode({
  reviewId: v2UuidNode,
  state: contractNode(contractLiteral('revoked'), { type: 'string', const: 'revoked' }),
  revision: v2RevisionNode,
  revokedAt: v2InstantNode,
}, { title: 'V2StepUpRevokedData' });
export const v2StepUpRevokedDataSchema = v2StepUpRevokedDataNode.zod;

export const v2ActorRevokedResponseNode = v2SuccessEnvelopeNode(v2ActorRevokedDataNode);
export const v2ActorRevokedResponseSchema = v2ActorRevokedResponseNode.zod;
export const v2BookerProfileCreatedResponseNode = v2SuccessEnvelopeNode(v2BookerProfileCreatedDataNode);
export const v2BookerProfileCreatedResponseSchema = v2BookerProfileCreatedResponseNode.zod;
export const v2BookerProfileDeletedResponseNode = v2SuccessEnvelopeNode(v2BookerProfileDeletedDataNode);
export const v2BookerProfileDeletedResponseSchema = v2BookerProfileDeletedResponseNode.zod;
export const v2MandateRevokedResponseNode = v2SuccessEnvelopeNode(v2MandateRevokedDataNode);
export const v2MandateRevokedResponseSchema = v2MandateRevokedResponseNode.zod;
export const v2StepUpReviewResponseNode = v2SuccessEnvelopeNode(v2StepUpReviewDataNode);
export const v2StepUpReviewResponseSchema = v2StepUpReviewResponseNode.zod;
export const v2StepUpApprovedResponseNode = v2SuccessEnvelopeNode(v2StepUpApprovedDataNode);
export const v2StepUpApprovedResponseSchema = v2StepUpApprovedResponseNode.zod;
export const v2StepUpRevokedResponseNode = v2SuccessEnvelopeNode(v2StepUpRevokedDataNode);
export const v2StepUpRevokedResponseSchema = v2StepUpRevokedResponseNode.zod;

export type V2ActorRegisterInput = z.infer<typeof v2ActorRegisterInputSchema>;
export type V2ExpectedRevisionInput = z.infer<typeof v2ExpectedRevisionInputSchema>;
export type V2ActorRevokeInput = z.infer<typeof v2ActorRevokeInputSchema>;
export type V2ActorRevokedData = z.infer<typeof v2ActorRevokedDataSchema>;
export type V2BookerProfileCreateInput = z.infer<typeof v2BookerProfileCreateInputSchema>;
export type V2BookerProfileCreatedData = z.infer<typeof v2BookerProfileCreatedDataSchema>;
export type V2BookerProfileDeleteInput = z.infer<typeof v2BookerProfileDeleteInputSchema>;
export type V2BookerProfileDeletedData = z.infer<typeof v2BookerProfileDeletedDataSchema>;
export type V2MandateRevokeInput = z.infer<typeof v2MandateRevokeInputSchema>;
export type V2MandateRevokedData = z.infer<typeof v2MandateRevokedDataSchema>;
export type V2StepUpReviewData = z.infer<typeof v2StepUpReviewDataSchema>;
export type V2StepUpReviewResponse = z.infer<typeof v2StepUpReviewResponseSchema>;
export type V2StepUpApproveInput = z.infer<typeof v2StepUpApproveInputSchema>;
export type V2StepUpApprovedData = z.infer<typeof v2StepUpApprovedDataSchema>;
export type V2StepUpRevokeInput = z.infer<typeof v2StepUpRevokeInputSchema>;
export type V2StepUpRevokedData = z.infer<typeof v2StepUpRevokedDataSchema>;
export type V2ActorRevokedResponse = z.infer<typeof v2ActorRevokedResponseSchema>;
export type V2BookerProfileCreatedResponse = z.infer<typeof v2BookerProfileCreatedResponseSchema>;
export type V2BookerProfileDeletedResponse = z.infer<typeof v2BookerProfileDeletedResponseSchema>;
export type V2MandateRevokedResponse = z.infer<typeof v2MandateRevokedResponseSchema>;
export type V2StepUpApprovedResponse = z.infer<typeof v2StepUpApprovedResponseSchema>;
export type V2StepUpRevokedResponse = z.infer<typeof v2StepUpRevokedResponseSchema>;
