import { describe, expect, expectTypeOf, it } from 'vitest';

import { bookerSchema, ianaTimeZoneSchema } from '../src/common.js';
import {
  v2ActorRegisterInputNode,
  v2ActorRegisterInputSchema,
  v2ActorRevokeInputSchema,
  v2ActorRevokedDataSchema,
  v2ActorRevokedResponseSchema,
  v2BookerProfileCreateInputSchema,
  v2BookerProfileCreatedDataNode,
  v2BookerProfileCreatedDataSchema,
  v2BookerProfileCreatedResponseSchema,
  v2BookerProfileDeleteInputSchema,
  v2BookerProfileDeletedDataSchema,
  v2BookerProfileDeletedResponseSchema,
  v2ExpectedRevisionInputSchema,
  v2MandateRevokeInputSchema,
  v2MandateRevokedDataSchema,
  v2MandateRevokedResponseSchema,
  v2StepUpApproveInputSchema,
  v2StepUpApprovedDataSchema,
  v2StepUpApprovedResponseSchema,
  v2StepUpRevokeInputSchema,
  v2StepUpRevokedDataSchema,
  v2StepUpRevokedResponseSchema,
  type V2ActorRegisterInput,
  type V2ActorRevokedData,
  type V2BookerProfileCreateInput,
  type V2BookerProfileCreatedData,
  type V2BookerProfileDeletedData,
  type V2ExpectedRevisionInput,
  type V2MandateRevokedData,
  type V2StepUpApproveInput,
  type V2StepUpApprovedData,
  type V2StepUpRevokedData,
} from '../src/v2/controls.js';
import { v2MandateApproveInputSchema } from '../src/v2/operations.js';

const actorId = 'ABCDEF12-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const mandateId = '33333333-3333-4333-8333-333333333333';
const reviewId = '44444444-4444-4444-8444-444444444444';
const preparationId = '55555555-5555-4555-8555-555555555555';
const summaryDigest = 'a'.repeat(64);
const reviewedAt = '2026-10-22T13:00:00.000001Z';
const expiresAt = '2026-10-29T13:00:00.000001Z';
const profileInput = {
  name: '  Example Guest  ',
  email: '  Guest@Example.COM  ',
  guestTimeZone: 'America/Halifax',
};
const actorRevoked = { actorId, revision: 2, state: 'revoked', revokedAt: reviewedAt };
const profileCreated = { profileId, revision: 1, reviewedAt, expiresAt };
const profileDeleted = { profileId, state: 'deleted', deletedAt: reviewedAt };
const mandateRevoked = { mandateId, revision: 2, state: 'revoked', revokedAt: reviewedAt };
const stepUpApproved = {
  reviewId, state: 'approved', preparationId, expiresAt: '2026-10-22T13:05:00.000001Z',
};
const stepUpRevoked = { reviewId, revision: 2, state: 'revoked', revokedAt: reviewedAt };
const approval = { expectedRevision: 1, summaryDigest };

const casSchemas = [
  v2ExpectedRevisionInputSchema,
  v2ActorRevokeInputSchema,
  v2BookerProfileDeleteInputSchema,
  v2MandateRevokeInputSchema,
  v2StepUpRevokeInputSchema,
];
const controls = [
  { schema: v2ActorRegisterInputSchema, body: { label: 'Guest agent' } },
  { schema: v2BookerProfileCreateInputSchema, body: profileInput },
  ...casSchemas.map((schema) => ({ schema, body: { expectedRevision: 1 } })),
  { schema: v2StepUpApproveInputSchema, body: approval },
];
const terminalCases = [
  { name: 'actor revoke', schema: v2ActorRevokedDataSchema, data: actorRevoked, state: 'revoked' },
  { name: 'profile delete', schema: v2BookerProfileDeletedDataSchema, data: profileDeleted, state: 'deleted' },
  { name: 'mandate revoke', schema: v2MandateRevokedDataSchema, data: mandateRevoked, state: 'revoked' },
  { name: 'step-up approval', schema: v2StepUpApprovedDataSchema, data: stepUpApproved, state: 'approved' },
  { name: 'step-up revoke', schema: v2StepUpRevokedDataSchema, data: stepUpRevoked, state: 'revoked' },
];
const responseCases = [
  { name: 'actor revoke', schema: v2ActorRevokedResponseSchema, data: actorRevoked },
  { name: 'profile create', schema: v2BookerProfileCreatedResponseSchema, data: profileCreated },
  { name: 'profile delete', schema: v2BookerProfileDeletedResponseSchema, data: profileDeleted },
  { name: 'mandate revoke', schema: v2MandateRevokedResponseSchema, data: mandateRevoked },
  { name: 'step-up approval', schema: v2StepUpApprovedResponseSchema, data: stepUpApproved },
  { name: 'step-up revoke', schema: v2StepUpRevokedResponseSchema, data: stepUpRevoked },
];

