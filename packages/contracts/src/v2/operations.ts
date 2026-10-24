import { z } from 'zod';

import {
  bookerNode,
  displayNameNode,
  emailNode,
  ianaTimeZoneNode,
  publicUsernameNode,
  requestIdNode,
  titleNode,
} from '../common.js';
import { contractLiteral, contractNode, contractNumber, contractString, objectNode, type ContractNode } from '../schema.js';
import {
  compareV2Instants,
  v2ContractVersionNode,
  v2DigestNode,
  v2InstantNode,
  v2InstantToEpochMicroseconds,
  v2RevisionNode,
  v2UuidNode,
} from './scalars.js';

/** Partial, unavailable v2 wire foundation. Parsing is not authentication or authority. */
const maxDurationMinutesNode = contractNode(contractNumber({ integer: true, minimum: 5, maximum: 1_440 }), {
  type: 'integer',
  minimum: 5,
  maximum: 1_440,
});
const reviewedNameNode = contractNode(
  bookerNode.shape.name,
  (bookerNode.jsonSchema.properties as Record<string, Record<string, unknown>>).name,
);
const maximumPermissionMicroseconds = 24n * 60n * 60n * 1_000_000n;
const issuanceShape = {
  actorId: v2UuidNode,
  profileId: v2UuidNode,
  profileRevision: v2RevisionNode,
  username: publicUsernameNode,
  meetingTypeId: v2UuidNode,
  meetingWindowStart: v2InstantNode,
  meetingWindowEnd: v2InstantNode,
  maxDurationMinutes: maxDurationMinutesNode,
  notBefore: v2InstantNode,
  expiresAt: v2InstantNode,
} as const;

const validateIssuanceTimes = (
  value: {
    meetingWindowStart: string;
    meetingWindowEnd: string;
    notBefore: string;
    expiresAt: string;
  },
  context: z.RefinementCtx,
): void => {
  // Scalar parsing may already have failed. Do not throw from a refinement on malformed input.
  const instants = [
    value.meetingWindowStart,
    value.meetingWindowEnd,
    value.notBefore,
    value.expiresAt,
  ];
  if (!instants.every((value) => v2InstantNode.zod.safeParse(value).success)) return;
  if (compareV2Instants(value.meetingWindowEnd, value.meetingWindowStart) <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['meetingWindowEnd'],
      message: 'meetingWindowEnd must be later than meetingWindowStart.',
    });
  }
  const lifetime = v2InstantToEpochMicroseconds(value.expiresAt) -
    v2InstantToEpochMicroseconds(value.notBefore);
  if (lifetime <= 0n || lifetime > maximumPermissionMicroseconds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'expiresAt must be after notBefore and at most 24 hours later.',
    });
  }
};
const issuanceRefinements = [
  'meetingWindowEnd > meetingWindowStart, compared without losing microsecond precision.',
  '0 < expiresAt - notBefore <= 24 hours; issuedAt and live credential/profile bounds require server validation.',
] as const;

const v2MandateReviewInputBaseNode = objectNode(issuanceShape, {
  title: 'V2MandateReviewInput',
  description: 'Principal-only review input; object ownership is verified by the server.',
});
export const v2MandateReviewInputNode = contractNode(
  v2MandateReviewInputBaseNode.zod.superRefine(validateIssuanceTimes),
  {
    ...v2MandateReviewInputBaseNode.jsonSchema,
    'x-project-s-refinements': issuanceRefinements,
  },
);
export const v2MandateReviewInputSchema = v2MandateReviewInputNode.zod;

const v2MandatePolicySummaryBaseNode = objectNode({
  ...issuanceShape,
  name: reviewedNameNode,
  email: emailNode,
  guestTimeZone: ianaTimeZoneNode,
  hostDisplayName: displayNameNode,
  meetingTypeTitle: titleNode,
}, { title: 'V2MandatePolicySummary', description: 'Principal-only normalized policy review, including reviewed profile data.' });
export const v2MandatePolicySummaryNode = contractNode(
  v2MandatePolicySummaryBaseNode.zod.superRefine(validateIssuanceTimes),
  {
    ...v2MandatePolicySummaryBaseNode.jsonSchema,
    'x-project-s-refinements': issuanceRefinements,
  },
);
export const v2MandatePolicySummarySchema = v2MandatePolicySummaryNode.zod;

