import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PROJECT_S_PUBLIC_REQUEST_MAX_BYTES } from '@project-s/contracts';
import {
  createDelegatedBookingCommitHandler, createDelegatedBookingReceiptHandler,
} from '../../supabase/functions/_shared/delegatedBookingHttp.ts';
import {
  PROJECT_S_V2_CONTRACT_MEDIA_TYPE, v2CreateBookingResponseSchema, v2ProblemEnvelopeSchema,
} from '../../supabase/functions/_shared/.generated/contracts/dist/v2/index.js';

// Shared Node and Edge boundary vectors. Separate live tests establish SQL
// concurrency, scheduling decisions and one-booking behavior.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const credentialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const preparationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const idempotencyKey = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const receiptId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const foreignId = '22222222-2222-4222-8222-222222222222';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const commitUrl = binding.audience + '/api/v2/delegated/bookings';
const receiptUrl = binding.audience + '/api/v2/delegated/receipts/' + receiptId;
const clock = '2030-02-04T12:00:00.000000Z';
const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
const verifier = createHash('sha256').update(secret).digest('hex');
const credential = 'psa2.' + credentialId + '.' +
  btoa(String.fromCharCode(...secret)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const record = {
  principalId, subjectId: principalId, actorId, credentialId, revision: 1, verifier, ...binding,
  issuedAt: clock, expiresAt: '2030-02-06T12:00:00.000000Z',
};
const authHeaders = { authorization: 'Bearer ' + credential };
const diagnostic = 'private downstream diagnostic guest@example.invalid';
const input = { preparationId, idempotencyKey };
const encodedInput = JSON.stringify(input);
const receipt = {
  receiptId,
  receiptExpiresAt: '2030-02-05T12:00:00.000001Z',
  booking: {
    confirmationCode: 'synthetic-confirmation', status: 'confirmed', username: 'synthetic-host',
    meetingTypeId: '33333333-3333-4333-8333-333333333333', meetingTypeTitle: 'Synthetic meeting',
    startAt: '2030-02-04T13:00:00.123456Z', endAt: '2030-02-04T13:30:00.123456Z',
    hostTimeZone: 'America/Halifax', guestTimeZone: '+05:30',
  },
};
const lookupName = 'project_s_get_actor_credential_v2';
const commitName = 'project_s_commit_delegated_booking_v2';
const receiptName = 'project_s_read_delegated_booking_receipt_v2';

const request = (url, init = {}) =>
  new Request(url, { ...init, headers: { ...authHeaders, ...init.headers } });

const post = ({ url = commitUrl, body = encodedInput, headers = {} } = {}) =>
  request(url, { method: 'POST', body, duplex: 'half',
    headers: { 'content-type': 'application/json', ...headers } });

const fixture = ({ lookup = () => ({ data: record, error: null }),
  operation = () => ({ data: receipt, error: null }) } = {}) => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === lookupName) return lookup();
    assert.ok(name === commitName || name === receiptName);
    return operation(name, args);
  };
  const options = { binding, rpc, now: () => new Date(clock) };
  return { calls, commit: createDelegatedBookingCommitHandler(options), read: createDelegatedBookingReceiptHandler(options) };
};

const privacyHeaders = (response) => {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const vary = (response.headers.get('vary') ?? '').toLowerCase().split(',').map((field) => field.trim());
  assert.ok(vary.includes('authorization') && vary.includes('origin'));
  for (const [name] of response.headers) assert.equal(name.startsWith('access-control-'), false);
};

const assertPrivate = (wire, values) => {
  for (const value of values) assert.equal(wire.includes(value), false);
};

const problem = async (response, code, status) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/problem+json');
  privacyHeaders(response);
  const wire = await response.text();
  assertPrivate(wire, [credential, credentialId, verifier, diagnostic, 'guest@example.invalid', principalId,
    actorId, preparationId, idempotencyKey, receiptId, foreignId, receipt.booking.confirmationCode]);
  const { error, requestId } = v2ProblemEnvelopeSchema.parse(JSON.parse(wire));
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.equal(error.requestId, requestId);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.equal(error.type, 'https://project-s.local/problems/' + code.toLowerCase().replaceAll('_', '-'));
  return error;
};