describe('unavailable v2 principal-control inputs', () => {
  it('normalizes a display label and enforces the reviewed trimmed length', () => {
    expect(v2ActorRegisterInputSchema.parse({ label: ' \tGuest agent\n ' })).toEqual({ label: 'Guest agent' });
    expect(v2ActorRegisterInputSchema.parse({ label: ` ${'a'.repeat(80)} ` }).label).toHaveLength(80);
    expect(v2ActorRegisterInputSchema.parse({ label: 'x' }).label).toBe('x');
    for (const label of ['', '  \n\t', 'a'.repeat(81), false, null, { text: 'agent' }]) {
      expect(v2ActorRegisterInputSchema.safeParse({ label }).success).toBe(false);
    }
    expect(v2ActorRegisterInputNode.jsonSchema.properties).toMatchObject({
      label: { minLength: 1, maxLength: 80, 'x-project-s-normalization': 'trim' },
    });
  });

  it('reuses existing name, email and time-zone rules while accepting no notes', () => {
    const expected = bookerSchema.parse({ name: profileInput.name, email: profileInput.email });
    expect(v2BookerProfileCreateInputSchema.parse(profileInput)).toEqual({
      ...expected, guestTimeZone: profileInput.guestTimeZone,
    });
    for (const notes of ['', 'Private note', null]) {
      expect(v2BookerProfileCreateInputSchema.safeParse({ ...profileInput, notes }).success).toBe(false);
    }
    for (const name of ['', 'x', 'Bad\nName', '\u0000Guest', { value: 'Guest' }]) {
      expect(v2BookerProfileCreateInputSchema.safeParse({ ...profileInput, name }).success).toBe(false);
    }
    for (const email of ['not-an-email', 'a..b@example.com', 'guest@localhost', { address: 'g@example.com' }]) {
      expect(v2BookerProfileCreateInputSchema.safeParse({ ...profileInput, email }).success).toBe(false);
    }
    for (const guestTimeZone of ['No/Such_Zone', '', 'UTC', 'America/Halifax']) {
      expect(v2BookerProfileCreateInputSchema.safeParse({ ...profileInput, guestTimeZone }).success)
        .toBe(ianaTimeZoneSchema.safeParse(guestTimeZone).success);
    }
  });

  it('refuses spoofed identity, credential, approval and lifecycle fields on every body', () => {
    const unknownFields = {
      principalId: profileId,
      subjectId: profileId,
      actorId,
      credentialId: actorId,
      credential: 'psa2.secret',
      confirmed: true,
      allowed: true,
      reviewed: true,
      revoked: true,
      state: 'active',
      expiresAt,
      metadata: { approved: true },
    };
    for (const { schema, body } of controls) {
      expect(schema.safeParse(body).success).toBe(true);
      for (const [field, value] of Object.entries(unknownFields)) {
        expect(schema.safeParse({ ...body, [field]: value }).success, field).toBe(false);
      }
      expect(schema.safeParse({}).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(false);
    }
  });

  it('uses a positive safe integer compare-and-swap revision without coercion', () => {
    for (const schema of casSchemas) {
      expect(schema.parse({ expectedRevision: Number.MAX_SAFE_INTEGER })).toEqual({
        expectedRevision: Number.MAX_SAFE_INTEGER,
      });
      for (const expectedRevision of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', true]) {
        expect(schema.safeParse({ expectedRevision }).success).toBe(false);
      }
      expect(schema.safeParse({ expectedRevision: 1, revision: 1 }).success).toBe(false);
    }
  });

  it('requires the exact reviewed digest/revision for step-up approval', () => {
    expect(v2StepUpApproveInputSchema.parse(approval)).toEqual(v2MandateApproveInputSchema.parse(approval));
    for (const digest of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `${summaryDigest}\n`]) {
      expect(v2StepUpApproveInputSchema.safeParse({ ...approval, summaryDigest: digest }).success).toBe(false);
    }
    for (const expectedRevision of [0, 1.1, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(v2StepUpApproveInputSchema.safeParse({ ...approval, expectedRevision }).success).toBe(false);
    }
    expect(v2StepUpApproveInputSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(v2StepUpApproveInputSchema.safeParse({ summaryDigest }).success).toBe(false);
  });
});

describe('reviewed-profile lifetime and privacy', () => {
  it('normalizes equivalent instants while retaining the exact seven-day boundary', () => {
    expect(v2BookerProfileCreatedDataSchema.parse({
      ...profileCreated,
      reviewedAt: '2026-10-22T10:00:00.000001-03:00',
      expiresAt: '2026-10-29T14:00:00.000001+01:00',
    })).toEqual(profileCreated);
    expect(v2BookerProfileCreatedDataSchema.safeParse({
      ...profileCreated, expiresAt: '2026-10-22T13:00:00.000002Z',
    }).success).toBe(true);
    expect(v2BookerProfileCreatedDataNode.jsonSchema['x-project-s-refinements']).toEqual([
      expect.stringContaining('without losing microsecond precision'),
    ]);
  });

  it.each([
    ['same instant', reviewedAt],
    ['one microsecond before review', '2026-10-22T13:00:00.000000Z'],
    ['one microsecond past seven days', '2026-10-29T13:00:00.000002Z'],
    ['same instant through another offset', '2026-10-22T10:00:00.000001-03:00'],
  ])('refuses a profile expiry %s', (_name, invalidExpiry) => {
    expect(v2BookerProfileCreatedDataSchema.safeParse({ ...profileCreated, expiresAt: invalidExpiry }).success)
      .toBe(false);
  });

  it('keeps submillisecond ordering exact across the Unix epoch', () => {
    const base = { ...profileCreated, reviewedAt: '1969-12-31T23:59:59.999999Z' };
    expect(v2BookerProfileCreatedDataSchema.safeParse({ ...base, expiresAt: '1970-01-01T00:00:00.000000Z' }).success)
      .toBe(true);
    expect(v2BookerProfileCreatedDataSchema.safeParse({ ...base, expiresAt: '1970-01-07T23:59:59.999999Z' }).success)
      .toBe(true);
    expect(v2BookerProfileCreatedDataSchema.safeParse({ ...base, expiresAt: '1970-01-08T00:00:00.000000Z' }).success)
      .toBe(false);
  });

  it('turns malformed timestamps into refusals rather than refinement exceptions', () => {
    for (const field of ['reviewedAt', 'expiresAt']) {
      for (const instant of ['not-an-instant', '2026-02-30T13:00:00Z', '', null, 1, '2026-10-22T13:00:00.0000001Z']) {
        expect(() => v2BookerProfileCreatedDataSchema.safeParse({ ...profileCreated, [field]: instant }))
          .not.toThrow();
        expect(v2BookerProfileCreatedDataSchema.safeParse({ ...profileCreated, [field]: instant }).success)
          .toBe(false);
      }
    }
  });

  it('refuses PII, raw credentials and bookkeeping additions to every control acknowledgement', () => {
    for (const { schema, data } of responseCases) {
      const response = { contractVersion: 2, requestId: 'control-test-request', data };
      for (const [field, value] of Object.entries({
        name: 'Example Guest', email: 'guest@example.com', guestTimeZone: 'UTC', notes: 'Private',
        credential: 'psa2.secret', credentialVerifier: summaryDigest, principalId: profileId,
        policySummary: { profileId }, allowed: true,
      })) {
        expect(schema.safeParse({ ...response, data: { ...data, [field]: value } }).success, field).toBe(false);
      }
    }
  });
});

describe('exact terminal control acknowledgements', () => {
  it.each(terminalCases)('accepts only the reviewed $name state and shape', ({ schema, data, state }) => {
    expect(schema.safeParse(data).success).toBe(true);
    for (const invalidState of ['active', 'pending', 'expired', 'consumed', 'deleted', 'approved', 'revoked', true]) {
      if (invalidState === state) continue;
      expect(schema.safeParse({ ...data, state: invalidState }).success).toBe(false);
    }
    for (const field of Object.keys(data)) {
      const missing: Record<string, unknown> = { ...data };
      delete missing[field];
      expect(schema.safeParse(missing).success, field).toBe(false);
    }
  });

  it('normalizes response IDs and instants without treating them as credentials', () => {
    expect(v2ActorRevokedDataSchema.parse({
      ...actorRevoked, revokedAt: '2026-10-22T10:00:00.000001-03:00',
    })).toEqual({ ...actorRevoked, actorId: actorId.toLowerCase() });
    for (const schema of [v2ActorRevokedDataSchema, v2MandateRevokedDataSchema, v2StepUpRevokedDataSchema]) {
      const base = schema === v2ActorRevokedDataSchema ? actorRevoked :
        schema === v2MandateRevokedDataSchema ? mandateRevoked : stepUpRevoked;
      for (const revision of [0, 0.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
        expect(schema.safeParse({ ...base, revision }).success).toBe(false);
      }
    }
  });

  it('distinguishes the approved new preparation from a revoke acknowledgement', () => {
    expect(v2StepUpApprovedDataSchema.safeParse(stepUpRevoked).success).toBe(false);
    expect(v2StepUpRevokedDataSchema.safeParse(stepUpApproved).success).toBe(false);
    expect(v2StepUpApprovedDataSchema.safeParse({ ...stepUpApproved, revision: 2 }).success).toBe(false);
    expect(v2StepUpRevokedDataSchema.safeParse({ ...stepUpRevoked, preparationId }).success).toBe(false);
    expect(v2BookerProfileDeletedDataSchema.safeParse({ ...profileDeleted, revision: 2 }).success).toBe(false);
    expect(v2BookerProfileDeletedDataSchema.safeParse({ ...profileDeleted, revokedAt: reviewedAt }).success).toBe(false);
  });

  it.each(responseCases)('requires an exact version-2 $name envelope with strict nested data', ({ schema, data }) => {
    const response = { contractVersion: 2, requestId: 'control-test-request', data };
    expect(schema.safeParse(response).success).toBe(true);
    for (const contractVersion of [1, 3, '2', true, null]) {
      expect(schema.safeParse({ ...response, contractVersion }).success).toBe(false);
    }
    expect(schema.safeParse({ ...response, debug: { approved: true } }).success).toBe(false);
    expect(schema.safeParse({ ...response, data: { ...data, debug: { approved: true } } }).success).toBe(false);
    expect(schema.safeParse({ ...response, requestId: 'bad id' }).success).toBe(false);
    expect(schema.safeParse({ data }).success).toBe(false);
  });

  it('exports inferred data/input types alongside the runtime schemas', () => {
    expectTypeOf<V2ActorRegisterInput>().toEqualTypeOf<{ label: string }>();
    expectTypeOf<V2ExpectedRevisionInput>().toEqualTypeOf<{ expectedRevision: number }>();
    expectTypeOf<V2BookerProfileCreateInput>().toEqualTypeOf<{ name: string; email: string; guestTimeZone: string }>();
    expectTypeOf<V2BookerProfileCreatedData>().toEqualTypeOf<{
      profileId: string; revision: number; reviewedAt: string; expiresAt: string;
    }>();
    expectTypeOf<V2ActorRevokedData>().toEqualTypeOf<{
      actorId: string; revision: number; state: 'revoked'; revokedAt: string;
    }>();
    expectTypeOf<V2MandateRevokedData>().toEqualTypeOf<{
      mandateId: string; revision: number; state: 'revoked'; revokedAt: string;
    }>();
    expectTypeOf<V2BookerProfileDeletedData>().toEqualTypeOf<{
      profileId: string; state: 'deleted'; deletedAt: string;
    }>();
    expectTypeOf<V2StepUpApproveInput>().toEqualTypeOf<{ expectedRevision: number; summaryDigest: string }>();
    expectTypeOf<V2StepUpApprovedData>().toEqualTypeOf<{
      reviewId: string; state: 'approved'; preparationId: string; expiresAt: string;
    }>();
    expectTypeOf<V2StepUpRevokedData>().toEqualTypeOf<{
      reviewId: string; state: 'revoked'; revision: number; revokedAt: string;
    }>();
  });
});
