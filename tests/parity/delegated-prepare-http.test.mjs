import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PROJECT_S_PUBLIC_REQUEST_MAX_BYTES } from '@project-s/contracts';
import { createDelegatedBookingPrepareHandler } from '../../supabase/functions/_shared/delegatedBookingHttp.ts';
import {
  PROJECT_S_V2_CONTRACT_MEDIA_TYPE, v2PrepareBookingResponseSchema, v2ProblemEnvelopeSchema,
} from '../../supabase/functions/_shared/.generated/contracts/dist/v2/index.js';

// Shared Node and Edge transport vectors. Database and scheduling behavior are
// covered separately by the disposable live authority proof.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const credentialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const preparationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reviewId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const mandateId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const meetingTypeId = '22222222-2222-4222-8222-222222222222';
const foreignId = '33333333-3333-4333-8333-333333333333';
const binding = {
  instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid',
};
const prepareUrl = binding.audience + '/api/v2/delegated/bookings/prepare';
const clock = '2030-02-04T12:00:00.000000Z';
const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
const verifier = createHash('sha256').update(secret).digest('hex');
const credential = 'psa2.' + credentialId + '.' +
  btoa(String.fromCharCode(...secret)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const record = {
  principalId, subjectId: principalId, actorId, credentialId, revision: 1, verifier, ...binding,
  issuedAt: clock, expiresAt: '2030-02-06T12:00:00.000000Z',
};
const input = { mandateId, username: 'synthetic-host', meetingTypeId, startAt: '2030-02-04T13:00:00.123456Z' };
const encodedInput = JSON.stringify(input);
const summary = {
  username: input.username, hostDisplayName: 'Synthetic Host', meetingTypeId,
  meetingTypeTitle: 'Synthetic meeting', startAt: input.startAt, endAt: '2030-02-04T13:30:00.123456Z',
  hostTimeZone: 'America/Halifax', guestTimeZone: 'UTC',
};
const prepared = {
  preparationId, notHeld: true, expiresAt: '2030-02-04T12:10:00.000001Z', summaryDigest: 'b'.repeat(64), summary,
};
const stepUp = {
  reviewId, reviewUrl: binding.audience + '/authority/review#review=' + reviewId,
  expiresAt: '2030-02-04T12:05:00.000001Z',
};
const diagnostic = 'private upstream diagnostic guest@example.invalid';
const lookupName = 'project_s_get_actor_credential_v2';
const prepareName = 'project_s_prepare_delegated_booking_v2';

const post = ({ url = prepareUrl, body = encodedInput, headers = {} } = {}) => new Request(url, {
  method: 'POST', body, duplex: 'half',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + credential, ...headers },
});

const fixture = ({
  lookup = () => ({ data: record, error: null }),
  operation = () => ({ data: { kind: 'prepared', data: prepared }, error: null }),
} = {}) => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === lookupName) return lookup();
    assert.equal(name, prepareName);
    return operation();
  };
  return { calls, prepare: createDelegatedBookingPrepareHandler({ binding, rpc, now: () => new Date(clock) }) };
};

const readPrivateResponse = async (response, status, mediaType) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), mediaType);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('location'), null);
  const vary = (response.headers.get('vary') ?? '').toLowerCase().split(',').map((field) => field.trim());
  assert.ok(vary.includes('authorization') && vary.includes('origin'));
  for (const [name] of response.headers) assert.equal(name.startsWith('access-control-'), false);

  const wire = await response.text();
  for (const value of [credential, credentialId, verifier, diagnostic, 'guest@example.invalid', principalId, actorId,
    mandateId, foreignId]) assert.equal(wire.includes(value), false);
  return JSON.parse(wire);
};