const streamFixture = (chunks) => {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream({
    pull(controller) {
      if (state.pulls === chunks.length) controller.close();
      else controller.enqueue(chunks[state.pulls++]);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { state, stream };
};

test('delegated booking HTTP: commit retry and receipt read each verify the actor and preserve the exact receipt', async () => {
  const { commit, read, calls } = fixture();
  const results = [];
  for (const response of [
    await commit(post({ headers: { origin: binding.audience, 'x-principal-id': foreignId, 'idempotency-key': foreignId } })),
    await commit(post({ body: encodedInput.replace('"preparationId"', '"preparation\\u0049d"'),
      headers: { 'content-type': PROJECT_S_V2_CONTRACT_MEDIA_TYPE + '; charset=utf-8' } })),
    await read(request(receiptUrl, { headers: { 'content-length': '0' } })),
  ]) {
    assert.equal(response.status, results.length === 2 ? 200 : 201);
    assert.equal(response.headers.get('content-type'), PROJECT_S_V2_CONTRACT_MEDIA_TYPE);
    privacyHeaders(response);
    const wire = await response.text();
    assertPrivate(wire, [credential, credentialId, verifier, principalId, actorId, preparationId, idempotencyKey, foreignId]);
    const result = v2CreateBookingResponseSchema.parse(JSON.parse(wire));
    assert.deepEqual(result.data, receipt);
    results.push(result.requestId);
  }
  const context = (requestId) => ({ contractVersion: 2, requestId, transport: 'http',
    verifiedAt: clock, instanceId: binding.instanceId, epoch: binding.epoch,
    principalId, subjectId: principalId, actorId, credentialId, credentialRevision: 1,
    credentialFingerprint: verifier });
  const lookup = { name: lookupName, args: { p_credential_id: credentialId, p_instance_id: binding.instanceId, p_epoch: binding.epoch } };
  assert.deepEqual(calls, [
    lookup, { name: commitName, args: { p_context: context(results[0]), p_preparation_id: preparationId, p_idempotency_key: idempotencyKey } },
    lookup, { name: commitName, args: { p_context: context(results[1]), p_preparation_id: preparationId, p_idempotency_key: idempotencyKey } },
    lookup, { name: receiptName, args: { p_context: context(results[2]), p_receipt_id: receiptId } },
  ]);
  assert.equal(new Set(results).size, 3);
});

test('delegated booking HTTP: wrong routes, methods, URL input and foreign Origin never reach Auth or SQL', async () => {
  const { commit, read, calls } = fixture();
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    await problem(await commit(request(commitUrl, { method })), 'NOT_FOUND', 404);
  }
  await problem(await read(request(receiptUrl, { method: 'POST' })), 'NOT_FOUND', 404);
  await problem(await commit(post({ url: commitUrl + '/' })), 'NOT_FOUND', 404);
  await problem(await read(request(receiptUrl + '/other')), 'NOT_FOUND', 404);
  for (const suffix of ['?', '?actorId=' + foreignId, '#', '#' + idempotencyKey]) {
    await problem(await commit(post({ url: commitUrl + suffix })), 'VALIDATION_ERROR', 400);
    await problem(await read(request(receiptUrl + suffix)), 'VALIDATION_ERROR', 400);
  }
  for (const value of ['invalid', '%66' + receiptId.slice(1)]) {
    await problem(await read(request(receiptUrl.replace(receiptId, value))), 'VALIDATION_ERROR', 400);
  }
  for (const headers of [{ 'content-length': '1' }, { 'transfer-encoding': 'chunked' }]) {
    await problem(await read(request(receiptUrl, { headers })), 'VALIDATION_ERROR', 400);
  }
  const headers = { origin: 'https://other.example.invalid' };
  await problem(await commit(post({ headers })), 'FORBIDDEN', 403);
  await problem(await read(request(receiptUrl, { headers })), 'FORBIDDEN', 403);
  await problem(await commit(post({ headers: { 'content-type': 'text/plain' } })), 'VALIDATION_ERROR', 400);
  assert.deepEqual(calls, []);
});

test('delegated booking HTTP: malformed, extra, duplicate and prototype fields cannot reach the commit RPC', async () => {
  const { commit, calls } = fixture();
  const prefix = encodedInput.slice(0, -1) + ',';
  for (const body of ['', '{', 'null', '[]', '{}', JSON.stringify({ preparationId }),
    JSON.stringify({ ...input, idempotencyKey: 'invalid' }), JSON.stringify({ ...input, principalId }),
    prefix + '"idempotencyKey":"' + foreignId + '"}',
    prefix + '"idempotency\\u004bey":"' + idempotencyKey + '"}',
    prefix + '"__proto__":{}}']) {
    await problem(await commit(post({ body })), 'VALIDATION_ERROR', 400);
    assert.equal(calls.some(({ name }) => name === commitName), false);
  }
});

test('delegated booking HTTP: fresh verification precedes every body read and revoked credentials cannot continue', async () => {
  const { state, stream } = streamFixture([new TextEncoder().encode(encodedInput)]);
  let verifies = 0;
  const { commit, read, calls } = fixture({ lookup: () => {
    if (++verifies === 1) {
      assert.equal(state.pulls, 0);
      return { data: record, error: null };
    }
    return { data: null, error: null };
  } });
  assert.equal((await commit(post({ body: stream }))).status, 201);
  assert.equal(stream.locked, false);
  await problem(await commit(post()), 'AUTHENTICATION_REQUIRED', 401);
  await problem(await read(request(receiptUrl)), 'AUTHENTICATION_REQUIRED', 401);

  const headers = { authorization: 'Bearer synthetic-account-jwt', cookie: 'session=' + credential };
  await problem(await commit(post({ headers })), 'AUTHENTICATION_REQUIRED', 401);
  await problem(await read(request(receiptUrl, { headers })), 'AUTHENTICATION_REQUIRED', 401);
  assert.deepEqual(calls.map(({ name }) => name), [lookupName, commitName, lookupName, lookupName]);
});

test('delegated booking HTTP: body size is bounded by declared and streamed byte counts', async () => {
  const { commit, calls } = fixture();
  const exact = new TextEncoder().encode(encodedInput.padEnd(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES, ' '));
  assert.equal((await commit(post({ body: exact }))).status, 201);
  const excessLength = streamFixture([exact]);
  await problem(await commit(post({ body: excessLength.stream,
    headers: { 'content-length': String(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES + 1) } })), 'VALIDATION_ERROR', 413);
  assert.deepEqual(excessLength.state, { pulls: 0, cancelled: true });
  assert.equal(excessLength.stream.locked, false);

  const excessStream = streamFixture([exact, new Uint8Array([32]), exact]);
  await problem(await commit(post({ body: excessStream.stream,
    headers: { 'content-length': '1' } })), 'VALIDATION_ERROR', 413);
  assert.deepEqual(excessStream.state, { pulls: 2, cancelled: true });
  assert.equal(excessStream.stream.locked, false);
  assert.equal(calls.filter(({ name }) => name === commitName).length, 1);
});

test('delegated booking HTTP: inaccessible and unusable authority have one redacted refusal', async () => {
  const results = [];
  for (const message of ['pending ' + preparationId, 'revoked ' + diagnostic, 'belongs to ' + foreignId]) {
    const { commit, read } = fixture({ operation: () => ({ data: null, error: { code: 'PT403', message } }) });
    results.push(await problem(await commit(post()), 'FORBIDDEN', 403));
    results.push(await problem(await read(request(receiptUrl)), 'FORBIDDEN', 403));
  }
  for (const error of results) assert.deepEqual({ ...error, requestId: '' }, { ...results[0], requestId: '' });
});

test('delegated booking HTTP: canonical decisions survive serialization without automatic replay', async () => {
  for (const [method, sqlstate, message, code, status] of [
    ['commit', 'PT409', 'SLOT_UNAVAILABLE', 'SLOT_UNAVAILABLE', 409],
    ['read', 'PT409', 'SLOT_UNAVAILABLE', 'SLOT_UNAVAILABLE', 409],
    ['commit', 'PT409', 'OUTSIDE_BOOKING_WINDOW', 'OUTSIDE_BOOKING_WINDOW', 409],
    ['commit', 'PT409', 'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_REUSED', 409],
    ['commit', 'PT409', 'PREPARATION_STALE', 'PREPARATION_STALE', 409],
    ['commit', 'PT410', 'MANDATE_EXPIRED', 'MANDATE_EXPIRED', 410],
    ['read', 'PT410', 'RECEIPT_UNAVAILABLE', 'RECEIPT_UNAVAILABLE', 410],
    ['commit', 'PT401', diagnostic, 'AUTHENTICATION_REQUIRED', 401],
    ['commit', '40001', diagnostic, 'AUTHORITY_BUSY', 503],
    ['read', '55P03', diagnostic, 'AUTHORITY_BUSY', 503],
    ['commit', 'PT409', diagnostic, 'INTERNAL_ERROR', 500],
  ]) {
    const { commit, read, calls } = fixture({ operation: () => ({
      data: null, error: { code: sqlstate, message, detail: diagnostic },
    }) });
    const response = method === 'commit' ? await commit(post()) : await read(request(receiptUrl));
    assert.equal(response.headers.get('retry-after'), status === 503 ? '1' : null);
    const error = await problem(response, code, status);
    assert.deepEqual(error.retry, status === 503 ? { action: 'retry_after', afterSeconds: 1 } : undefined);
    assert.deepEqual(calls.map(({ name }) => name), [lookupName, method === 'commit' ? commitName : receiptName]);
  }
});

test('delegated booking HTTP: malformed or mismatched receipts fail closed', async () => {
  const mismatched = fixture({ operation: () => ({ data: { ...receipt, receiptId: foreignId }, error: null }) });
  await problem(await mismatched.read(request(receiptUrl)), 'INTERNAL_ERROR', 500);
  for (const data of [null, { ...receipt, preparationId },
    { ...receipt, booking: { ...receipt.booking, email: diagnostic } },
    { ...receipt, booking: { ...receipt.booking, status: 'cancelled' } }]) {
    const { commit, read } = fixture({ operation: () => ({ data, error: null }) });
    await problem(await commit(post()), 'INTERNAL_ERROR', 500);
    await problem(await read(request(receiptUrl)), 'INTERNAL_ERROR', 500);
  }
});
