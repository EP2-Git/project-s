import assert from 'node:assert/strict';
import { createMandateReview, approveMandate, getMandate, revokeMandate } from '../../supabase/functions/_shared/mandateControls.ts';

// Identical bounded Node/Deno vectors. Doubles prove the adapter boundary only;
// pgTAP/dblink and the disposable Auth/RPC proof establish database behavior.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mandateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const context = { contractVersion: 2, requestId: 'mandate-parity', principalId, subjectId: principalId,
  instanceId: binding.instanceId, epoch: binding.epoch, verifiedAt: '2030-01-01T12:00:00.000001Z', transport: 'ui' };
const input = {
  actorId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', profileId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', profileRevision: 1,
  username: 'synthetic-host', meetingTypeId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  meetingWindowStart: '2030-01-02T12:00:00.000001Z', meetingWindowEnd: '2030-01-02T13:00:00.000002Z',
  maxDurationMinutes: 60, notBefore: '2030-01-01T12:10:00.000001Z', expiresAt: '2030-01-02T12:00:00.000001Z',
};
const summary = { ...input, name: 'Synthetic Guest', email: 'guest@example.invalid', guestTimeZone: 'America/Halifax',
  hostDisplayName: 'Synthetic Host', meetingTypeTitle: 'Synthetic meeting' };
const digest = 'a'.repeat(64);
const review = (id) => ({ reviewId: id, revision: 1, summaryDigest: digest, expiresAt: '2030-01-01T12:05:00.000001Z', policySummary: summary });
const approved = { mandateId, revision: 1, state: 'active', issuedAt: '2030-01-01T12:01:00.000001Z', expiresAt: input.expiresAt };
const metadata = { ...approved, remainingUses: 1 };
const revoked = { mandateId, revision: 2, state: 'revoked', revokedAt: '2030-01-01T12:02:00.000001Z' };
const diagnostic = 'private upstream diagnostic guest@example.invalid';
const failure = (code, status) => (error) => {
  assert.equal(error.code, code); assert.equal(error.status, status);
  for (const value of [diagnostic, summary.email, summary.name, principalId, digest]) {
    assert.equal(`${String(error)} ${JSON.stringify(error)}`.includes(value), false);
  }
  return true;
};
const base = { context, binding };
const approval = { reviewId, input: { expectedRevision: 1, summaryDigest: digest } };
const revocation = { mandateId, input: { expectedRevision: 1 } };
const operations = (rpc, overrides = {}) => [
  () => createMandateReview({ ...base, input, ...overrides, rpc }),
  () => approveMandate({ ...base, ...approval, ...overrides, rpc }),
  () => getMandate({ ...base, mandateId, ...overrides, rpc }),
  () => revokeMandate({ ...base, ...revocation, ...overrides, rpc }),
];

test('mandates: review sends only normalized policy and retains exact microseconds', async () => {
  let calls = 0;
  const response = await createMandateReview({ ...base, input: {
    ...input, meetingWindowStart: '2030-01-02T08:00:00.000001-04:00',
  }, rpc: async (name, args) => {
    calls++;
    assert.equal(name, 'project_s_create_mandate_review_v2');
    assert.deepEqual(Object.keys(args).sort(), ['p_context', 'p_policy', 'p_review_id']);
    assert.deepEqual(args.p_context, context); assert.deepEqual(args.p_policy, input);
    assert.notEqual(args.p_review_id, reviewId);
    return { data: review(args.p_review_id), error: null };
  } });
  assert.equal(response.policySummary.meetingWindowStart, input.meetingWindowStart);
  assert.equal(calls, 1);
});

test('mandates: bad policies and attempted authority/PII overrides fail before RPC', async () => {
  let calls = 0;
  for (const value of [null, [], {}, { ...input, confirmed: true }, { ...input, name: summary.name },
    { ...input, principalId }, { ...input, remainingUses: 2 }, { ...input, notes: '' },
    { ...input, expiresAt: input.notBefore }, { ...input, meetingWindowEnd: input.meetingWindowStart },
    { ...input, username: ' SYNTHETIC-HOST ' }, { ...input, profileRevision: 0 }, { ...input, maxDurationMinutes: 1441 }]) {
    await assert.rejects(createMandateReview({ ...base, input: value,
      rpc: async () => { calls++; throw new Error(diagnostic); } }), failure('VALIDATION_ERROR', 400));
  }
  assert.equal(calls, 0);
});

test('mandates: malformed identities/bindings and actor contexts cannot control any operation', async () => {
  let calls = 0;
  for (const override of [
    { context: null }, { context: { ...context, actorId: input.actorId } },
    { context: { ...context, subjectId: reviewId } }, { context: { ...context, epoch: 8 } },
    { context: { ...context, transport: 'stdio_mcp' } },
    { binding: { ...binding, audience: 'http://remote.example.invalid' } },
    { binding: { ...binding, audience: `${binding.audience}/` } }, { binding: { ...binding, extra: true } },
  ]) {
    for (const operation of operations(async () => { calls++; throw new Error(diagnostic); }, override)) {
      await assert.rejects(operation(), failure('AUTHENTICATION_REQUIRED', 401));
    }
  }
  assert.equal(calls, 0);
});

