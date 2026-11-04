import assert from 'node:assert/strict';
import { approveStepUpReview, revokeStepUpReview } from '../../supabase/functions/_shared/mandateControls.ts';

const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const preparationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const context = { contractVersion: 2, requestId: 'step-up-control-parity', principalId, subjectId: principalId,
  instanceId: binding.instanceId, epoch: binding.epoch, verifiedAt: '2030-01-01T12:00:00.000001Z', transport: 'ui' };
const digest = 'a'.repeat(64);
const approvalInput = { expectedRevision: 1, summaryDigest: digest };
const approved = { reviewId, state: 'approved', preparationId, expiresAt: '2030-01-01T12:05:00.000001Z' };
const revoked = { reviewId, state: 'revoked', revision: 3, revokedAt: '2030-01-01T12:01:00.000001Z' };
const base = { context, binding, reviewId };
const diagnostic = 'private service diagnostic booker@example.invalid';
const failure = (code, status) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  const serialized = `${String(error)} ${JSON.stringify(error)}`;
  for (const privateValue of [diagnostic, principalId, digest, 'booker@example.invalid']) {
    assert.equal(serialized.includes(privateValue), false);
  }
  return true;
};

test('step-up controls: exact approval retries accept only the original bound outcome', async () => {
  const proposed = [];
  const rpc = async (name, args) => {
    assert.equal(name, 'project_s_approve_step_up_v2');
    assert.deepEqual(Object.keys(args).sort(), [
      'p_context', 'p_expected_revision', 'p_grant_id', 'p_preparation_id', 'p_review_id', 'p_summary_digest',
    ]);
    assert.deepEqual(args.p_context, context);
    assert.equal(args.p_review_id, reviewId);
    assert.equal(args.p_summary_digest, digest);
    assert.equal(args.p_expected_revision, 1);
    assert.match(args.p_grant_id, /^[a-f0-9-]{36}$/);
    proposed.push(args.p_preparation_id, args.p_grant_id);
    return { data: approved, error: null };
  };
  assert.deepEqual(await approveStepUpReview({ ...base, reviewId: reviewId.toUpperCase(), input: approvalInput, rpc }), approved);
  assert.deepEqual(await approveStepUpReview({ ...base, input: approvalInput, rpc }), approved);
  assert.equal(new Set(proposed).size, 4);
});

test('step-up controls: pending and approved revocation require the exact prior revision', async () => {
  for (const expectedRevision of [1, 2]) {
    let calls = 0;
    const data = { ...revoked, revision: expectedRevision + 1 };
    const result = await revokeStepUpReview({ ...base, input: { expectedRevision }, rpc: async (name, args) => {
      calls++;
      assert.equal(name, 'project_s_revoke_step_up_v2');
      assert.deepEqual(args, { p_context: context, p_review_id: reviewId, p_expected_revision: expectedRevision });
      return { data, error: null };
    } });
    assert.deepEqual(result, data);
    assert.equal(calls, 1);
  }
});

test('step-up controls: malformed approval inputs fail before RPC', async () => {
  for (const input of [null, {}, { ...approvalInput, confirmed: true }, { ...approvalInput, preparationId },
    { ...approvalInput, provider: 'principal_step_up' }, { ...approvalInput, expectedRevision: 0 },
    { ...approvalInput, expectedRevision: '1' }, { ...approvalInput, summaryDigest: digest.toUpperCase() }]) {
    await assert.rejects(approveStepUpReview({ ...base, input, rpc: async () => assert.fail('Invalid body reached RPC') }),
      failure('VALIDATION_ERROR', 400));
  }
  await assert.rejects(approveStepUpReview({ ...base, reviewId: 'unknown', input: approvalInput,
    rpc: async () => assert.fail('Invalid reference reached RPC') }), failure('VALIDATION_ERROR', 400));
});

test('step-up controls: malformed revoke input fails before RPC', async () => {
  for (const input of [null, {}, { expectedRevision: 0 }, { expectedRevision: 1, confirmed: true }]) {
    await assert.rejects(revokeStepUpReview({ ...base, input, rpc: async () => assert.fail('Invalid revoke reached RPC') }),
      failure('VALIDATION_ERROR', 400));
  }
});