const problem = async (response, code, status) => {
  const { error, requestId } = v2ProblemEnvelopeSchema.parse(
    await readPrivateResponse(response, status, 'application/problem+json'),
  );
  assert.match(requestId, /^[0-9a-f-]{36}$/);
  assert.equal(error.requestId, requestId);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  assert.equal(error.type, 'https://project-s.local/problems/' + code.toLowerCase().replaceAll('_', '-'));
  assert.deepEqual(error.retry, code === 'AUTHORITY_BUSY' ? { action: 'retry_after', afterSeconds: 1 } : undefined);
  assert.equal(response.headers.get('retry-after'), code === 'AUTHORITY_BUSY' ? '1' : null);
  if (code !== 'STEP_UP_REQUIRED') assert.equal(error.stepUp, undefined);
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

test('delegated prepare HTTP delivers the exact preparation with fresh actor context and microseconds', async () => {
  const { prepare, calls } = fixture();
  const requests = [
    post({
      body: JSON.stringify({ ...input, startAt: '2030-02-04T09:00:00.123456-04:00' }),
      headers: { origin: binding.audience, 'x-principal-id': foreignId },
    }),
    post({ headers: { 'content-type': PROJECT_S_V2_CONTRACT_MEDIA_TYPE + '; charset=utf-8' } }),
  ];
  const requestIds = [];
  const generatedIds = [];
  for (const request of requests) {
    const envelope = v2PrepareBookingResponseSchema.parse(
      await readPrivateResponse(await prepare(request), 200, PROJECT_S_V2_CONTRACT_MEDIA_TYPE),
    );
    assert.deepEqual(envelope.data, prepared);
    requestIds.push(envelope.requestId);

    const [lookup, invocation] = calls.slice(-2);
    assert.deepEqual(lookup, { name: lookupName, args: {
      p_credential_id: credentialId, p_instance_id: binding.instanceId, p_epoch: binding.epoch,
    } });
    assert.equal(invocation.name, prepareName);
    const { p_preparation_id, p_step_up_id, ...args } = invocation.args;
    assert.deepEqual(args, { p_request: input, p_context: {
      contractVersion: 2, requestId: envelope.requestId, transport: 'http', verifiedAt: clock,
      instanceId: binding.instanceId, epoch: binding.epoch,
      principalId, subjectId: principalId, actorId, credentialId,
      credentialRevision: 1, credentialFingerprint: verifier,
    } });
    for (const id of [p_preparation_id, p_step_up_id]) {
      assert.match(id, /^[0-9a-f-]{36}$/);
      generatedIds.push(id);
    }
  }
  assert.deepEqual(calls.map(({ name }) => name), [lookupName, prepareName, lookupName, prepareName]);
  assert.equal(new Set(requestIds).size, 2);
  assert.equal(new Set(generatedIds).size, 4);
});

test('delegated prepare HTTP returns only the same-origin review reference for a step-up', async () => {
  const { prepare, calls } = fixture({
    operation: () => ({ data: { kind: 'step_up_required', stepUp }, error: null }),
  });
  const error = await problem(await prepare(post()), 'STEP_UP_REQUIRED', 428);
  assert.deepEqual(error.stepUp, stepUp);
  assert.equal(error.alternatives, undefined);
  assert.equal(error.fieldErrors, undefined);
  for (const value of [preparationId, summary.hostDisplayName, summary.startAt, prepared.summaryDigest]) {
    assert.equal(JSON.stringify(error).includes(value), false);
  }
  assert.deepEqual(calls.map(({ name }) => name), [lookupName, prepareName]);
});

test('delegated prepare HTTP rejects other methods, routes, URL inputs and origins before Auth', async () => {
  const { prepare, calls } = fixture();
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    await problem(await prepare(new Request(prepareUrl, { method })), 'NOT_FOUND', 404);
  }
  await problem(await prepare(post({ url: prepareUrl + '/' })), 'NOT_FOUND', 404);
  for (const suffix of ['?', '?mandateId=' + foreignId, '#', '#review=' + foreignId]) {
    await problem(await prepare(post({ url: prepareUrl + suffix })), 'VALIDATION_ERROR', 400);
  }
  await problem(await prepare(post({ headers: { origin: 'https://other.example.invalid' } })), 'FORBIDDEN', 403);
  await problem(await prepare(post({ headers: { 'content-type': 'text/plain' } })), 'VALIDATION_ERROR', 400);
  assert.deepEqual(calls, []);
});

test('delegated prepare HTTP rejects malformed, extra or duplicate fields before the operation', async () => {
  const { prepare, calls } = fixture();
  const prefix = encodedInput.slice(0, -1) + ',';
  for (const body of ['', '{', 'null', '[]', '{}', JSON.stringify({ mandateId }),
    JSON.stringify({ ...input, principalId }), JSON.stringify({ ...input, durationMinutes: 30 }),
    JSON.stringify({ ...input, startAt: 'not an instant' }),
    prefix + '"mandateId":"' + mandateId + '"}',
    prefix + '"mandate\\u0049d":"' + mandateId + '"}']) {
    await problem(await prepare(post({ body })), 'VALIDATION_ERROR', 400);
  }
  assert.ok(calls.every(({ name }) => name === lookupName));
});