test('mandates: only exact approval digest/revision and strict references reach SQL', async () => {
  let calls = 0;
  for (const override of [{ input: {} }, { input: { ...approval.input, confirmed: true } },
    { input: { ...approval.input, expectedRevision: '1' } }, { input: { ...approval.input, summaryDigest: digest.toUpperCase() } },
    { reviewId: 'unknown' }]) {
    await assert.rejects(approveMandate({ ...base, ...approval, ...override,
      rpc: async () => { calls++; throw new Error(diagnostic); } }), failure('VALIDATION_ERROR', 400));
  }
  await assert.rejects(getMandate({ ...base, mandateId: 'unknown', rpc: async () => { calls++; } }), failure('VALIDATION_ERROR', 400));
  await assert.rejects(revokeMandate({ ...base, ...revocation, input: { expectedRevision: 1, actorId: input.actorId },
    rpc: async () => { calls++; } }), failure('VALIDATION_ERROR', 400));
  assert.equal(calls, 0);
});

test('mandates: exact repeated approval can return the original private mandate, without automatic retry', async () => {
  const proposedIds = [];
  const rpc = async (name, args) => {
    assert.equal(name, 'project_s_approve_mandate_v2');
    assert.deepEqual(args.p_context, context); assert.equal(args.p_review_id, reviewId);
    assert.equal(args.p_expected_revision, 1); assert.equal(args.p_summary_digest, digest);
    proposedIds.push(args.p_mandate_id);
    return { data: approved, error: null };
  };
  assert.deepEqual(await approveMandate({ ...base, ...approval, rpc }), approved);
  assert.deepEqual(await approveMandate({ ...base, ...approval, rpc }), approved);
  assert.equal(new Set(proposedIds).size, 2);
});

test('mandates: get and exact revoke expose minimal bound metadata', async () => {
  assert.deepEqual(await getMandate({ ...base, mandateId, rpc: async (name, args) => {
    assert.equal(name, 'project_s_get_mandate_v2'); assert.deepEqual(args, { p_context: context, p_mandate_id: mandateId });
    return { data: metadata, error: null };
  } }), metadata);
  const rpc = async (name, args) => {
    assert.equal(name, 'project_s_revoke_mandate_v2');
    assert.deepEqual(args, { p_context: context, p_mandate_id: mandateId, p_expected_revision: 1 });
    return { data: revoked, error: null };
  };
  assert.deepEqual(await revokeMandate({ ...base, ...revocation, rpc }), revoked);
  assert.deepEqual(await revokeMandate({ ...base, ...revocation, rpc }), revoked);
});

test('mandates: review cannot silently change policy, mismatch identity or leak extra fields', async () => {
  for (const changed of [{ actorId: mandateId }, { maxDurationMinutes: 61 }, { profileRevision: 2 },
    { meetingWindowStart: '2030-01-02T12:00:00.000000Z' }, { notes: '' }, { email: 'invalid' }]) {
    await assert.rejects(createMandateReview({ ...base, input, rpc: async (_name, args) => ({
      data: { ...review(args.p_review_id), policySummary: { ...summary, ...changed } }, error: null,
    }) }), failure('INTERNAL_ERROR', 500));
  }
  for (const changed of [{ reviewId }, { revision: 2 }, { credential: diagnostic }, { summaryDigest: 'bad' },
    { expiresAt: '2030-01-03T12:00:00.000001Z' }]) {
    await assert.rejects(createMandateReview({ ...base, input, rpc: async (_name, args) => ({
      data: { ...review(args.p_review_id), ...changed }, error: null,
    }) }), failure('INTERNAL_ERROR', 500));
  }
});

test('mandates: invalid success metadata, cross-object IDs and PII echoes fail closed', async () => {
  for (const data of [null, { ...approved, revision: 2 }, { ...approved, email: summary.email },
    { ...approved, expiresAt: '2030-01-02T12:01:00.000002Z' }, { ...approved, state: 'revoked' }]) {
    await assert.rejects(approveMandate({ ...base, ...approval, rpc: async () => ({ data, error: null }) }), failure('INTERNAL_ERROR', 500));
  }
  for (const data of [{ ...metadata, mandateId: reviewId }, { ...metadata, name: summary.name },
    { ...metadata, remainingUses: 2 }, { ...metadata, state: 'revoked', remainingUses: 1 },
    { ...metadata, state: 'expired', remainingUses: 1 }, { ...metadata, issuedAt: 'invalid' }]) {
    await assert.rejects(getMandate({ ...base, mandateId, rpc: async () => ({ data, error: null }) }), failure('INTERNAL_ERROR', 500));
  }
  for (const data of [{ ...revoked, mandateId: reviewId }, { ...revoked, revision: 1 }, { ...revoked, summary }]) {
    await assert.rejects(revokeMandate({ ...base, ...revocation, rpc: async () => ({ data, error: null }) }), failure('INTERNAL_ERROR', 500));
  }
});

for (const [sql, code, status] of [
  ['PT400', 'VALIDATION_ERROR', 400], ['PT401', 'AUTHENTICATION_REQUIRED', 401],
  ['PT403', 'FORBIDDEN', 403], ['PT409', 'VERSION_CONFLICT', 409],
  ...['PT503', '55P03', '57014', '40P01', '40001'].map((value) => [value, 'AUTHORITY_BUSY', 503]),
  ['XX000', 'INTERNAL_ERROR', 500],
]) {
  test(`mandates: ${sql} redacts all four control errors without retry or fallback`, async () => {
    let calls = 0;
    for (const operation of operations(async () => { calls++; return { data: null, error: { code: sql, message: diagnostic } }; })) {
      await assert.rejects(operation(), failure(code, status));
    }
    assert.equal(calls, 4);
  });
}

test('mandates: thrown outages and malformed RPC results deny without diagnostic leaks', async () => {
  for (const rpc of [async () => { throw new Error(diagnostic); }, async () => undefined, async () => ({ data: null, error: null })]) {
    for (const operation of operations(rpc)) await assert.rejects(operation(), failure('INTERNAL_ERROR', 500));
  }
});
