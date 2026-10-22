import { describe, expect, expectTypeOf, it } from 'vitest';

import { projectSProblemCodeSchema, projectSProblemEnvelopeSchema } from '../src/common.js';
import {
  v2ProblemAlternativeSchema,
  v2ProblemCodeSchema,
  v2ProblemEnvelopeNode,
  v2ProblemEnvelopeSchema,
  v2ProblemNode,
  v2ProblemSchema,
  v2ProblemStepUpSchema,
  v2StepUpReviewUrlNode,
  v2StepUpReviewUrlSchema,
  type V2Problem,
  type V2ProblemEnvelope,
} from '../src/v2/problems.js';

const reviewId = '44444444-4444-4444-8444-444444444444';
const otherReviewId = '55555555-5555-4555-8555-555555555555';
const requestId = 'request-v2-problems';
const problem = {
  code: 'FORBIDDEN',
  status: 403,
  type: 'https://project-s.example/problems/forbidden',
  title: 'Permission unavailable',
  detail: 'The requested operation is not permitted.',
  requestId,
} as const;
const stepUp = {
  reviewId,
  reviewUrl: `https://project-s.example/authority/review#review=${reviewId}`,
  expiresAt: '2026-11-02T13:05:00.000001Z',
};
const envelope = { contractVersion: 2, requestId, error: problem } as const;

