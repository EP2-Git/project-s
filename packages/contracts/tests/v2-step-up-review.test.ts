import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  v2StepUpReviewDataNode,
  v2StepUpReviewDataSchema,
  v2StepUpReviewResponseSchema,
  type V2StepUpReviewData,
  type V2StepUpReviewResponse,
} from '../src/v2/controls.js';
import { v2PreparedBookingSummarySchema } from '../src/v2/operations.js';

const review = {
  reviewId: 'ABCDEF12-1111-4111-8111-111111111111',
  revision: 1,
  state: 'pending',
  summaryDigest: 'a'.repeat(64),
  expiresAt: '2026-11-19T10:04:00.000001-03:00',
  exactSummary: {
    username: 'example-host',
    hostDisplayName: 'Example Host',
    meetingTypeId: 'ABCDEF12-2222-4222-8222-222222222222',
    meetingTypeTitle: 'A conversation',
    startAt: '2026-11-20T10:00:00.000001-03:00',
    endAt: '2026-11-20T10:30:00.000001-03:00',
    hostTimeZone: 'America/Halifax',
    guestTimeZone: 'US/Eastern',
    name: '  Example Guest  ',
    email: ' Guest@Example.COM ',
  },
  differences: [{ field: 'duration', proposed: '30 minutes', reviewed: '15 minutes' }],
};