test('delegated prepare HTTP verifies the actor before reading a body and rechecks on a new request', async () => {
  const { state, stream } = streamFixture([new TextEncoder().encode(encodedInput)]);
  let verifies = 0;
  const { prepare, calls } = fixture({ lookup: () => {
    assert.equal(state.pulls, verifies === 0 ? 0 : 1);
    return { data: verifies++ === 0 ? record : null, error: null };
  } });
  assert.equal((await prepare(post({ body: stream }))).status, 200);
  assert.equal(stream.locked, false);
  const removed = streamFixture([new TextEncoder().encode(encodedInput)]);
  await problem(await prepare(post({ body: removed.stream })), 'AUTHENTICATION_REQUIRED', 401);
  assert.equal(removed.state.pulls, 0);
  await problem(await prepare(post({
    headers: { authorization: 'Bearer synthetic-account-jwt', cookie: 'session=' + credential },
  })), 'AUTHENTICATION_REQUIRED', 401);
  assert.deepEqual(calls.map(({ name }) => name), [lookupName, prepareName, lookupName]);
});

test('delegated prepare HTTP bounds both declared length and streamed bytes', async () => {
  const { prepare, calls } = fixture();
  const exact = new TextEncoder().encode(encodedInput.padEnd(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES, ' '));
  assert.equal((await prepare(post({ body: exact }))).status, 200);
  const declared = streamFixture([exact]);
  await problem(await prepare(post({
    body: declared.stream, headers: { 'content-length': String(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES + 1) },
  })), 'VALIDATION_ERROR', 413);
  assert.deepEqual(declared.state, { pulls: 0, cancelled: true });
  assert.equal(declared.stream.locked, false);

  const streamed = streamFixture([exact, new Uint8Array([32]), exact]);
  await problem(await prepare(post({
    body: streamed.stream, headers: { 'content-length': '1' },
  })), 'VALIDATION_ERROR', 413);
  assert.deepEqual(streamed.state, { pulls: 2, cancelled: true });
  assert.equal(streamed.stream.locked, false);
  assert.equal(calls.filter(({ name }) => name === prepareName).length, 1);
});

test('delegated prepare HTTP preserves canonical refusals without exposing upstream detail or retrying', async () => {
  for (const [sqlstate, message, code, status] of [
    ['PT401', diagnostic, 'AUTHENTICATION_REQUIRED', 401],
    ['PT403', diagnostic, 'FORBIDDEN', 403],
    ['PT404', diagnostic, 'MEETING_TYPE_UNAVAILABLE', 404],
    ['PT409', 'VERSION_CONFLICT', 'VERSION_CONFLICT', 409],
    ['PT409', 'SLOT_UNAVAILABLE', 'SLOT_UNAVAILABLE', 409],
    ['PT409', 'OUTSIDE_BOOKING_WINDOW', 'OUTSIDE_BOOKING_WINDOW', 409],
    ['PT410', diagnostic, 'MANDATE_EXPIRED', 410],
    ['PT429', diagnostic, 'RATE_LIMITED', 429],
    ['55P03', diagnostic, 'AUTHORITY_BUSY', 503],
    ['PT409', diagnostic, 'INTERNAL_ERROR', 500],
  ]) {
    const { prepare, calls } = fixture({ operation: () => ({
      data: null, error: { code: sqlstate, message, detail: diagnostic },
    }) });
    await problem(await prepare(post()), code, status);
    assert.deepEqual(calls.map(({ name }) => name), [lookupName, prepareName]);
  }
});

test('delegated prepare HTTP fails closed on inconsistent summaries and unbound review references', async () => {
  for (const data of [
    null,
    [{ kind: 'prepared', data: prepared }, { kind: 'step_up_required', stepUp }],
    { kind: 'prepared', data: { ...prepared, summary: { ...summary, startAt: '2030-02-04T13:00:00.123455Z' } } },
    { kind: 'prepared', data: { ...prepared, summary: { ...summary, email: diagnostic } } },
    { kind: 'step_up_required', stepUp: { ...stepUp, reviewUrl: 'https://other.example.invalid/authority/review#review=' + reviewId } },
    { kind: 'step_up_required', stepUp: { ...stepUp, reviewUrl: binding.audience + '/authority/review#review=' + foreignId } },
  ]) {
    const { prepare, calls } = fixture({ operation: () => ({ data, error: null }) });
    const error = await problem(await prepare(post()), 'INTERNAL_ERROR', 500);
    for (const value of [preparationId, reviewId, summary.hostDisplayName]) {
      assert.equal(JSON.stringify(error).includes(value), false);
    }
    assert.deepEqual(calls.map(({ name }) => name), [lookupName, prepareName]);
  }
});