describe('strict v2 problem outcomes', () => {
  it('keeps the v1 code enum and versioned envelope unchanged', () => {
    expect(projectSProblemCodeSchema.safeParse('FORBIDDEN').success).toBe(true);
    for (const code of ['STEP_UP_REQUIRED', 'MANDATE_EXPIRED', 'RECEIPT_UNAVAILABLE', 'AUTHORITY_BUSY']) {
      expect(v2ProblemCodeSchema.safeParse(code).success).toBe(true);
      expect(projectSProblemCodeSchema.safeParse(code).success).toBe(false);
    }
    expect(projectSProblemEnvelopeSchema.parse({ ...envelope, contractVersion: 1 }).error).toEqual(problem);
    expect(projectSProblemEnvelopeSchema.safeParse(envelope).success).toBe(false);
    expect(v2ProblemEnvelopeSchema.safeParse({ ...envelope, contractVersion: 1 }).success).toBe(false);
    expect(v2ProblemCodeSchema.safeParse('PROVIDER_FALLBACK').success).toBe(false);
  });

  it('exports typed exact version-2 problems', () => {
    const parsed = v2ProblemEnvelopeSchema.parse(envelope);
    expectTypeOf(parsed).toEqualTypeOf<V2ProblemEnvelope>();
    expectTypeOf(parsed.error).toEqualTypeOf<V2Problem>();
    expect(parsed).toEqual(envelope);
  });

  it('refuses the legacy browser-confirmation code and action while preserving v1', () => {
    const legacyConfirmation = { ...problem, code: 'CONFIRMATION_REQUIRED', status: 428,
      retry: { action: 'confirm_in_browser' } };
    expect(projectSProblemEnvelopeSchema.safeParse({ contractVersion: 1, requestId,
      error: legacyConfirmation }).success).toBe(true);
    expect(v2ProblemCodeSchema.safeParse('CONFIRMATION_REQUIRED').success).toBe(false);
    expect(v2ProblemSchema.safeParse(legacyConfirmation).success).toBe(false);
    expect(v2ProblemSchema.safeParse({ ...problem, retry: { action: 'confirm_in_browser' } }).success)
      .toBe(false);
    expect(v2ProblemSchema.safeParse({ ...problem, code: 'STEP_UP_REQUIRED', status: 428,
      stepUp, retry: { action: 'confirm_in_browser' } }).success).toBe(false);

    const properties = v2ProblemNode.jsonSchema.properties as Record<string, {
      enum?: string[]; properties?: Record<string, { enum: string[] }>;
    }>;
    expect(properties.code.enum).not.toContain('CONFIRMATION_REQUIRED');
    expect(properties.retry.properties?.action.enum).not.toContain('confirm_in_browser');
  });

  it.each(['choose_alternative', 'prepare_again', 'retry', 'retry_after', 'contact_support'])(
    'retains applicable v1 retry action %s', (action) => {
      expect(v2ProblemSchema.parse({ ...problem, retry: { action, afterSeconds: 1 } }).retry?.action)
        .toBe(action);
    },
  );

  it.each([
    ['AUTHENTICATION_REQUIRED', 401], ['FORBIDDEN', 403], ['SLOT_UNAVAILABLE', 409],
    ['STEP_UP_REQUIRED', 428], ['MANDATE_EXPIRED', 410], ['RECEIPT_UNAVAILABLE', 410],
    ['AUTHORITY_BUSY', 503],
  ] as const)('enforces the reviewed %s status %i', (code, status) => {
    const value = { ...problem, code, status,
      ...(code === 'STEP_UP_REQUIRED' ? { stepUp } : {}),
      ...(code === 'AUTHORITY_BUSY' ? { retry: { action: 'retry_after', afterSeconds: 1 } } : {}),
    };
    expect(v2ProblemSchema.safeParse(value).success).toBe(true);
    expect(v2ProblemSchema.safeParse({ ...value, status: status === 503 ? 500 : 503 }).success).toBe(false);
  });

  it.each([
    undefined,
    { action: 'retry' },
    { action: 'retry_after' },
    { action: 'retry_after', afterSeconds: 0 },
    { action: 'retry_after', afterSeconds: 2 },
    { action: 'retry_after', afterSeconds: 1, credentialId: reviewId },
  ])('refuses AUTHORITY_BUSY without its exact same-identity retry hint (%j)', (retry) => {
    expect(v2ProblemSchema.safeParse({ ...problem, code: 'AUTHORITY_BUSY', status: 503, retry }).success)
      .toBe(false);
  });

  it('requires step-up for 428 and prohibits it on all other outcomes', () => {
    expect(v2ProblemSchema.safeParse({ ...problem, code: 'STEP_UP_REQUIRED', status: 428 }).success).toBe(false);
    for (const code of ['FORBIDDEN', 'AUTHENTICATION_REQUIRED', 'MANDATE_EXPIRED', 'RECEIPT_UNAVAILABLE']) {
      expect(v2ProblemSchema.safeParse({ ...problem, code, stepUp }).success).toBe(false);
    }
  });

  it('does not rewrite validation failures, provider failures or busy outcomes into step-up', () => {
    for (const [code, status] of [['VALIDATION_ERROR', 400], ['INTERNAL_ERROR', 500], ['RATE_LIMITED', 429]]) {
      expect(v2ProblemSchema.parse({ ...problem, code, status }).code).toBe(code);
    }
  });

  it('requires identical outer and inner request IDs', () => {
    expect(v2ProblemEnvelopeSchema.safeParse({ ...envelope, requestId: 'request-another-call' }).success).toBe(false);
  });

  it('reports malformed URLs and nested input as validation failures without throwing', () => {
    for (const type of ['not a URL', '/relative', 'http://', '', 42, null]) {
      expect(v2ProblemSchema.safeParse({ ...problem, type }).success).toBe(false);
    }
    for (const value of [null, [], 'private', 42]) {
      expect(v2ProblemEnvelopeSchema.safeParse({ ...envelope, error: value }).success).toBe(false);
      expect(v2ProblemSchema.safeParse({ ...problem, retry: value }).success).toBe(false);
      expect(v2ProblemSchema.safeParse({ ...problem, alternatives: [value] }).success).toBe(false);
    }
  });

  it.each(['principalId', 'actorId', 'credentialId', 'subjectId', 'diagnostics', 'stack', 'accessToken'])(
    'refuses unexpected %s in the problem or envelope', (field) => {
      expect(v2ProblemSchema.safeParse({ ...problem, [field]: 'private' }).success).toBe(false);
      expect(v2ProblemEnvelopeSchema.safeParse({ ...envelope, [field]: 'private' }).success).toBe(false);
    },
  );

  it('preserves strict bounded v1 field-error and retry validators', () => {
    const fieldError = { code: 'INVALID', message: 'Invalid value.', path: '/startAt' };
    expect(v2ProblemSchema.parse({ ...problem, fieldErrors: [fieldError],
      retry: { action: 'prepare_again' } }).fieldErrors).toEqual([fieldError]);
    expect(v2ProblemSchema.safeParse({ ...problem, fieldErrors: Array(33).fill(fieldError) }).success).toBe(false);
    expect(v2ProblemSchema.safeParse({ ...problem, fieldErrors: [{ ...fieldError, email: 'private' }] }).success)
      .toBe(false);
    expect(v2ProblemSchema.safeParse({ ...problem, retry: { action: 'auto_authorize' } }).success).toBe(false);
    expect(v2ProblemSchema.safeParse({ ...problem, retry: { action: 'retry_after', afterSeconds: 86_401 } }).success)
      .toBe(false);
  });

  it('describes executable JSON Schema conditionals and runtime-only equality checks', () => {
    expect(v2ProblemNode.jsonSchema.allOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ then: { required: ['stepUp'] }, else: { not: { required: ['stepUp'] } } }),
      expect.objectContaining({ then: expect.objectContaining({ required: ['retry'] }) }),
    ]));
    expect(v2ProblemEnvelopeNode.jsonSchema['x-project-s-semantic-validation'])
      .toEqual(['outer-and-inner-request-ids-match']);
  });
});

