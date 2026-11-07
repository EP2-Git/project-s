import assert from 'node:assert/strict';
import { commitDelegatedBooking, prepareDelegatedBooking, readDelegatedBookingReceipt }
  from '../../supabase/functions/_shared/delegatedPreparations.ts';

// Shared Node/Deno adapter vectors; database/Auth/locking evidence is separate.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const credentialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const preparationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reviewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const context = { contractVersion: 2, requestId: 'delegated-preparation-parity', principalId, subjectId: principalId,
  actorId, credentialId, credentialRevision: 1, credentialFingerprint: 'a'.repeat(64),
  instanceId: binding.instanceId, epoch: 7, verifiedAt: '2030-02-04T12:00:00.000001Z', transport: 'http' };
const input = { mandateId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', username: 'synthetic-host',
  meetingTypeId: '22222222-2222-4222-8222-222222222222', startAt: '2030-02-04T13:00:00.123456Z' };
const summary = { username: input.username, hostDisplayName: 'Synthetic Host', meetingTypeId: input.meetingTypeId,
  meetingTypeTitle: 'Synthetic meeting', startAt: input.startAt, endAt: '2030-02-04T13:30:00.123456Z',
  hostTimeZone: 'America/Halifax', guestTimeZone: 'UTC' };
const prepared = { kind: 'prepared', data: { preparationId, notHeld: true,
  expiresAt: '2030-02-04T12:10:00.000001Z', summaryDigest: 'b'.repeat(64), summary } };
const stepUp = { kind: 'step_up_required', stepUp: { reviewId,
  reviewUrl: `${binding.audience}/authority/review#review=${reviewId}`, expiresAt: '2030-02-04T12:05:00.000001Z' } };
const diagnostic = 'private upstream diagnostic guest@example.invalid';
const base = { context, input, binding };
const receiptId = '45454545-4545-4545-8545-454545454545';
const retryKey = '55555555-5555-4555-8555-555555555555';
const commitInput = { preparationId, idempotencyKey: retryKey };
const { hostDisplayName: _hostDisplayName, ...bookingFields } = summary;
const receipt = { receiptId, receiptExpiresAt: '2030-02-05T12:00:00.000001Z',
  booking: { ...bookingFields, guestTimeZone: '+05:30', confirmationCode: 'synthetic-confirmation', status: 'confirmed' } };
const commitBase = { context, binding, input: commitInput };
const failure = (code, status) => (error) => {
  assert.equal(error.code, code); assert.equal(error.status, status);
  const text = `${String(error)} ${JSON.stringify(error)}`;
  for (const privateValue of [diagnostic, principalId, credentialId, context.credentialFingerprint, 'guest@example.invalid']) {
    assert.equal(text.includes(privateValue), false);
  }
  if (code === 'AUTHORITY_BUSY') assert.deepEqual(error.retry, { action: 'retry_after', afterSeconds: 1 });
  return true;
};

test('delegated commit: exact retry keeps the same preparation and key, and reads only the bound receipt', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    return { data: receipt, error: null };
  };
  assert.deepEqual(await commitDelegatedBooking({ ...commitBase, rpc }), receipt);
  assert.deepEqual(await commitDelegatedBooking({ ...commitBase, rpc }), receipt);
  assert.deepEqual(await readDelegatedBookingReceipt({ context, binding, receiptId, rpc }), receipt);
  assert.deepEqual(calls, [
    ['project_s_commit_delegated_booking_v2', { p_context: context, p_preparation_id: preparationId, p_idempotency_key: retryKey }],
    ['project_s_commit_delegated_booking_v2', { p_context: context, p_preparation_id: preparationId, p_idempotency_key: retryKey }],
    ['project_s_read_delegated_booking_receipt_v2', { p_context: context, p_receipt_id: receiptId }],
  ]);
});

test('delegated commit: malformed, caller-supplied identity and extra fields fail before RPC', async () => {
  let calls = 0;
  const rpc = async () => { calls++; return { data: receipt, error: null }; };
  for (const value of [null, { ...commitInput, principalId }, { ...commitInput, approved: true },
    { ...commitInput, idempotencyKey: 'invalid' }, JSON.parse(`{${JSON.stringify(commitInput).slice(1, -1)},"__proto__":{}}`)]) {
    await assert.rejects(commitDelegatedBooking({ ...commitBase, input: value, rpc }), failure('VALIDATION_ERROR', 400));
  }
  await assert.rejects(commitDelegatedBooking({ ...commitBase, context: { ...context, subjectId: actorId }, rpc }),
    failure('AUTHENTICATION_REQUIRED', 401));
  await assert.rejects(readDelegatedBookingReceipt({ context, binding, receiptId: 'invalid', rpc }),
    failure('VALIDATION_ERROR', 400));
  assert.equal(calls, 0);
});

