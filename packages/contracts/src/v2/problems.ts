import { z } from 'zod';

import {
  httpsOrLocalUrlNode,
  projectSProblemCodeSchema,
  projectSProblemNode,
  requestIdNode,
  retryActionSchema,
} from '../common.js';
import {
  arrayNode,
  contractNode,
  objectNode,
  optionalNode,
  type JsonSchema,
} from '../schema.js';
import {
  compareV2Instants,
  v2ContractVersionNode,
  v2InstantNode,
  v2UuidNode,
  v2UuidSchema,
} from './scalars.js';

// Reuse the reviewed field validators without extending the v1 code enum or
// changing any v1 parser/artifact. V2 escalation uses issuer-reviewed step-up;
// browser confirmation must never select or imply the legacy v1 provider.
export const v2ProblemCodes = [
  ...projectSProblemCodeSchema.exclude(['CONFIRMATION_REQUIRED']).options,
  'STEP_UP_REQUIRED',
  'MANDATE_EXPIRED',
  'RECEIPT_UNAVAILABLE',
  'AUTHORITY_BUSY',
] as const;
export const v2ProblemCodeNode = contractNode(z.enum(v2ProblemCodes), {
  type: 'string',
  enum: [...v2ProblemCodes],
});
export const v2ProblemCodeSchema = v2ProblemCodeNode.zod;

const v1Properties = projectSProblemNode.jsonSchema.properties as Record<string, JsonSchema>;
const v1Shape = projectSProblemNode.zod.shape;
const v2RetryActionSchema = retryActionSchema.exclude(['confirm_in_browser']);
const retryNode = contractNode(
  v1Shape.retry.unwrap().extend({ action: v2RetryActionSchema }),
  {
    ...v1Properties.retry,
    properties: {
      ...(v1Properties.retry.properties as Record<string, JsonSchema>),
      action: { type: 'string', enum: [...v2RetryActionSchema.options] },
    },
  },
);
// A clean URL parse gates the existing v1 scheme refinement, which assumes a
// parseable URL. Invalid v2 wire input must report issues rather than throw.
const safePublicUrlSchema = z.string().url().pipe(httpsOrLocalUrlNode.zod);

const reviewUrlParts = (value: string): { url: URL; reviewId: string } | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const match = /^#review=([A-Fa-f0-9-]{36})(?![\s\S])/.exec(url.hash);
  if (!match || !v2UuidSchema.safeParse(match[1]).success) return undefined;
  // Equality rejects URL-parser repairs, encoded/dot path variants, userinfo,
  // empty query markers and extra fragment data instead of silently stripping it.
  if (value !== `${url.origin}/authority/review${url.hash}`) return undefined;
  return { url, reviewId: match[1].toLowerCase() };
};

export const v2StepUpReviewUrlNode = contractNode(
  safePublicUrlSchema
    .refine((value) => reviewUrlParts(value) !== undefined,
      'Expected an exact authority review URL with one opaque review UUID.')
    .transform((value) => {
      const parts = reviewUrlParts(value)!;
      return `${parts.url.origin}/authority/review#review=${parts.reviewId}`;
    }),
  {
    ...httpsOrLocalUrlNode.jsonSchema,
    description: 'An HTTPS (or HTTP loopback) authority review reference only. The server '
      + 'must independently verify its configured same origin before returning or following '
      + 'this URL; parsing an arbitrary HTTPS origin does not authorize it. The reference '
      + 'grants no access without principal authentication.',
    'x-project-s-normalization': 'lowercase-review-uuid',
    'x-project-s-semantic-validation': ['exact-authority-review-path-and-fragment'],
    'x-project-s-server-validation': ['configured-same-origin'],
  },
);
export const v2StepUpReviewUrlSchema = v2StepUpReviewUrlNode.zod;

const stepUpShapeNode = objectNode({
  expiresAt: v2InstantNode,
  reviewId: v2UuidNode,
  reviewUrl: v2StepUpReviewUrlNode,
}, { title: 'V2ProblemStepUp' });
export const v2ProblemStepUpNode = contractNode(
  stepUpShapeNode.zod.refine((value) => reviewUrlParts(value.reviewUrl)?.reviewId === value.reviewId, {
    message: 'Review URL must reference the same review ID.',
    path: ['reviewUrl'],
  }),
  {
    ...stepUpShapeNode.jsonSchema,
    'x-project-s-semantic-validation': ['review-url-matches-review-id'],
  },
);
export const v2ProblemStepUpSchema = v2ProblemStepUpNode.zod;

