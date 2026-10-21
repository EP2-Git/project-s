import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createBookingInputSchema,
  prepareBookingInputSchema,
} from '../src/operations.js';
import {
  v2BookingReceiptDataNode,
  v2BookingReceiptDataSchema,
  v2BookingSchema,
  v2CreateBookingInputSchema,
  v2CreateBookingResponseSchema,
  v2MandateApproveInputSchema,
  v2MandateApprovedDataSchema,
  v2MandateApprovedResponseSchema,
  v2MandatePolicySummarySchema,
  v2MandateReviewDataSchema,
  v2MandateReviewInputNode,
  v2MandateReviewInputSchema,
  v2MandateReviewResponseSchema,
  v2PrepareBookingDataSchema,
  v2PrepareBookingInputSchema,
  v2PrepareBookingResponseSchema,
  v2PreparedBookingSummarySchema,
  v2SuccessEnvelopeNode,
  type V2Booking,
  type V2BookingReceiptData,
  type V2CreateBookingInput,
  type V2CreateBookingResponse,
  type V2MandateApproveInput,
  type V2MandateApprovedData,
  type V2MandateApprovedResponse,
  type V2MandatePolicySummary,
  type V2MandateReviewData,
  type V2MandateReviewInput,
  type V2MandateReviewResponse,
  type V2PrepareBookingData,
  type V2PrepareBookingInput,
  type V2PrepareBookingResponse,
  type V2PreparedBookingSummary,
} from '../src/v2/operations.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const meetingTypeId = '33333333-3333-4333-8333-333333333333';
const reviewId = '44444444-4444-4444-8444-444444444444';
const mandateId = '55555555-5555-4555-8555-555555555555';
const preparationId = '66666666-6666-4666-8666-666666666666';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';
const receiptId = '88888888-8888-4888-8888-888888888888';
const digest = 'a'.repeat(64);
const requestId = 'request-v2-foundation';
const permissionStart = '2026-11-02T13:00:00.000001Z';
const permissionEnd = '2026-11-03T13:00:00.000001Z';

const reviewInput = {
  actorId,
  profileId,
  profileRevision: 1,
  username: 'demo-host',
  meetingTypeId,
  meetingWindowStart: '2026-11-04T14:00:00.000001Z',
  meetingWindowEnd: '2026-11-04T14:30:00.000001Z',
  maxDurationMinutes: 30,
  notBefore: permissionStart,
  expiresAt: permissionEnd,
} as const;
const policySummary = {
  ...reviewInput,
  name: 'Example Guest',
  email: 'guest@example.com',
  guestTimeZone: 'America/Halifax',
  hostDisplayName: 'Demo Host',
  meetingTypeTitle: 'Introduction',
} as const;
const reviewData = {
  reviewId,
  revision: 1,
  summaryDigest: digest,
  expiresAt: '2026-11-02T13:05:00.000001Z',
  policySummary,
} as const;
const approveInput = { expectedRevision: 1, summaryDigest: digest } as const;
const approvedData = {
  mandateId,
  revision: 1,
  state: 'active',
  issuedAt: permissionStart,
  expiresAt: permissionEnd,
} as const;
const prepareInput = {
  mandateId,
  username: 'demo-host',
  meetingTypeId,
  startAt: reviewInput.meetingWindowStart,
} as const;
const summary = {
  username: 'demo-host',
  hostDisplayName: 'Demo Host',
  meetingTypeId,
  meetingTypeTitle: 'Introduction',
  startAt: reviewInput.meetingWindowStart,
  endAt: reviewInput.meetingWindowEnd,
  hostTimeZone: 'America/Halifax',
  guestTimeZone: 'Asia/Tokyo',
} as const;
const prepareData = {
  preparationId,
  expiresAt: '2026-11-02T13:10:00.000001Z',
  notHeld: true,
  summaryDigest: digest,
  summary,
} as const;
const createInput = { preparationId, idempotencyKey } as const;
const booking = {
  confirmationCode: 'PROJECT-S-V2-TEST',
  status: 'confirmed',
  username: 'demo-host',
  meetingTypeId,
  meetingTypeTitle: 'Introduction',
  startAt: summary.startAt,
  endAt: summary.endAt,
  hostTimeZone: summary.hostTimeZone,
  guestTimeZone: summary.guestTimeZone,
} as const;
const receipt = {
  receiptId,
  receiptExpiresAt: permissionEnd,
  booking,
} as const;
const envelope = <T>(data: T) => ({ contractVersion: 2, requestId, data });