describe('opaque v2 step-up review references', () => {
  it.each(['https://project-s.example', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'accepts a reviewed path at %s without treating its origin as authorization', (origin) => {
      const reviewUrl = `${origin}/authority/review#review=${reviewId}`;
      expect(v2ProblemStepUpSchema.parse({ ...stepUp, reviewUrl }).reviewUrl).toBe(reviewUrl);
    },
  );

  it('normalizes the same uppercase opaque UUID in the URL and review ID', () => {
    const upperId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    expect(v2ProblemStepUpSchema.parse({ ...stepUp, reviewId: upperId,
      reviewUrl: `https://project-s.example/authority/review#review=${upperId}` })).toEqual({
      ...stepUp, reviewId: upperId.toLowerCase(),
      reviewUrl: `https://project-s.example/authority/review#review=${upperId.toLowerCase()}`,
    });
  });

  it('rejects a valid opaque reference for a different review', () => {
    expect(v2ProblemStepUpSchema.safeParse({ ...stepUp,
      reviewUrl: `https://project-s.example/authority/review#review=${otherReviewId}` }).success).toBe(false);
  });

  it('marks configured-origin verification as a server obligation beyond URL parsing', () => {
    const arbitraryOrigin = `https://untrusted.example/authority/review#review=${reviewId}`;
    expect(v2StepUpReviewUrlSchema.parse(arbitraryOrigin)).toBe(arbitraryOrigin);
    expect(v2StepUpReviewUrlNode.jsonSchema['x-project-s-server-validation'])
      .toEqual(['configured-same-origin']);
  });

  it.each([
    `http://project-s.example/authority/review#review=${reviewId}`,
    `https://user:password@example.com/authority/review#review=${reviewId}`,
    `https://project-s.example/authority/review?token=secret#review=${reviewId}`,
    `https://project-s.example/authority/review?#review=${reviewId}`,
    `https://project-s.example/authority/review#review=${reviewId}&token=secret`,
    `https://project-s.example/authority/review#review=${reviewId}\n`,
    `https://project-s.example/authority/../authority/review#review=${reviewId}`,
    `https://project-s.example/authority/%72eview#review=${reviewId}`,
    `https://project-s.example/authority/review/#review=${reviewId}`,
    `https://project-s.example/another/path#review=${reviewId}`,
    `https://project-s.example/authority/review#review=not-a-uuid`,
    `/authority/review#review=${reviewId}`,
  ])('rejects extra data, alternate paths and unsafe schemes in %s', (reviewUrl) => {
    expect(v2StepUpReviewUrlSchema.safeParse(reviewUrl).success).toBe(false);
  });

  it('keeps principal identity, approval state and credential fields out of the reference', () => {
    for (const field of ['principalId', 'credentialId', 'approved', 'token']) {
      expect(v2ProblemStepUpSchema.safeParse({ ...stepUp, [field]: 'private' }).success).toBe(false);
    }
  });
});

describe('bounded lossless v2 alternatives', () => {
  const alternative = { startAt: '2026-11-02T10:00:00.000001-03:00', endAt: '2026-11-02T13:00:00.000002Z' };

  it('preserves a one-microsecond positive slot across offsets', () => {
    expect(v2ProblemAlternativeSchema.parse(alternative)).toEqual({
      startAt: '2026-11-02T13:00:00.000001Z', endAt: '2026-11-02T13:00:00.000002Z',
    });
  });

  it('refuses equal or reversed microsecond bounds', () => {
    expect(v2ProblemAlternativeSchema.safeParse({ ...alternative, endAt: '2026-11-02T13:00:00.000001Z' }).success)
      .toBe(false);
    expect(v2ProblemAlternativeSchema.safeParse({ ...alternative, endAt: '2026-11-02T13:00:00.000000Z' }).success)
      .toBe(false);
  });

  it('accepts at most three alternatives and rejects identity data in each slot', () => {
    expect(v2ProblemSchema.parse({ ...problem, alternatives: Array(3).fill(alternative) }).alternatives)
      .toHaveLength(3);
    expect(v2ProblemSchema.safeParse({ ...problem, alternatives: Array(4).fill(alternative) }).success).toBe(false);
    expect(v2ProblemSchema.safeParse({ ...problem, alternatives: [{ ...alternative, principalId: reviewId }] }).success)
      .toBe(false);
  });

  it('refuses malformed calendar values and excess precision rather than rounding them', () => {
    for (const startAt of ['2026-02-30T12:00:00Z', '2026-11-02T13:00:00.0000001Z']) {
      expect(v2ProblemAlternativeSchema.safeParse({ ...alternative, startAt }).success).toBe(false);
    }
  });
});