const alternativeShapeNode = objectNode({
  endAt: v2InstantNode,
  startAt: v2InstantNode,
}, { title: 'V2ProblemAlternative' });
export const v2ProblemAlternativeNode = contractNode(
  alternativeShapeNode.zod.refine((value) => {
    try {
      return compareV2Instants(value.endAt, value.startAt) > 0;
    } catch {
      return false;
    }
  }, {
    message: 'Alternative end must be after its start.',
    path: ['endAt'],
  }),
  {
    ...alternativeShapeNode.jsonSchema,
    'x-project-s-semantic-validation': ['end-after-start-at-microsecond-precision'],
  },
);
export const v2ProblemAlternativeSchema = v2ProblemAlternativeNode.zod;

const requiredStatus = {
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  SLOT_UNAVAILABLE: 409,
  STEP_UP_REQUIRED: 428,
  MANDATE_EXPIRED: 410,
  RECEIPT_UNAVAILABLE: 410,
  AUTHORITY_BUSY: 503,
} as const;

const problemShapeNode = objectNode({
  alternatives: optionalNode(arrayNode(v2ProblemAlternativeNode, { maxItems: 3 })),
  code: v2ProblemCodeNode,
  detail: contractNode(v1Shape.detail, v1Properties.detail),
  fieldErrors: optionalNode(contractNode(v1Shape.fieldErrors.unwrap(), v1Properties.fieldErrors)),
  requestId: requestIdNode,
  retry: optionalNode(retryNode),
  status: contractNode(v1Shape.status, v1Properties.status),
  stepUp: optionalNode(v2ProblemStepUpNode),
  title: contractNode(v1Shape.title, v1Properties.title),
  type: contractNode(safePublicUrlSchema, httpsOrLocalUrlNode.jsonSchema),
}, {
  title: 'V2Problem',
  description: 'A bounded public refusal. Producers must redact secrets, identity details, '
    + 'upstream diagnostics and other actors\' policy from free-form text; the schema cannot '
    + 'establish that text is safe. Provider failure never authorizes a v1 fallback.',
});

export const v2ProblemNode = contractNode(
  problemShapeNode.zod.superRefine((value, context) => {
    const expectedStatus = requiredStatus[value.code as keyof typeof requiredStatus];
    if (expectedStatus !== undefined && value.status !== expectedStatus) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'],
        message: `Status must be ${expectedStatus} for ${value.code}.` });
    }
    if ((value.code === 'STEP_UP_REQUIRED') !== (value.stepUp !== undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['stepUp'],
        message: 'Step-up is required only for STEP_UP_REQUIRED.' });
    }
    if (value.code === 'AUTHORITY_BUSY'
      && (value.retry?.action !== 'retry_after' || value.retry.afterSeconds !== 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['retry'],
        message: 'AUTHORITY_BUSY requires retry_after with afterSeconds exactly 1.' });
    }
  }),
  {
    ...problemShapeNode.jsonSchema,
    allOf: [
      ...Object.entries(requiredStatus).map(([code, status]) => ({
        if: { properties: { code: { const: code } }, required: ['code'] },
        then: { properties: { status: { const: status } } },
      })),
      {
        if: { properties: { code: { const: 'STEP_UP_REQUIRED' } }, required: ['code'] },
        then: { required: ['stepUp'] },
        else: { not: { required: ['stepUp'] } },
      },
      {
        if: { properties: { code: { const: 'AUTHORITY_BUSY' } }, required: ['code'] },
        then: {
          required: ['retry'],
          properties: { retry: { properties: {
            action: { const: 'retry_after' }, afterSeconds: { const: 1 },
          }, required: ['action', 'afterSeconds'] } },
        },
      },
    ],
  },
);
export const v2ProblemSchema = v2ProblemNode.zod;

const envelopeShapeNode = objectNode({
  contractVersion: v2ContractVersionNode,
  error: v2ProblemNode,
  requestId: requestIdNode,
}, { title: 'V2ProblemEnvelope' });
export const v2ProblemEnvelopeNode = contractNode(
  envelopeShapeNode.zod.refine((value) => value.requestId === value.error.requestId, {
    message: 'Envelope and problem request IDs must match.',
    path: ['error', 'requestId'],
  }),
  {
    ...envelopeShapeNode.jsonSchema,
    'x-project-s-semantic-validation': ['outer-and-inner-request-ids-match'],
  },
);
export const v2ProblemEnvelopeSchema = v2ProblemEnvelopeNode.zod;

export type V2ProblemCode = z.infer<typeof v2ProblemCodeSchema>;
export type V2StepUpReviewUrl = z.infer<typeof v2StepUpReviewUrlSchema>;
export type V2ProblemStepUp = z.infer<typeof v2ProblemStepUpSchema>;
export type V2ProblemAlternative = z.infer<typeof v2ProblemAlternativeSchema>;
export type V2Problem = z.infer<typeof v2ProblemSchema>;
export type V2ProblemEnvelope = z.infer<typeof v2ProblemEnvelopeSchema>;
