import assert from 'node:assert/strict';
import { PROJECT_S_PUBLIC_REQUEST_MAX_BYTES } from '@project-s/contracts';
import { createStepUpActionHandler } from '../../supabase/functions/_shared/stepUpActionHttp.ts';
import { createStepUpReviewHandler } from '../../supabase/functions/_shared/stepUpReviewHttp.ts';
import {
  v2ProblemEnvelopeSchema, v2StepUpApprovedResponseSchema, v2StepUpRevokedResponseSchema,
} from '../../supabase/functions/_shared/.generated/contracts/dist/v2/index.js';

// Shared Node/Edge action-boundary vectors. Auth/RPC doubles do not establish a
// served endpoint, live verification, SQL atomicity or a usable approval screen.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherPrincipalId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const preparationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const token = 'synthetic-account-jwt';
const diagnostic = 'private upstream diagnostic guest@example.invalid';
const digest = 'a'.repeat(64);
const approval = { expectedRevision: 1, summaryDigest: digest };
const approved = { reviewId, state: 'approved', preparationId, expiresAt: '2030-02-04T12:05:00.000000Z' };
const revoked = { reviewId, state: 'revoked', revision: 2, revokedAt: '2030-02-04T12:00:00.000000Z' };
const endpoint = (action = 'approve', id = reviewId) => `${binding.audience}/api/v2/authority/step-ups/${id}/${action}`;
const request = (action = 'approve', input = approval, init = {}) => new Request(endpoint(action), {
  method: 'POST', body: JSON.stringify(input), ...init,
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  duplex: 'half',
});
const fixture = (overrides = {}) => {
  const calls = { auth: [], rpc: [] };
  const auth = { getUser: async (jwt) => {
    calls.auth.push(jwt);
    return { data: { user: { id: principalId, is_anonymous: false } }, error: null };
  } };
  const rpc = async (name, args) => {
    calls.rpc.push({ name, args });
    assert.ok(['project_s_approve_step_up_v2', 'project_s_revoke_step_up_v2'].includes(name),
      'No pending-review preflight or v1 fallback may replace an action');
    return { data: name === 'project_s_approve_step_up_v2' ? structuredClone(approved)
      : { ...revoked, revision: args.p_expected_revision + 1 }, error: null };
  };
  return { calls, handle: createStepUpActionHandler({ binding, auth, rpc,
    now: () => new Date('2030-02-04T12:00:00.000Z'), ...overrides }) };
};
const privacyHeaders = (response) => {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const vary = (response.headers.get('vary') ?? '').toLowerCase().split(',').map((name) => name.trim());
  assert.ok(vary.includes('authorization') && vary.includes('origin'));
  for (const [name] of response.headers) assert.equal(name.startsWith('access-control-'), false);
};
const problem = async (response, code, status) => {
  assert.equal(response.status, status);
  privacyHeaders(response);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json(?:;|$)/);
  const wire = await response.text();
  const result = v2ProblemEnvelopeSchema.parse(JSON.parse(wire));
  assert.equal(result.error.code, code);
  assert.equal(result.error.status, status);
  const details = {
    AUTHENTICATION_REQUIRED: 'Authentication is required.',
    FORBIDDEN: 'This operation is not permitted.',
    VALIDATION_ERROR: status === 413 ? 'The request body is too large.' : 'The review request is invalid.',
    NOT_FOUND: 'No review endpoint matches this request.',
    VERSION_CONFLICT: 'The authority state has changed.',
    SLOT_UNAVAILABLE: 'The selected slot is unavailable.',
    OUTSIDE_BOOKING_WINDOW: "The meeting is outside the host's booking window.",
    AUTHORITY_BUSY: 'The authority service is busy. Retry the same request.',
    INTERNAL_ERROR: 'The authority service could not complete the request.',
  };
  assert.equal(result.error.detail, details[code]);
  assert.equal(result.error.title, 'Project S review request failed');
  assert.equal(result.error.type, `https://project-s.local/problems/${code.toLowerCase().replaceAll('_', '-')}`);
  assert.equal(result.requestId, result.error.requestId);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  for (const privateValue of [token, diagnostic, principalId, otherPrincipalId, reviewId, preparationId, digest,
    'client-private-request-id']) assert.equal(wire.includes(privateValue), false, `Reflected ${privateValue}`);
  return result;
};
const streamFixture = (chunks) => {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream({
    pull(controller) {
      if (state.pulls === chunks.length) { controller.close(); return; }
      controller.enqueue(chunks[state.pulls++]);
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { state, stream };
};

test('step-up HTTP action: approval freshly derives principal context and returns only the exact acknowledgement', async () => {
  const { handle, calls } = fixture();
  const ids = [];
  for (const mediaType of ['application/json', 'application/vnd.project-s.v2+json; charset=utf-8']) {
    const response = await handle(request('approve', approval, { headers: {
      'content-type': mediaType, ...(ids.length ? { origin: binding.audience } : {}),
      'x-principal-id': otherPrincipalId, 'x-request-id': 'client-private-request-id',
    } }));
    assert.equal(response.status, 200);
    privacyHeaders(response);
    assert.match(response.headers.get('content-type') ?? '', /^application\/vnd\.project-s\.v2\+json(?:;|$)/);
    const result = v2StepUpApprovedResponseSchema.parse(await response.json());
    assert.deepEqual(result.data, approved);
    ids.push(result.requestId);
    const { name, args } = calls.rpc.at(-1);
    assert.equal(name, 'project_s_approve_step_up_v2');
    assert.deepEqual(Object.keys(args).sort(), ['p_context', 'p_expected_revision', 'p_grant_id',
      'p_preparation_id', 'p_review_id', 'p_summary_digest']);
    assert.deepEqual(args.p_context, { contractVersion: 2, principalId, subjectId: principalId,
      instanceId: binding.instanceId, epoch: binding.epoch, transport: 'http',
      verifiedAt: '2030-02-04T12:00:00.000000Z', requestId: result.requestId });
    assert.equal(args.p_review_id, reviewId);
    assert.equal(args.p_expected_revision, 1);
    assert.equal(args.p_summary_digest, digest);
    assert.match(args.p_preparation_id, /^[0-9a-f-]{36}$/);
    assert.match(args.p_grant_id, /^[0-9a-f-]{36}$/);
  }
  assert.deepEqual(calls.auth, [token, token]);
  assert.equal(calls.rpc.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test('step-up HTTP action: pending and approved revoke preserve the exact CAS and eligible retry result', async () => {
  const { handle, calls } = fixture();
  for (const expectedRevision of [1, 2]) {
    const results = [];
    for (let retry = 0; retry < 2; retry++) {
      const response = await handle(request('revoke', { expectedRevision }));
      assert.equal(response.status, 200);
      privacyHeaders(response);
      const result = v2StepUpRevokedResponseSchema.parse(await response.json());
      results.push(result.data);
      assert.deepEqual(result.data, { ...revoked, revision: expectedRevision + 1 });
      const { name, args } = calls.rpc.at(-1);
      assert.equal(name, 'project_s_revoke_step_up_v2');
      assert.deepEqual(Object.keys(args).sort(), ['p_context', 'p_expected_revision', 'p_review_id']);
      assert.equal(args.p_expected_revision, expectedRevision);
      assert.equal(args.p_review_id, reviewId);
    }
    assert.deepEqual(results[0], results[1]);
  }
  assert.equal(calls.auth.length, 4);
  assert.equal(calls.rpc.length, 4);
});

test('step-up HTTP action: exact approval retries reach the transaction directly and return its original preparation', async () => {
  let original;
  const proposed = [];
  let authCalls = 0;
  const { handle } = fixture({ auth: { getUser: async () => {
    authCalls++;
    return { data: { user: { id: principalId, is_anonymous: false } }, error: null };
  } }, rpc: async (name, args) => {
    assert.equal(name, 'project_s_approve_step_up_v2', 'Pending-only GET must not gate an approved retry');
    proposed.push(args.p_preparation_id, args.p_grant_id);
    original ??= { ...approved, preparationId: args.p_preparation_id };
    return { data: original, error: null };
  } });
  const results = [];
  for (let retry = 0; retry < 2; retry++) {
    const response = await handle(request());
    assert.equal(response.status, 200);
    results.push(v2StepUpApprovedResponseSchema.parse(await response.json()).data);
  }
  assert.deepEqual(results[0], results[1]);
  assert.equal(authCalls, 2);
  assert.equal(new Set(proposed).size, 4);
});

test('step-up HTTP action: legacy UUID and case normalization do not weaken ownership verification', async () => {
  for (const id of [reviewId.toUpperCase(), '11111111-1111-0111-1111-111111111111']) {
    const { handle } = fixture({ rpc: async (name, args) => {
      assert.equal(name, 'project_s_approve_step_up_v2');
      assert.equal(args.p_review_id, id.toLowerCase());
      return { data: { ...approved, reviewId: args.p_review_id }, error: null };
    } });
    const req = request();
    const response = await handle(new Request(endpoint('approve', id), req));
    assert.equal(response.status, 200);
  }
});

test('step-up HTTP action: a previous success cannot cache an account that loses verification', async () => {
  let authCalls = 0;
  const { handle, calls } = fixture({ auth: { getUser: async () => {
    authCalls++;
    return authCalls === 1 ? { data: { user: { id: principalId, is_anonymous: false } }, error: null }
      : { data: { user: null }, error: diagnostic };
  } } });
  assert.equal((await handle(request())).status, 200);
  await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
  assert.equal(authCalls, 2);
  assert.equal(calls.rpc.length, 1);
});

test('step-up HTTP action: actor tokens, absent credentials and cookie identity never reach Auth or RPC', async () => {
  for (const authorization of ['', 'Basic opaque', 'Bearer psa2.opaque', 'Bearer token with whitespace']) {
    const { handle, calls } = fixture();
    await problem(await handle(request('approve', approval, { headers: { authorization, cookie: `session=${token}` } })),
      'AUTHENTICATION_REQUIRED', 401);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
  const { handle, calls } = fixture();
  const req = request('revoke', { expectedRevision: 1 }, { headers: { cookie: `session=${token}` } });
  req.headers.delete('authorization');
  await problem(await handle(req), 'AUTHENTICATION_REQUIRED', 401);
  assert.equal(calls.auth.length, 0);
  assert.equal(calls.rpc.length, 0);
});

test('step-up HTTP action: anonymous, missing and failed verified accounts never reach SQL', async () => {
  for (const user of [null, { id: principalId, is_anonymous: true }, { id: principalId },
    { id: 'invalid', is_anonymous: false }]) {
    const { handle, calls } = fixture({ auth: { getUser: async () => ({ data: { user }, error: null }) } });
    await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
    assert.equal(calls.rpc.length, 0);
  }
  for (const getUser of [async () => ({ data: { user: { id: principalId, is_anonymous: false } }, error: diagnostic }),
    async () => { throw new Error(diagnostic); }]) {
    const { handle, calls } = fixture({ auth: { getUser } });
    await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: malformed binding and foreign origins fail before account verification or SQL', async () => {
  for (const invalidBinding of [{ ...binding, epoch: 0 }, { ...binding, instanceId: 'invalid' },
    { ...binding, audience: 'http://remote.example.invalid' }, { ...binding, principalId }]) {
    const { handle, calls } = fixture({ binding: invalidBinding });
    await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
  for (const origin of ['null', 'https://other.example.invalid', `${binding.audience}/`, `${binding.audience}.other.invalid`]) {
    const { handle, calls } = fixture();
    await problem(await handle(request('approve', approval, { headers: { origin } })), 'FORBIDDEN', 403);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: unsupported methods and routes cannot perform a mutation or CORS preflight', async () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
    const { handle, calls } = fixture();
    await problem(await handle(request('approve', approval, { method, body: undefined })), 'NOT_FOUND', 404);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
  for (const path of [`/api/v1/authority/step-ups/${reviewId}/approve`, `/api/v2/authority/step-ups/${reviewId}`,
    `/api/v2/authority/step-ups/${reviewId}/approve/`, `/api/v2/authority/step-ups/${reviewId}/decline`,
    `/api/v2/delegated/step-ups/${reviewId}/approve`]) {
    const { handle, calls } = fixture();
    await problem(await handle(new Request(new URL(path, binding.audience), request())), 'NOT_FOUND', 404);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: the separate review factory stays read-only for approve and revoke requests', async () => {
  let authCalls = 0;
  let rpcCalls = 0;
  const handle = createStepUpReviewHandler({ binding,
    auth: { getUser: async () => { authCalls++; throw new Error('Read-only factory must refuse before Auth'); } },
    rpc: async () => { rpcCalls++; throw new Error('Read-only factory must never invoke an action'); },
  });
  for (const action of ['approve', 'revoke']) {
    await problem(await handle(request(action, action === 'approve' ? approval : { expectedRevision: 1 })),
      'NOT_FOUND', 404);
    await problem(await handle(new Request(`${binding.audience}/api/v2/authority/step-ups/${reviewId}`, request(action))),
      'NOT_FOUND', 404);
  }
  assert.equal(authCalls, 0);
  assert.equal(rpcCalls, 0);
});

test('step-up HTTP action: query overrides, fragments and malformed references never reach SQL', async () => {
  for (const extra of ['?', `?principalId=${otherPrincipalId}`, '?context=%7B%7D', '?summaryDigest=other', '#review=other']) {
    const { handle, calls } = fixture();
    await problem(await handle(new Request(endpoint() + extra, request())), 'VALIDATION_ERROR', 400);
    assert.equal(calls.rpc.length, 0);
  }
  for (const id of ['invalid', 'bbbbbbbb-bbbb-xbbb-8bbb-bbbbbbbbbbbb', `${reviewId}%2Fapprove`]) {
    const { handle, calls } = fixture();
    const response = await handle(new Request(endpoint('approve', id), request()));
    assert.ok([400, 404].includes(response.status));
    privacyHeaders(response);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: missing, text and form content types cannot submit otherwise valid JSON', async () => {
  for (const contentType of ['', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data',
    'application/vnd.project-s.v1+json']) {
    const { handle, calls } = fixture();
    const req = request('approve', approval, { headers: { 'content-type': contentType } });
    if (!contentType) req.headers.delete('content-type');
    await problem(await handle(req), 'VALIDATION_ERROR', 400);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: unknown authority fields and malformed CAS or digest are rejected before SQL', async () => {
  for (const input of [null, [], {}, { ...approval, expectedRevision: 0 }, { ...approval, expectedRevision: '1' },
    { ...approval, summaryDigest: digest.toUpperCase() }, { ...approval, confirmed: true },
    { ...approval, principalId }, { ...approval, context: { principalId } }, { ...approval, provider: 'browser_v1' },
    { ...approval, ...JSON.parse('{"__proto__":{"private":true}}') }]) {
    const { handle, calls } = fixture();
    await problem(await handle(request('approve', input)), 'VALIDATION_ERROR', 400);
    assert.equal(calls.rpc.length, 0);
  }
  for (const input of [{}, { expectedRevision: 0 }, { expectedRevision: '1' },
    { expectedRevision: 1, summaryDigest: digest }, { expectedRevision: 1, actorId: principalId }]) {
    const { handle, calls } = fixture();
    await problem(await handle(request('revoke', input)), 'VALIDATION_ERROR', 400);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: malformed or empty JSON is a fixed validation refusal without a mutation', async () => {
  for (const body of ['', '{', JSON.stringify({ expectedRevision: 1, summaryDigest: diagnostic })]) {
    const { handle, calls } = fixture();
    await problem(await handle(request('approve', approval, { body })), 'VALIDATION_ERROR', 400);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: fresh Auth completes before any streamed body is consumed', async () => {
  const { state, stream } = streamFixture([new TextEncoder().encode(JSON.stringify(approval))]);
  const { handle } = fixture({ auth: { getUser: async () => {
    assert.equal(state.pulls, 0);
    return { data: { user: { id: principalId, is_anonymous: false } }, error: null };
  } } });
  assert.equal((await handle(request('approve', approval, { body: stream }))).status, 200);
  assert.equal(stream.locked, false);
});

test('step-up HTTP action: an exact-boundary JSON body remains valid', async () => {
  const encoded = JSON.stringify(approval);
  const body = encoded + ' '.repeat(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES - new TextEncoder().encode(encoded).length);
  const { handle, calls } = fixture();
  assert.equal((await handle(request('approve', approval, { body }))).status, 200);
  assert.equal(calls.rpc.length, 1);
});

test('step-up HTTP action: excessive declared body length cancels before reading or mutating', async () => {
  const { state, stream } = streamFixture([new TextEncoder().encode(JSON.stringify(approval))]);
  const { handle, calls } = fixture();
  await problem(await handle(request('approve', approval, { body: stream,
    headers: { 'content-length': String(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES + 1) } })), 'VALIDATION_ERROR', 413);
  assert.equal(state.pulls, 0);
  assert.equal(state.cancelled, true);
  assert.equal(stream.locked, false);
  assert.equal(calls.rpc.length, 0);
});

test('step-up HTTP action: stream byte limit cannot be bypassed with absent or forged content length', async () => {
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': 'invalid' }]) {
    const { state, stream } = streamFixture(Array.from({ length: 40 }, () => new Uint8Array(1_024).fill(32)));
    const { handle, calls } = fixture();
    await problem(await handle(request('approve', approval, { body: stream, headers })), 'VALIDATION_ERROR', 413);
    assert.equal(state.pulls, 17);
    assert.equal(state.cancelled, true);
    assert.equal(stream.locked, false);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP action: body aborts and stream failures cannot mutate or reflect their causes', async () => {
  const abort = new AbortController();
  let cancelled = false;
  const pending = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const { handle, calls } = fixture();
  const response = handle(request('approve', approval, { body: pending, signal: abort.signal }));
  abort.abort(new Error(diagnostic));
  await problem(await response, 'INTERNAL_ERROR', 500);
  assert.equal(calls.rpc.length, 0);
  assert.equal(cancelled, true);
  assert.equal(pending.locked, false);
  const failed = new ReadableStream({ pull(controller) { controller.error(new Error(diagnostic)); } });
  await problem(await handle(request('approve', approval, { body: failed })), 'INTERNAL_ERROR', 500);
  assert.equal(calls.rpc.length, 0);
});

test('step-up HTTP action: missing and foreign review denials are uniform after deriving the actual caller', async () => {
  const denials = [];
  for (const message of ['missing', `owned by ${principalId}`]) {
    const { handle } = fixture({ auth: { getUser: async () =>
      ({ data: { user: { id: otherPrincipalId, is_anonymous: false } }, error: null }) },
    rpc: async (name, args) => {
      assert.equal(name, 'project_s_approve_step_up_v2');
      assert.equal(args.p_context.principalId, otherPrincipalId);
      return { data: null, error: { code: 'PT403', message } };
    } });
    const result = await problem(await handle(request()), 'FORBIDDEN', 403);
    denials.push({ ...result.error, requestId: '' });
  }
  assert.deepEqual(denials[0], denials[1]);
});

for (const [sql, code, status] of [['PT400', 'VALIDATION_ERROR', 400], ['PT401', 'AUTHENTICATION_REQUIRED', 401],
  ['PT403', 'FORBIDDEN', 403], ['PT409', 'VERSION_CONFLICT', 409], ['XX000', 'INTERNAL_ERROR', 500]]) {
  test(`step-up HTTP action: ${sql} is redacted without automatic retry or v1 fallback`, async () => {
    for (const action of ['approve', 'revoke']) {
      let count = 0;
      const { handle } = fixture({ rpc: async (name) => {
        count++;
        assert.equal(name, action === 'approve' ? 'project_s_approve_step_up_v2' : 'project_s_revoke_step_up_v2');
        return { data: null, error: { code: sql, message: diagnostic } };
      } });
      const response = await handle(request(action, action === 'approve' ? approval : { expectedRevision: 1 }));
      await problem(response, code, status);
      assert.equal(response.headers.get('retry-after'), null);
      assert.equal(count, 1);
    }
  });
}

for (const code of ['SLOT_UNAVAILABLE', 'OUTSIDE_BOOKING_WINDOW']) {
  test(`step-up HTTP action: approval preserves ${code}, while revoke remains a version refusal`, async () => {
    const { handle } = fixture({ rpc: async () => ({ data: null, error: { code: 'PT409', message: code } }) });
    await problem(await handle(request()), code, 409);
    await problem(await handle(request('revoke', { expectedRevision: 1 })), 'VERSION_CONFLICT', 409);
  });
}

for (const sql of ['PT503', '55P03', '57014', '40P01', '40001']) {
  test(`step-up HTTP action: ${sql} advises only a one-second same-request retry`, async () => {
    const { handle, calls } = fixture({ rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      return { data: null, error: { code: sql, message: diagnostic } };
    } });
    const response = await handle(request());
    const result = await problem(response, 'AUTHORITY_BUSY', 503);
    assert.deepEqual(result.error.retry, { action: 'retry_after', afterSeconds: 1 });
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal(calls.rpc.length, 1);
  });
}

test('step-up HTTP action: malformed acknowledgement or private output is refused after a single action call', async () => {
  for (const data of [null, { ...approved, reviewId: principalId }, { ...approved, state: 'pending' },
    { ...approved, preparationId: 'invalid' }, { ...approved, expiresAt: 'invalid' },
    { ...approved, grantId: principalId }, { ...approved, principalId },
    { ...approved, ...JSON.parse('{"__proto__":{"private":true}}') }]) {
    let count = 0;
    const { handle } = fixture({ rpc: async () => { count++; return { data, error: null }; } });
    await problem(await handle(request()), 'INTERNAL_ERROR', 500);
    assert.equal(count, 1);
  }
  for (const data of [null, { ...revoked, reviewId: principalId }, { ...revoked, revision: 3 },
    { ...revoked, summaryDigest: digest }, { ...revoked, state: 'approved' }]) {
    const { handle } = fixture({ rpc: async () => ({ data, error: null }) });
    await problem(await handle(request('revoke', { expectedRevision: 1 })), 'INTERNAL_ERROR', 500);
  }
  const { handle } = fixture({ rpc: async () => { throw new Error(diagnostic); } });
  await problem(await handle(request()), 'INTERNAL_ERROR', 500);
});