test('delegated receipt: strict fields reject accidental secrets, prototypes and mismatched lookup IDs', async () => {
  for (const raw of [{ ...receipt, idempotencyKey: retryKey },
    { ...receipt, booking: { ...receipt.booking, email: 'guest@example.invalid' } },
    { ...receipt, booking: JSON.parse(`{${JSON.stringify(receipt.booking).slice(1, -1)},"__proto__":{}}`) }]) {
    await assert.rejects(commitDelegatedBooking({ ...commitBase, rpc: async () => ({ data: raw }) }),
      failure('INTERNAL_ERROR', 500));
  }
  await assert.rejects(readDelegatedBookingReceipt({ context, binding, receiptId: preparationId,
    rpc: async () => ({ data: receipt }) }), failure('INTERNAL_ERROR', 500));
});

test('delegated commit and receipt: canonical refusals remain distinct and private failures stay redacted', async () => {
  for (const [sqlstate, message, code, status] of [
    ['PT409', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_REUSED', 409],
    ['PT409', 'SLOT_UNAVAILABLE', 'SLOT_UNAVAILABLE', 409],
    ['PT409', 'PREPARATION_STALE', 'PREPARATION_STALE', 409],
    ['PT410', 'MANDATE_EXPIRED', 'MANDATE_EXPIRED', 410],
    ['PT410', 'RECEIPT_UNAVAILABLE', 'RECEIPT_UNAVAILABLE', 410],
    ['PT503', diagnostic, 'AUTHORITY_BUSY', 503],
    ['PT410', diagnostic, 'INTERNAL_ERROR', 500],
  ]) {
    await assert.rejects(commitDelegatedBooking({ ...commitBase,
      rpc: async () => ({ error: { code: sqlstate, message } }) }), failure(code, status));
  }
  await assert.rejects(readDelegatedBookingReceipt({ context, binding, receiptId,
    rpc: async () => { throw new Error(diagnostic); } }), failure('INTERNAL_ERROR', 500));
});

test('delegated preparations: strict actor/request normalization retains all microseconds', async () => {
  let calls = 0;
  const result = await prepareDelegatedBooking({ ...base, input: { ...input, startAt: '2030-02-04T09:00:00.123456-04:00' },
    rpc: async (name, args) => {
      calls++;
      assert.equal(name, 'project_s_prepare_delegated_booking_v2');
      assert.deepEqual(Object.keys(args).sort(), ['p_context', 'p_preparation_id', 'p_request', 'p_step_up_id']);
      assert.deepEqual(args.p_context, context); assert.deepEqual(args.p_request, input);
      assert.match(args.p_preparation_id, /^[0-9a-f-]{36}$/); assert.match(args.p_step_up_id, /^[0-9a-f-]{36}$/);
      assert.notEqual(args.p_preparation_id, args.p_step_up_id);
      return { data: prepared, error: null };
    } });
  assert.deepEqual(result, prepared); assert.equal(calls, 1);
});

test('delegated preparations: exact repeated intent can reconcile the original private preparation ID', async () => {
  const proposed = [];
  const rpc = async (_name, args) => { proposed.push(args.p_preparation_id); return { data: prepared, error: null }; };
  assert.deepEqual(await prepareDelegatedBooking({ ...base, rpc }), prepared);
  assert.deepEqual(await prepareDelegatedBooking({ ...base, rpc }), prepared);
  assert.equal(new Set(proposed).size, 2);
});

test('delegated preparations: out-of-scope result is only a strict bound step-up reference', async () => {
  let calls = 0;
  const rpc = async () => { calls++; return { data: stepUp, error: null }; };
  assert.deepEqual(await prepareDelegatedBooking({ ...base, rpc }), stepUp);
  assert.deepEqual(await prepareDelegatedBooking({ ...base, rpc }), stepUp);
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(stepUp.stepUp).sort(), ['expiresAt', 'reviewId', 'reviewUrl']);
});

test('delegated preparations: caller cannot override identity, policy, duration, end, booker, notes or approval', async () => {
  let calls = 0;
  for (const value of [null, [], {}, { ...input, actorId }, { ...input, principalId }, { ...input, confirmed: true },
    { ...input, endAt: summary.endAt }, { ...input, durationMinutes: 30 }, { ...input, booker: { name: 'Guest' } },
    { ...input, notes: '' }, { ...input, provider: 'browser_v1' }, { ...input, username: ' SYNTHETIC-HOST ' },
    { ...input, mandateId: 'bad' }, { ...input, startAt: 'invalid' }]) {
    await assert.rejects(prepareDelegatedBooking({ ...base, input: value,
      rpc: async () => { calls++; throw new Error(diagnostic); } }), failure('VALIDATION_ERROR', 400));
  }
  assert.equal(calls, 0);
});