export const v2MandateReviewDataNode = objectNode({
  reviewId: v2UuidNode,
  revision: v2RevisionNode,
  summaryDigest: v2DigestNode,
  expiresAt: v2InstantNode,
  policySummary: v2MandatePolicySummaryNode,
}, { title: 'V2MandateReviewData' });
export const v2MandateReviewDataSchema = v2MandateReviewDataNode.zod;

export const v2MandateApproveInputNode = objectNode({
  expectedRevision: v2RevisionNode,
  summaryDigest: v2DigestNode,
}, { title: 'V2MandateApproveInput' });
export const v2MandateApproveInputSchema = v2MandateApproveInputNode.zod;

const v2MandateApprovedDataBaseNode = objectNode({
  mandateId: v2UuidNode,
  revision: v2RevisionNode,
  state: contractNode(contractLiteral('active'), { type: 'string', const: 'active' }),
  issuedAt: v2InstantNode,
  expiresAt: v2InstantNode,
}, { title: 'V2MandateApprovedData' });
export const v2MandateApprovedDataNode = contractNode(
  v2MandateApprovedDataBaseNode.zod.refine(({ issuedAt, expiresAt }) => {
    if (!v2InstantNode.zod.safeParse(issuedAt).success ||
        !v2InstantNode.zod.safeParse(expiresAt).success) return true;
    const lifetime = v2InstantToEpochMicroseconds(expiresAt) -
      v2InstantToEpochMicroseconds(issuedAt);
    return lifetime > 0n && lifetime <= maximumPermissionMicroseconds;
  }, { message: 'expiresAt must be after issuedAt and at most 24 hours later.', path: ['expiresAt'] }),
  {
    ...v2MandateApprovedDataBaseNode.jsonSchema,
    'x-project-s-refinements': ['0 < expiresAt - issuedAt <= 24 hours, compared without losing microsecond precision.'],
  },
);
export const v2MandateApprovedDataSchema = v2MandateApprovedDataNode.zod;

export const v2PrepareBookingInputNode = objectNode({
  mandateId: v2UuidNode,
  username: publicUsernameNode,
  meetingTypeId: v2UuidNode,
  startAt: v2InstantNode,
}, { title: 'V2PrepareBookingInput', description: 'Actor input; caller identity and duration are server-derived.' });
export const v2PrepareBookingInputSchema = v2PrepareBookingInputNode.zod;

const bookingSummaryShape = {
  username: publicUsernameNode,
  meetingTypeId: v2UuidNode,
  meetingTypeTitle: titleNode,
  startAt: v2InstantNode,
  endAt: v2InstantNode,
  hostTimeZone: ianaTimeZoneNode,
  guestTimeZone: ianaTimeZoneNode,
} as const;
const validMeetingOrder = ({ startAt, endAt }: { startAt: string; endAt: string }): boolean => {
  if (!v2InstantNode.zod.safeParse(startAt).success ||
      !v2InstantNode.zod.safeParse(endAt).success) return true;
  return compareV2Instants(endAt, startAt) > 0;
};
const meetingOrderRefinements = [
  'endAt > startAt, compared without losing microsecond precision; actual duration and availability require server validation.',
] as const;
const v2PreparedBookingSummaryBaseNode = objectNode({
  ...bookingSummaryShape,
  hostDisplayName: displayNameNode,
}, { title: 'V2PreparedBookingSummary', description: 'Actor-visible summary excludes reviewed profile PII and policy bounds.' });
export const v2PreparedBookingSummaryNode = contractNode(
  v2PreparedBookingSummaryBaseNode.zod.refine(validMeetingOrder, {
    message: 'endAt must be later than startAt.', path: ['endAt'],
  }),
  { ...v2PreparedBookingSummaryBaseNode.jsonSchema, 'x-project-s-refinements': meetingOrderRefinements },
);
export const v2PreparedBookingSummarySchema = v2PreparedBookingSummaryNode.zod;