describe('unavailable v2 operation wire foundation', () => {
  it('exports precise input, data and version-2 envelope types', () => {
    expectTypeOf(v2MandateReviewInputSchema.parse(reviewInput)).toEqualTypeOf<V2MandateReviewInput>();
    expectTypeOf(v2MandatePolicySummarySchema.parse(policySummary)).toEqualTypeOf<V2MandatePolicySummary>();
    expectTypeOf(v2MandateReviewDataSchema.parse(reviewData)).toEqualTypeOf<V2MandateReviewData>();
    expectTypeOf(v2MandateApproveInputSchema.parse(approveInput)).toEqualTypeOf<V2MandateApproveInput>();
    expectTypeOf(v2MandateApprovedDataSchema.parse(approvedData)).toEqualTypeOf<V2MandateApprovedData>();
    expectTypeOf(v2PrepareBookingInputSchema.parse(prepareInput)).toEqualTypeOf<V2PrepareBookingInput>();
    expectTypeOf(v2PreparedBookingSummarySchema.parse(summary)).toEqualTypeOf<V2PreparedBookingSummary>();
    expectTypeOf(v2PrepareBookingDataSchema.parse(prepareData)).toEqualTypeOf<V2PrepareBookingData>();
    expectTypeOf(v2CreateBookingInputSchema.parse(createInput)).toEqualTypeOf<V2CreateBookingInput>();
    expectTypeOf(v2BookingSchema.parse(booking)).toEqualTypeOf<V2Booking>();
    expectTypeOf(v2BookingReceiptDataSchema.parse(receipt)).toEqualTypeOf<V2BookingReceiptData>();
    expectTypeOf(v2MandateReviewResponseSchema.parse(envelope(reviewData))).toEqualTypeOf<V2MandateReviewResponse>();
    expectTypeOf(v2MandateApprovedResponseSchema.parse(envelope(approvedData))).toEqualTypeOf<V2MandateApprovedResponse>();
    expectTypeOf(v2PrepareBookingResponseSchema.parse(envelope(prepareData))).toEqualTypeOf<V2PrepareBookingResponse>();
    expectTypeOf(v2CreateBookingResponseSchema.parse(envelope(receipt))).toEqualTypeOf<V2CreateBookingResponse>();
    expectTypeOf<V2CreateBookingResponse>().toMatchTypeOf<{
      contractVersion: 2; requestId: string; data: V2BookingReceiptData;
    }>();
  });

  it('accepts the reviewed exact request and response DTOs without adding defaults', () => {
    const fixtures = [
      [v2MandateReviewInputSchema, reviewInput],
      [v2MandatePolicySummarySchema, policySummary],
      [v2MandateReviewDataSchema, reviewData],
      [v2MandateApproveInputSchema, approveInput],
      [v2MandateApprovedDataSchema, approvedData],
      [v2PrepareBookingInputSchema, prepareInput],
      [v2PreparedBookingSummarySchema, summary],
      [v2PrepareBookingDataSchema, prepareData],
      [v2CreateBookingInputSchema, createInput],
      [v2BookingSchema, booking],
      [v2BookingReceiptDataSchema, receipt],
    ] as const;
    for (const [schema, fixture] of fixtures) expect(schema.parse(fixture)).toEqual(fixture);
  });

  it('does not turn codec validation into live authorization or a future-date requirement', () => {
    // These historical instants still parse. A future router/kernel must check server time and ownership.
    expect(v2MandateReviewInputSchema.safeParse({
      ...reviewInput,
      notBefore: '2000-01-01T00:00:00.000000Z',
      expiresAt: '2000-01-01T00:00:00.000001Z',
    }).success).toBe(true);
    // Meeting date and permission expiry are intentionally distinct dimensions.
    expect(v2MandateReviewInputSchema.parse(reviewInput).meetingWindowStart).toBe(summary.startAt);
  });

  it.each(['principalId', 'subjectId', 'credentialId', 'actorId', 'durationMinutes', 'booker', 'notes', 'guestTimeZone'])(
    'rejects actor preparation attempts to supply %s', (field) => {
      expect(v2PrepareBookingInputSchema.safeParse({ ...prepareInput, [field]: actorId }).success).toBe(false);
    },
  );

  it.each(['principalId', 'subjectId', 'credentialId', 'actorId', 'mandateId', 'startAt', 'durationMinutes', 'booker', 'notes'])(
    'rejects actor commit attempts to supply %s', (field) => {
      expect(v2CreateBookingInputSchema.safeParse({ ...createInput, [field]: actorId }).success).toBe(false);
    },
  );

  it('allows actor registration references only in the principal review input, without spoofed ownership', () => {
    expect(v2MandateReviewInputSchema.safeParse(reviewInput).success).toBe(true);
    for (const field of ['principalId', 'subjectId', 'credentialId', 'booker', 'name', 'email', 'notes', 'issuedAt', 'remainingUses']) {
      expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, [field]: actorId }).success).toBe(false);
    }
  });

  it('requires an exact reviewed digest and safe revision rather than a client approval boolean', () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      expect(v2MandateApproveInputSchema.safeParse({ ...approveInput, expectedRevision: value }).success).toBe(false);
      expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, profileRevision: value }).success).toBe(false);
    }
    expect(v2MandateApproveInputSchema.safeParse({ ...approveInput, approved: true }).success).toBe(false);
    for (const value of ['A'.repeat(64), 'a'.repeat(63), `${digest} `, 'not-a-digest']) {
      expect(v2MandateApproveInputSchema.safeParse({ ...approveInput, summaryDigest: value }).success).toBe(false);
    }
    expect(v2MandateApproveInputSchema.parse({ ...approveInput, expectedRevision: Number.MAX_SAFE_INTEGER }).expectedRevision)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it('uses authenticated UUID preparation references, preserving the separate v1 token body', () => {
    const token = 'token_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(createBookingInputSchema.safeParse({ preparationToken: token, idempotencyKey }).success).toBe(true);
    expect(v2CreateBookingInputSchema.safeParse({ preparationToken: token, idempotencyKey }).success).toBe(false);
    expect(createBookingInputSchema.safeParse(createInput).success).toBe(false);
    expect(v2CreateBookingInputSchema.safeParse({ ...createInput, preparationId: token }).success).toBe(false);
    expect(v2CreateBookingInputSchema.safeParse({ ...createInput, preparationToken: token }).success).toBe(false);
  });

  it('keeps reviewed profile PII in the principal policy review and out of all actor results', () => {
    expect(v2MandatePolicySummarySchema.parse(policySummary).email).toBe('guest@example.com');
    for (const field of ['name', 'email', 'booker', 'notes', 'profileId', 'profileRevision', 'meetingWindowStart', 'maxDurationMinutes']) {
      expect(v2PreparedBookingSummarySchema.safeParse({ ...summary, [field]: 'private' }).success).toBe(false);
      expect(v2BookingSchema.safeParse({ ...booking, [field]: 'private' }).success).toBe(false);
    }
    expect(v2BookingSchema.safeParse({ ...booking, idempotencyKey }).success).toBe(false);
    expect(v2BookingSchema.safeParse({ ...booking, hostDisplayName: 'Demo Host' }).success).toBe(false);
    expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, ownerId: actorId }).success).toBe(false);
    expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, credential: 'psa2.secret' }).success).toBe(false);
  });

  it('reuses existing booker normalization and validation rather than inventing a new profile codec', () => {
    const parsed = v2MandatePolicySummarySchema.parse({
      ...policySummary, name: '  Example Guest  ', email: ' Guest@Example.COM ',
    });
    expect(parsed.name).toBe('Example Guest');
    expect(parsed.email).toBe('guest@example.com');
    for (const email of ['user+@example.com', 'foo..bar@example.com', 'guest@example', 'guest\t@example.com']) {
      expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, email }).success).toBe(false);
    }
    for (const name of ['A', 'Example\nGuest', '\tGuest', ' Guest\u0000 Name ']) {
      expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, name }).success).toBe(false);
    }
    expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, guestTimeZone: 'Mars/Olympus' }).success).toBe(false);
    expect(v2PrepareBookingInputSchema.safeParse({ ...prepareInput, username: 'Demo-Host' }).success).toBe(false);
  });

  it('normalizes supported offset and variable-fraction inputs to canonical UTC without losing microseconds', () => {
    const offset = '2026-11-04T10:00:00.000001-04:00';
    expect(prepareBookingInputSchema.safeParse({
      username: 'demo-host', meetingTypeId, startAt: offset,
      guestTimeZone: 'Asia/Tokyo', booker: { name: 'Example Guest', email: 'guest@example.com' },
    }).success).toBe(true);
    expect(v2PrepareBookingInputSchema.parse({ ...prepareInput, startAt: offset }).startAt)
      .toBe('2026-11-04T14:00:00.000001Z');
    expect(v2PrepareBookingInputSchema.parse({ ...prepareInput, startAt: '2026-11-04T14:00:00.000Z' }).startAt)
      .toBe('2026-11-04T14:00:00.000000Z');
    expect(v2PrepareBookingInputSchema.parse({ ...prepareInput, startAt: '2026-11-04T14:00:00Z' }).startAt)
      .toBe('2026-11-04T14:00:00.000000Z');
    expect(v2MandateReviewInputSchema.parse({
      ...reviewInput,
      meetingWindowStart: '2026-11-04T10:00:00.000001-04:00',
      meetingWindowEnd: '2026-11-04T09:30:00.000001-05:00',
    }).meetingWindowEnd).toBe(summary.endAt);
  });

  it('rejects zero or reversed meeting bounds without rounding away adjacent microseconds', () => {
    const startAt = '2026-11-04T14:00:00.000001Z';
    const endAt = '2026-11-04T14:00:00.000002Z';
    expect(v2PreparedBookingSummarySchema.safeParse({ ...summary, startAt, endAt }).success).toBe(true);
    expect(v2BookingSchema.safeParse({ ...booking, startAt, endAt }).success).toBe(true);
    expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, meetingWindowStart: startAt, meetingWindowEnd: endAt }).success).toBe(true);
    for (const endAt of [startAt, '2026-11-04T14:00:00.000000Z']) {
      expect(v2PreparedBookingSummarySchema.safeParse({ ...summary, startAt, endAt }).success).toBe(false);
      expect(v2BookingSchema.safeParse({ ...booking, startAt, endAt }).success).toBe(false);
      expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, meetingWindowStart: startAt, meetingWindowEnd: endAt }).success).toBe(false);
      expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, meetingWindowStart: startAt, meetingWindowEnd: endAt }).success).toBe(false);
    }
  });

  it('enforces finite permission spans exactly at the 24-hour and adjacent-microsecond boundaries', () => {
    expect(v2MandateReviewInputSchema.safeParse(reviewInput).success).toBe(true);
    expect(v2MandateApprovedDataSchema.safeParse(approvedData).success).toBe(true);
    for (const expiresAt of [permissionStart, '2026-11-02T13:00:00.000000Z', '2026-11-03T13:00:00.000002Z']) {
      expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, expiresAt }).success).toBe(false);
      expect(v2MandatePolicySummarySchema.safeParse({ ...policySummary, expiresAt }).success).toBe(false);
      expect(v2MandateApprovedDataSchema.safeParse({ ...approvedData, expiresAt }).success).toBe(false);
    }
    expect(v2MandateReviewInputSchema.safeParse({
      ...reviewInput, expiresAt: '2026-11-02T13:00:00.000002Z',
    }).success).toBe(true);
  });

  it.each([4, 1_441, 30.5, Infinity, NaN])('rejects unsupported maximum duration %s', (maxDurationMinutes) => {
    expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, maxDurationMinutes }).success).toBe(false);
  });

  it('does not throw while rejecting malformed instants in cross-field validation', () => {
    for (const invalid of ['not-an-instant', '2026-02-30T14:00:00.000000Z', '', null, 0]) {
      expect(v2MandateReviewInputSchema.safeParse({ ...reviewInput, expiresAt: invalid }).success).toBe(false);
      expect(v2MandateApprovedDataSchema.safeParse({ ...approvedData, issuedAt: invalid }).success).toBe(false);
      expect(v2PreparedBookingSummarySchema.safeParse({ ...summary, endAt: invalid }).success).toBe(false);
      expect(v2BookingSchema.safeParse({ ...booking, startAt: invalid }).success).toBe(false);
    }
  });

  it('rejects unknown nested fields, speculative states and hidden slot reservations', () => {
    expect(v2MandateReviewDataSchema.safeParse({ ...reviewData, policySummary: { ...policySummary, notes: 'private' } }).success).toBe(false);
    expect(v2PrepareBookingDataSchema.safeParse({ ...prepareData, summary: { ...summary, email: 'guest@example.com' } }).success).toBe(false);
    expect(v2BookingReceiptDataSchema.safeParse({ ...receipt, booking: { ...booking, idempotencyKey } }).success).toBe(false);
    expect(v2MandateApprovedDataSchema.safeParse({ ...approvedData, state: 'revoked' }).success).toBe(false);
    expect(v2BookingSchema.safeParse({ ...booking, status: 'cancelled' }).success).toBe(false);
    expect(v2PrepareBookingDataSchema.safeParse({ ...prepareData, notHeld: false }).success).toBe(false);
  });

  it('requires every reviewed field and rejects unknown fields for each concrete object', () => {
    const fixtures = [
      [v2MandateReviewInputSchema, reviewInput], [v2MandatePolicySummarySchema, policySummary],
      [v2MandateReviewDataSchema, reviewData], [v2MandateApproveInputSchema, approveInput],
      [v2MandateApprovedDataSchema, approvedData], [v2PrepareBookingInputSchema, prepareInput],
      [v2PreparedBookingSummarySchema, summary], [v2PrepareBookingDataSchema, prepareData],
      [v2CreateBookingInputSchema, createInput], [v2BookingSchema, booking],
      [v2BookingReceiptDataSchema, receipt],
    ] as const;
    for (const [schema, fixture] of fixtures) {
      expect(schema.safeParse({ ...fixture, unexpected: true }).success).toBe(false);
      for (const key of Object.keys(fixture)) {
        const incomplete: Record<string, unknown> = { ...fixture };
        delete incomplete[key];
        expect(schema.safeParse(incomplete).success).toBe(false);
      }
    }
  });

  it('keeps exact versioned success envelopes strict at both envelope and data levels', () => {
    const schema = v2SuccessEnvelopeNode(v2BookingReceiptDataNode).zod;
    expect(schema.parse(envelope(receipt))).toEqual(envelope(receipt));
    for (const contractVersion of [1, '2', 3, undefined]) {
      expect(schema.safeParse({ ...envelope(receipt), contractVersion }).success).toBe(false);
    }
    expect(schema.safeParse({ ...envelope(receipt), principalId: actorId }).success).toBe(false);
    expect(schema.safeParse({ ...envelope(receipt), data: { ...receipt, credential: 'secret' } }).success).toBe(false);
    expect(schema.safeParse({ ...envelope(receipt), requestId: 'short' }).success).toBe(false);
    expect(v2PrepareBookingInputSchema.safeParse({ ...prepareInput, contractVersion: 2 }).success).toBe(false);
  });

  it('marks runtime cross-field refinements explicitly instead of claiming plain JSON Schema proves them', () => {
    expect(v2MandateReviewInputNode.jsonSchema.additionalProperties).toBe(false);
    expect(v2MandateReviewInputNode.jsonSchema['x-project-s-refinements']).toEqual(expect.arrayContaining([
      expect.stringContaining('meetingWindowEnd > meetingWindowStart'),
      expect.stringContaining('server validation'),
    ]));
    const receiptProperties = v2BookingReceiptDataNode.jsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(receiptProperties.booking.additionalProperties).toBe(false);
    expect(receiptProperties.booking['x-project-s-refinements']).toEqual(expect.arrayContaining([
      expect.stringContaining('endAt > startAt'),
    ]));
  });
});