test('step-up controls: actor, foreign binding and malformed principal contexts fail before RPC', async () => {
  for (const override of [{ context: null }, { context: { ...context, actorId: preparationId } },
    { context: { ...context, subjectId: reviewId } }, { context: { ...context, epoch: binding.epoch + 1 } },
    { context: { ...context, transport: 'stdio_mcp' } }, { binding: { ...binding, audience: 'http://remote.example.invalid' } }]) {
    const rpc = async () => assert.fail('Invalid principal reached RPC');
    await assert.rejects(approveStepUpReview({ ...base, ...override, input: approvalInput, rpc }), failure('AUTHENTICATION_REQUIRED', 401));
    await assert.rejects(revokeStepUpReview({ ...base, ...override, input: { expectedRevision: 2 }, rpc }), failure('AUTHENTICATION_REQUIRED', 401));
  }
});

test('step-up controls: mismatched or expanded results are refused', async () => {
  for (const data of [{ ...approved, reviewId: principalId }, { ...approved, state: 'pending' },
    { ...approved, expiresAt: 'not-an-instant' }, { ...approved, grantId: principalId },
    { ...approved, ...JSON.parse('{"__proto__":{"private":true}}') }]) {
    await assert.rejects(approveStepUpReview({ ...base, input: approvalInput, rpc: async () => ({ data, error: null }) }),
      failure('INTERNAL_ERROR', 500));
  }
  for (const data of [{ ...revoked, reviewId: principalId }, { ...revoked, revision: 2 }, { ...revoked, summaryDigest: digest }]) {
    await assert.rejects(revokeStepUpReview({ ...base, input: { expectedRevision: 2 }, rpc: async () => ({ data, error: null }) }),
      failure('INTERNAL_ERROR', 500));
  }
  await assert.rejects(revokeStepUpReview({ ...base, input: { expectedRevision: 3 },
    rpc: async () => ({ data: { ...revoked, revision: 4 }, error: null }) }), failure('INTERNAL_ERROR', 500));
});

for (const [sql, code, status] of [
  ['PT400', 'VALIDATION_ERROR', 400], ['PT401', 'AUTHENTICATION_REQUIRED', 401],
  ['PT403', 'FORBIDDEN', 403], ['PT409', 'VERSION_CONFLICT', 409],
  ...['PT503', '55P03', '57014', '40P01', '40001'].map((value) => [value, 'AUTHORITY_BUSY', 503]),
  ['XX000', 'INTERNAL_ERROR', 500],
]) {
  test(`step-up controls: ${sql} is redacted without retry`, async () => {
    let calls = 0;
    const rpc = async () => { calls++; return { data: null, error: { code: sql, message: diagnostic } }; };
    await assert.rejects(approveStepUpReview({ ...base, input: approvalInput, rpc }), failure(code, status));
    await assert.rejects(revokeStepUpReview({ ...base, input: { expectedRevision: 2 }, rpc }), failure(code, status));
    assert.equal(calls, 2);
  });
}

for (const code of ['SLOT_UNAVAILABLE', 'OUTSIDE_BOOKING_WINDOW']) {
  test(`step-up controls: approval preserves canonical ${code} refusal`, async () => {
    await assert.rejects(approveStepUpReview({ ...base, input: approvalInput,
      rpc: async () => ({ data: null, error: { code: 'PT409', message: code } }) }), failure(code, 409));
  });
}

test('step-up controls: thrown outages and malformed RPC results fail closed', async () => {
  for (const rpc of [async () => { throw new Error(diagnostic); }, async () => undefined, async () => ({ data: null, error: null })]) {
    await assert.rejects(approveStepUpReview({ ...base, input: approvalInput, rpc }), failure('INTERNAL_ERROR', 500));
    await assert.rejects(revokeStepUpReview({ ...base, input: { expectedRevision: 2 }, rpc }), failure('INTERNAL_ERROR', 500));
  }
});
