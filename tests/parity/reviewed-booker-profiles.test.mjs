import assert from 'node:assert/strict';
import {
  createReviewedBookerProfile, deleteReviewedBookerProfile,
} from '../../supabase/functions/_shared/reviewedBookerProfiles.ts';

// The same bounded vectors run in Node and Deno. These RPC doubles establish
// adapter parity, not live authentication, SQL isolation or retention cleanup.
const test = globalThis.Deno?.test
  ? globalThis.Deno.test.bind(globalThis.Deno)
  : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const binding = {
  instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7,
  audience: 'https://authority.example.invalid',
};
const context = {
  contractVersion: 2, requestId: 'reviewed-profile-parity', principalId,
  subjectId: principalId, instanceId: binding.instanceId, epoch: binding.epoch,
  verifiedAt: '2030-01-01T12:00:00.000000Z', transport: 'ui',
};
const input = { name: '  Synthetic Guest  ', email: '  GUEST@Example.Invalid  ', guestTimeZone: 'America/Halifax' };
const created = (id) => ({
  profileId: id, revision: 1,
  reviewedAt: '2030-01-01T12:00:00.000001Z', expiresAt: '2030-01-08T12:00:00.000001Z',
});
const deleted = { profileId, state: 'deleted', deletedAt: '2030-01-02T12:00:00.000001Z' };
const secretDiagnostic = 'synthetic upstream diagnostic with guest@example.invalid';
const failure = (code, status) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  const safe = `${String(error)} ${JSON.stringify(error)}`;
  for (const privateValue of [secretDiagnostic, 'guest@example.invalid', input.name, principalId]) {
    assert.equal(safe.includes(privateValue), false);
  }
  return true;
};
const base = { context, binding, input };
const deleting = { context, binding, profileId, input: { expectedRevision: 1 } };

test('reviewed profiles: creation normalizes once and returns only strict server metadata', async () => {
  let calls = 0;
  const data = await createReviewedBookerProfile({ ...base, rpc: async (name, args) => {
    calls++;
    assert.equal(name, 'project_s_create_booker_profile_v2');
    assert.deepEqual(Object.keys(args).sort(), ['p_context', 'p_profile', 'p_profile_id']);
    assert.deepEqual(args.p_context, context);
    assert.deepEqual(args.p_profile, { name: 'Synthetic Guest', email: 'guest@example.invalid', guestTimeZone: input.guestTimeZone });
    assert.match(args.p_profile_id, /^[0-9a-f-]{36}$/);
    assert.notEqual(args.p_profile_id, profileId);
    return { data: created(args.p_profile_id), error: null };
  } });
  assert.deepEqual(Object.keys(data).sort(), ['expiresAt', 'profileId', 'reviewedAt', 'revision']);
  assert.equal(data.reviewedAt, '2030-01-01T12:00:00.000001Z');
  assert.equal(calls, 1);
});

for (const guestTimeZone of ['utc', 'US/Eastern', 'CET', '+01:00', '+0100', '-23:59']) {
  test(`reviewed profiles: existing time zone input preserved: ${guestTimeZone}`, async () => {
    await createReviewedBookerProfile({ ...base, input: { ...input, guestTimeZone }, rpc: async (_name, args) => {
      assert.equal(args.p_profile.guestTimeZone, guestTimeZone);
      return { data: created(args.p_profile_id), error: null };
    } });
  });
}

test('reviewed profiles: strict invalid inputs refuse before an RPC', async () => {
  const invalid = [
    null, [], {}, { ...input, notes: '' }, { ...input, principalId },
    { ...input, profileId }, { ...input, expiresAt: '2031-01-01T00:00:00Z' },
    { ...input, name: 'A' }, { ...input, name: 'bad\nname' },
    { ...input, email: 'bad..email@example.invalid' }, { ...input, email: 'guest@example.invalid\t' },
    { ...input, guestTimeZone: '+24:00' }, { ...input, guestTimeZone: 'Mars/Olympus' },
  ];
  let calls = 0;
  for (const value of invalid) {
    await assert.rejects(createReviewedBookerProfile({ ...base, input: value,
      rpc: async () => { calls++; throw new Error(secretDiagnostic); } }), failure('VALIDATION_ERROR', 400));
  }
  assert.equal(calls, 0);
});

test('reviewed profiles: existing UTF-16 name boundaries remain valid', async () => {
  for (const name of ['AB', 'X'.repeat(120), '😀'.repeat(60)]) {
    await createReviewedBookerProfile({ ...base, input: { ...input, name }, rpc: async (_name, args) => {
      assert.equal(args.p_profile.name, name);
      return { data: created(args.p_profile_id), error: null };
    } });
  }
  await assert.rejects(createReviewedBookerProfile({ ...base, input: { ...input, name: '😀'.repeat(61) },
    rpc: async () => { throw new Error('unreachable'); } }), failure('VALIDATION_ERROR', 400));
});