export const v2PrepareBookingDataNode = objectNode({
  preparationId: v2UuidNode,
  expiresAt: v2InstantNode,
  notHeld: contractNode(contractLiteral(true), { type: 'boolean', const: true }),
  summaryDigest: v2DigestNode,
  summary: v2PreparedBookingSummaryNode,
}, { title: 'V2PrepareBookingData' });
export const v2PrepareBookingDataSchema = v2PrepareBookingDataNode.zod;

export const v2CreateBookingInputNode = objectNode({
  preparationId: v2UuidNode,
  idempotencyKey: v2UuidNode,
}, { title: 'V2CreateBookingInput', description: 'Authenticated object references, not bearer preparation tokens.' });
export const v2CreateBookingInputSchema = v2CreateBookingInputNode.zod;

const v2BookingBaseNode = objectNode({
  ...bookingSummaryShape,
  confirmationCode: contractNode(contractString({ minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9_-]+$/ }), {
    type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$',
  }),
  status: contractNode(contractLiteral('confirmed'), { type: 'string', const: 'confirmed' }),
}, { title: 'V2Booking', description: 'Minimal actor booking result; no idempotency key, policy bounds or profile PII.' });
export const v2BookingNode = contractNode(
  v2BookingBaseNode.zod.refine(validMeetingOrder, {
    message: 'endAt must be later than startAt.', path: ['endAt'],
  }),
  { ...v2BookingBaseNode.jsonSchema, 'x-project-s-refinements': meetingOrderRefinements },
);
export const v2BookingSchema = v2BookingNode.zod;

export const v2BookingReceiptDataNode = objectNode({
  receiptId: v2UuidNode,
  receiptExpiresAt: v2InstantNode,
  booking: v2BookingNode,
}, { title: 'V2BookingReceiptData' });
export const v2BookingReceiptDataSchema = v2BookingReceiptDataNode.zod;

export const v2SuccessEnvelopeNode = <TSchema extends z.ZodType>(
  data: ContractNode<TSchema>,
) => objectNode({
  contractVersion: v2ContractVersionNode,
  requestId: requestIdNode,
  data,
}, { title: 'V2SuccessEnvelope' });

export const v2MandateReviewResponseNode = v2SuccessEnvelopeNode(v2MandateReviewDataNode);
export const v2MandateReviewResponseSchema = v2MandateReviewResponseNode.zod;
export const v2MandateApprovedResponseNode = v2SuccessEnvelopeNode(v2MandateApprovedDataNode);
export const v2MandateApprovedResponseSchema = v2MandateApprovedResponseNode.zod;
export const v2PrepareBookingResponseNode = v2SuccessEnvelopeNode(v2PrepareBookingDataNode);
export const v2PrepareBookingResponseSchema = v2PrepareBookingResponseNode.zod;
export const v2CreateBookingResponseNode = v2SuccessEnvelopeNode(v2BookingReceiptDataNode);
export const v2CreateBookingResponseSchema = v2CreateBookingResponseNode.zod;

export type V2MandateReviewInput = z.infer<typeof v2MandateReviewInputSchema>;
export type V2MandatePolicySummary = z.infer<typeof v2MandatePolicySummarySchema>;
export type V2MandateReviewData = z.infer<typeof v2MandateReviewDataSchema>;
export type V2MandateApproveInput = z.infer<typeof v2MandateApproveInputSchema>;
export type V2MandateApprovedData = z.infer<typeof v2MandateApprovedDataSchema>;
export type V2PrepareBookingInput = z.infer<typeof v2PrepareBookingInputSchema>;
export type V2PreparedBookingSummary = z.infer<typeof v2PreparedBookingSummarySchema>;
export type V2PrepareBookingData = z.infer<typeof v2PrepareBookingDataSchema>;
export type V2CreateBookingInput = z.infer<typeof v2CreateBookingInputSchema>;
export type V2Booking = z.infer<typeof v2BookingSchema>;
export type V2BookingReceiptData = z.infer<typeof v2BookingReceiptDataSchema>;
export type V2MandateReviewResponse = z.infer<typeof v2MandateReviewResponseSchema>;
export type V2MandateApprovedResponse = z.infer<typeof v2MandateApprovedResponseSchema>;
export type V2PrepareBookingResponse = z.infer<typeof v2PrepareBookingResponseSchema>;
export type V2CreateBookingResponse = z.infer<typeof v2CreateBookingResponseSchema>;