test('delegated preparations: principal-only, forged/malformed context and foreign binding fail before RPC', async () => {
  let calls = 0;
  const { actorId: _actor, credentialId: _id, credentialRevision: _revision, credentialFingerprint: _fingerprint, ...principal } = context;
  for (const override of [
    { context: principal }, { context: null }, { context: { ...context, subjectId: actorId } },
    { context: { ...context, credentialFingerprint: 'A'.repeat(64) } }, { context: { ...context, epoch: 8 } },
    { context: { ...context, transport: 'ui' } }, { context: { ...context, authorization: diagnostic } },
    { binding: { ...binding, audience: 'http://remote.example.invalid' } },
    { binding: { ...binding, audience: `${binding.audience}/` } }, { binding: { ...binding, extra: true } },
  ]) {
    await assert.rejects(prepareDelegatedBooking({ ...base, ...override,
      rpc: async () => { calls++; throw new Error(diagnostic); } }), failure('AUTHENTICATION_REQUIRED', 401));
  }
  assert.equal(calls, 0);
});

test('delegated preparations: HTTP and local MCP retain the same authenticated boundary', async () => {
  for (const transport of ['http', 'stdio_mcp']) {
    assert.deepEqual(await prepareDelegatedBooking({ ...base, context: { ...context, transport }, rpc: async (_name, args) => {
      assert.equal(args.p_context.transport, transport); return { data: prepared, error: null };
    } }), prepared);
  }
});

test('delegated preparations: forged/foreign step-up URLs and private-field echoes fail closed', async () => {
  for (const patch of [
    { reviewUrl: `https://other.example.invalid/authority/review#review=${reviewId}` },
    { reviewUrl: `${binding.audience}/authority/review?x=1#review=${reviewId}` },
    { reviewUrl: `${binding.audience}/authority/review#review=${preparationId}` },
    { reviewUrl: 'not a URL' }, { reviewId: 'bad' }, { expiresAt: 'invalid' },
    { name: 'Synthetic Booker' }, { principalId },
  ]) {
    await assert.rejects(prepareDelegatedBooking({ ...base,
      rpc: async () => ({ data: { ...stepUp, stepUp: { ...stepUp.stepUp, ...patch } }, error: null }) }), failure('INTERNAL_ERROR', 500));
  }
});

test('delegated preparations: malformed results cannot grant permission or expose another intent', async () => {
  const invalid = [null, { allowed: true }, { ...prepared, credentialId }, { kind: 'prepared', data: null },
    { ...prepared, data: { ...prepared.data, notHeld: false } },
    { ...prepared, data: { ...prepared.data, preparationToken: diagnostic } },
    { ...prepared, data: { ...prepared.data, summaryDigest: 'bad' } },
    ...[{ username: 'other-host' }, { meetingTypeId: reviewId }, { startAt: '2030-02-04T13:00:00.123455Z' },
      { endAt: input.startAt }, { email: 'guest@example.invalid' }, { booker: { name: 'Guest' } }]
      .map(patch => ({ ...prepared, data: { ...prepared.data, summary: { ...summary, ...patch } } })),
  ];
  for (const data of invalid) await assert.rejects(prepareDelegatedBooking({ ...base,
    rpc: async () => ({ data, error: null }) }), failure('INTERNAL_ERROR', 500));
});

for (const [sql, message, code, status] of [
  ['PT400', diagnostic, 'VALIDATION_ERROR', 400], ['PT401', diagnostic, 'AUTHENTICATION_REQUIRED', 401],
  ['PT403', diagnostic, 'FORBIDDEN', 403], ['PT404', diagnostic, 'MEETING_TYPE_UNAVAILABLE', 404],
  ['PT410', diagnostic, 'MANDATE_EXPIRED', 410], ['PT429', diagnostic, 'RATE_LIMITED', 429],
  ['PT409', 'VERSION_CONFLICT', 'VERSION_CONFLICT', 409], ['PT409', 'SLOT_UNAVAILABLE', 'SLOT_UNAVAILABLE', 409],
  ['PT409', 'OUTSIDE_BOOKING_WINDOW', 'OUTSIDE_BOOKING_WINDOW', 409],
  ...['PT503', '55P03', '57014', '40P01', '40001'].map(sql => [sql, diagnostic, 'AUTHORITY_BUSY', 503]),
  ['PT409', diagnostic, 'INTERNAL_ERROR', 500], ['PT409', '__proto__', 'INTERNAL_ERROR', 500],
  ['PT409', 'toString', 'INTERNAL_ERROR', 500], ['XX000', diagnostic, 'INTERNAL_ERROR', 500],
]) {
  test(`delegated preparations: ${sql}/${code} is redacted with no automatic retry/provider fallback`, async () => {
    let calls = 0;
    await assert.rejects(prepareDelegatedBooking({ ...base, rpc: async () => {
      calls++; return { data: null, error: { code: sql, message } };
    } }), failure(code, status));
    assert.equal(calls, 1);
  });
}

test('delegated preparations: RPC outages and malformed results never leak diagnostics', async () => {
  for (const rpc of [async () => { throw new Error(diagnostic); }, async () => undefined,
    async () => ({ data: null, error: null })]) {
    await assert.rejects(prepareDelegatedBooking({ ...base, rpc }), failure('INTERNAL_ERROR', 500));
  }
});