test('reviewed profiles: actor, foreign binding and malformed principal contexts are refused locally', async () => {
  const cases = [
    { context: { ...context, actorId: profileId } },
    { context: { ...context, subjectId: profileId } },
    { context: { ...context, epoch: 8 } }, { context: { ...context, transport: 'stdio_mcp' } },
    { context: null }, { binding: { ...binding, audience: 'http://authority.example.invalid' } },
    { binding: { ...binding, audience: 'https://authority.example.invalid/' } },
    { binding: { ...binding, epoch: 0 } }, { binding: { ...binding, extra: true } },
  ];
  let calls = 0;
  for (const overrides of cases) {
    const rpc = async () => { calls++; throw new Error(secretDiagnostic); };
    await assert.rejects(createReviewedBookerProfile({ ...base, ...overrides, rpc }), failure('AUTHENTICATION_REQUIRED', 401));
    await assert.rejects(deleteReviewedBookerProfile({ ...deleting, ...overrides, rpc }), failure('AUTHENTICATION_REQUIRED', 401));
  }
  assert.equal(calls, 0);
});

test('reviewed profiles: malformed success metadata and PII echoes fail closed', async () => {
  for (const override of [
    { revision: 2 }, { profileId }, { name: input.name }, { email: input.email },
    { reviewedAt: 'invalid' }, { expiresAt: '2030-01-08T12:00:00.000002Z' },
    { expiresAt: '2030-01-01T12:00:00.000001Z' },
  ]) {
    await assert.rejects(createReviewedBookerProfile({ ...base, rpc: async (_name, args) => ({
      data: { ...created(args.p_profile_id), ...override }, error: null,
    }) }), failure('INTERNAL_ERROR', 500));
  }
  for (const data of [null, { ...deleted, profileId: principalId }, { ...deleted, email: input.email },
    { ...deleted, state: 'active' }, { ...deleted, deletedAt: 'invalid' }]) {
    await assert.rejects(deleteReviewedBookerProfile({ ...deleting,
      rpc: async () => ({ data, error: null }) }), failure('INTERNAL_ERROR', 500));
  }
});

test('reviewed profiles: exact deletion retries retain the original minimal acknowledgement', async () => {
  let calls = 0;
  const rpc = async (name, args) => {
    calls++;
    assert.equal(name, 'project_s_delete_booker_profile_v2');
    assert.deepEqual(args, { p_context: context, p_profile_id: profileId, p_expected_revision: 1 });
    return { data: deleted, error: null };
  };
  assert.deepEqual(await deleteReviewedBookerProfile({ ...deleting, rpc }), deleted);
  assert.deepEqual(await deleteReviewedBookerProfile({ ...deleting, rpc }), deleted);
  assert.equal(calls, 2);
});

test('reviewed profiles: deletion uses strict revision input and object references', async () => {
  let calls = 0;
  for (const overrides of [
    { input: {} }, { input: { expectedRevision: 0 } }, { input: { expectedRevision: 1, principalId } },
    { input: { expectedRevision: '1' } }, { profileId: 'unknown' },
  ]) {
    await assert.rejects(deleteReviewedBookerProfile({ ...deleting, ...overrides,
      rpc: async () => { calls++; throw new Error(secretDiagnostic); } }), failure('VALIDATION_ERROR', 400));
  }
  assert.equal(calls, 0);
});

for (const [sql, code, status] of [
  ['PT400', 'VALIDATION_ERROR', 400], ['PT401', 'AUTHENTICATION_REQUIRED', 401],
  ['PT403', 'FORBIDDEN', 403], ['PT409', 'VERSION_CONFLICT', 409],
  ...['PT503', '55P03', '57014', '40P01', '40001'].map((value) => [value, 'AUTHORITY_BUSY', 503]),
  ['XX000', 'INTERNAL_ERROR', 500],
]) {
  test(`reviewed profiles: ${sql} is redacted with no automatic retry or fallback`, async () => {
    let calls = 0;
    const rpc = async () => { calls++; return { data: null, error: { code: sql, message: secretDiagnostic } }; };
    await assert.rejects(createReviewedBookerProfile({ ...base, rpc }), failure(code, status));
    await assert.rejects(deleteReviewedBookerProfile({ ...deleting, rpc }), failure(code, status));
    assert.equal(calls, 2);
  });
}

test('reviewed profiles: RPC outages and malformed results never expose diagnostics', async () => {
  for (const rpc of [async () => { throw new Error(secretDiagnostic); }, async () => undefined,
    async () => ({ data: null, error: null })]) {
    await assert.rejects(createReviewedBookerProfile({ ...base, rpc }), failure('INTERNAL_ERROR', 500));
    await assert.rejects(deleteReviewedBookerProfile({ ...deleting, rpc }), failure('INTERNAL_ERROR', 500));
  }
});