describe('unavailable v2 principal-only step-up review response', () => {
  it('retains the booking snapshot normalization and adds reviewed profile fields', () => {
    const actual = v2StepUpReviewDataSchema.parse(review);
    const { name: _name, email: _email, ...actorSummary } = review.exactSummary;
    expect(actual).toEqual({
      ...review,
      reviewId: review.reviewId.toLowerCase(),
      expiresAt: '2026-11-19T13:04:00.000001Z',
      exactSummary: {
        ...v2PreparedBookingSummarySchema.parse(actorSummary),
        name: 'Example Guest',
        email: 'guest@example.com',
      },
    });
    expect(actual.exactSummary.guestTimeZone).toBe('US/Eastern');
  });

  it('requires every reviewed field and refuses an actor-only snapshot', () => {
    for (const field of Object.keys(review)) {
      const data: Record<string, unknown> = { ...review };
      delete data[field];
      expect(v2StepUpReviewDataSchema.safeParse(data).success, field).toBe(false);
    }
    for (const field of Object.keys(review.exactSummary)) {
      const exactSummary: Record<string, unknown> = { ...review.exactSummary };
      delete exactSummary[field];
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, exactSummary }).success, field).toBe(false);
    }
    for (const exactSummary of [null, [], 'snapshot']) {
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, exactSummary }).success).toBe(false);
    }
  });

  it('exposes only the existing pending revision, without inventing terminal states', () => {
    for (const state of ['approved', 'revoked', 'expired', 'declined', 'consumed', null, true]) {
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, state }).success).toBe(false);
    }
    for (const revision of [0, 2, -1, 1.5, '1', true, null]) {
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, revision }).success).toBe(false);
    }
    for (const summaryDigest of ['A'.repeat(64), 'a'.repeat(63), `${review.summaryDigest}\n`]) {
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, summaryDigest }).success).toBe(false);
    }
  });

  it('rejects private identifiers, credentials and diagnostics at every object level', () => {
    const fields = {
      principalId: review.reviewId,
      actorId: review.reviewId,
      credential: 'psa2.private',
      notes: 'Private note',
      preparationId: review.reviewId,
      debug: { allowed: true },
      ...JSON.parse('{"__proto__":{"private":true}}'),
    };
    for (const [key, value] of Object.entries(fields)) {
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, [key]: value }).success, key).toBe(false);
      expect(v2StepUpReviewDataSchema.safeParse({
        ...review, exactSummary: { ...review.exactSummary, [key]: value },
      }).success, key).toBe(false);
      expect(v2StepUpReviewDataSchema.safeParse({
        ...review, differences: [{ ...review.differences[0], [key]: value }],
      }).success, key).toBe(false);
    }
  });

  it('keeps the existing one-to-four allowlisted differences and nonempty display values', () => {
    const differences = ['host', 'meeting_type', 'meeting_window', 'duration']
      .map((field) => ({ field, proposed: 'Proposed value', reviewed: 'Reviewed value' }));
    expect(v2StepUpReviewDataSchema.parse({ ...review, differences }).differences).toEqual(differences);
    for (const value of [[], [...differences, differences[0]], null]) {
      expect(v2StepUpReviewDataSchema.safeParse({ ...review, differences: value }).success).toBe(false);
    }
    for (const field of ['principal', 'email', 'notes', null, 1]) {
      expect(v2StepUpReviewDataSchema.safeParse({
        ...review, differences: [{ ...review.differences[0], field }],
      }).success).toBe(false);
    }
    for (const key of ['proposed', 'reviewed']) {
      for (const value of ['', null, false, {}]) {
        expect(v2StepUpReviewDataSchema.safeParse({
          ...review, differences: [{ ...review.differences[0], [key]: value }],
        }).success).toBe(false);
      }
    }
  });

  it('retains exact microsecond order checks and existing name/email/time-zone validation', () => {
    const startAt = '2026-11-20T13:00:00.000001Z';
    const snapshot = { ...review.exactSummary, startAt, endAt: '2026-11-20T13:00:00.000002Z' };
    expect(v2StepUpReviewDataSchema.safeParse({ ...review, exactSummary: snapshot }).success).toBe(true);
    for (const endAt of [startAt, '2026-11-20T13:00:00.000000Z', 'not-an-instant']) {
      expect(v2StepUpReviewDataSchema.safeParse({
        ...review, exactSummary: { ...snapshot, endAt },
      }).success).toBe(false);
    }
    for (const override of [
      { name: 'x' }, { name: 'Bad\nName' }, { email: 'guest@localhost' },
      { guestTimeZone: 'No/Such_Zone' }, { hostTimeZone: '' },
    ]) {
      expect(v2StepUpReviewDataSchema.safeParse({
        ...review, exactSummary: { ...review.exactSummary, ...override },
      }).success).toBe(false);
    }
  });

  it('uses the strict version-2 success envelope without treating a reference as authority', () => {
    const response = { contractVersion: 2, requestId: 'review-response-test', data: review };
    expect(v2StepUpReviewResponseSchema.parse(response).data).toEqual(v2StepUpReviewDataSchema.parse(review));
    for (const contractVersion of [1, 3, '2', null]) {
      expect(v2StepUpReviewResponseSchema.safeParse({ ...response, contractVersion }).success).toBe(false);
    }
    expect(v2StepUpReviewResponseSchema.safeParse({ ...response, debug: true }).success).toBe(false);
    expect(v2StepUpReviewResponseSchema.safeParse({ ...response, requestId: 'invalid id' }).success).toBe(false);
    expect(v2StepUpReviewResponseSchema.safeParse({ ...response, data: { ...review, authorized: true } }).success).toBe(false);
  });

  it('exports the exact literal state/revision and strict nested JSON schema', () => {
    expectTypeOf<V2StepUpReviewData['state']>().toEqualTypeOf<'pending'>();
    expectTypeOf<V2StepUpReviewData['revision']>().toEqualTypeOf<1>();
    expectTypeOf<V2StepUpReviewResponse['data']>().toEqualTypeOf<V2StepUpReviewData>();
    const properties = v2StepUpReviewDataNode.jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(v2StepUpReviewDataNode.jsonSchema.additionalProperties).toBe(false);
    expect(properties.revision).toMatchObject({ type: 'integer', const: 1 });
    expect(properties.state).toMatchObject({ const: 'pending' });
    expect(properties.exactSummary).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining(['name', 'email', 'startAt', 'endAt']),
      'x-project-s-refinements': expect.arrayContaining([expect.stringContaining('microsecond')]),
    });
    expect(properties.differences).toMatchObject({
      minItems: 1, maxItems: 4,
      items: { additionalProperties: false, required: ['field', 'proposed', 'reviewed'] },
    });
  });
});
