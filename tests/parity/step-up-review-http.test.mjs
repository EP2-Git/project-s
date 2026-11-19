import assert from 'node:assert/strict';
import { createStepUpReviewHandler } from '../../supabase/functions/_shared/stepUpReviewHttp.ts';
import {
  v2ProblemEnvelopeSchema, v2StepUpReviewResponseSchema,
} from '../../supabase/functions/_shared/.generated/contracts/dist/v2/index.js';

// Shared Node/Edge boundary vectors with Auth/RPC doubles. These do not prove
// a deployed endpoint, live account verification or database ownership fencing.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherPrincipalId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const endpoint = `${binding.audience}/api/v2/authority/step-ups/${reviewId}`;
const token = 'synthetic-account-jwt';
const diagnostic = 'private upstream diagnostic guest@example.invalid';
const snapshot = {
  reviewId, revision: 1, state: 'pending', summaryDigest: 'a'.repeat(64),
  expiresAt: '2030-02-04T12:05:00.000001Z',
  exactSummary: {
    username: 'synthetic-host', hostDisplayName: 'Synthetic Host',
    meetingTypeId: '22222222-2222-4222-8222-222222222222', meetingTypeTitle: 'Synthetic meeting',
    startAt: '2030-02-04T13:00:00.123456Z', endAt: '2030-02-04T13:30:00.123456Z',
    hostTimeZone: 'America/Halifax', guestTimeZone: 'UTC', name: 'Synthetic Guest', email: 'guest@example.invalid',
  },
  differences: [{ field: 'meeting_window', proposed: '13:00–13:30 UTC', reviewed: '14:00–15:00 UTC' }],
};
const request = (url = endpoint, init = {}) => new Request(url, {
  ...init, headers: { authorization: `Bearer ${token}`, ...init.headers },
});
const fixture = (overrides = {}) => {
  const calls = { auth: [], rpc: [] };
  const auth = { getUser: async (jwt) => {
    calls.auth.push(jwt);
    return { data: { user: { id: principalId, is_anonymous: false } }, error: null };
  } };
  const rpc = async (name, args) => {
    calls.rpc.push({ name, args });
    return { data: structuredClone(snapshot), error: null };
  };
  return { calls, handle: createStepUpReviewHandler({ binding, auth, rpc,
    now: () => new Date('2030-02-04T12:00:00.000Z'), ...overrides }) };
};
const privacyHeaders = (response) => {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
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
  assert.equal(result.requestId, result.error.requestId);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  for (const privateValue of [token, diagnostic, principalId, otherPrincipalId, reviewId,
    snapshot.summaryDigest, snapshot.exactSummary.email, 'client-private-request-id']) {
    assert.equal(wire.includes(privateValue), false, `Reflected private value: ${privateValue}`);
  }
  return result;
};

test('step-up HTTP read: fresh principal authentication precedes the owner-only read on every request', async () => {
  const { handle, calls } = fixture();
  const ids = [];
  for (const origin of [undefined, binding.audience]) {
    const response = await handle(request(endpoint, { headers: {
      ...(origin ? { origin } : {}), 'x-request-id': 'client-private-request-id',
      'x-principal-id': otherPrincipalId,
    } }));
    assert.equal(response.status, 200);
    privacyHeaders(response);
    assert.match(response.headers.get('content-type') ?? '', /^application\/vnd\.project-s\.v2\+json(?:;|$)/);
    const result = v2StepUpReviewResponseSchema.parse(await response.json());
    assert.deepEqual(result.data, snapshot);
    assert.match(result.requestId, /^[0-9a-f-]{36}$/);
    ids.push(result.requestId);
    const { name, args } = calls.rpc.at(-1);
    assert.equal(name, 'project_s_get_step_up_review_v2');
    assert.deepEqual(Object.keys(args).sort(), ['p_context', 'p_review_id']);
    assert.equal(args.p_review_id, reviewId);
    assert.deepEqual(args.p_context, {
      contractVersion: 2, principalId, subjectId: principalId, instanceId: binding.instanceId,
      epoch: binding.epoch, transport: 'http', verifiedAt: '2030-02-04T12:00:00.000000Z', requestId: result.requestId,
    });
  }
  assert.deepEqual(calls.auth, [token, token]);
  assert.equal(calls.rpc.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test('step-up HTTP read: actor tokens, absent credentials and cookie-only sessions never reach Auth or RPC', async () => {
  for (const authorization of ['', 'Basic opaque', 'Bearer psa2.opaque', 'Bearer token with whitespace']) {
    const { handle, calls } = fixture();
    await problem(await handle(request(endpoint, { headers: { authorization, cookie: `session=${token}` } })),
      'AUTHENTICATION_REQUIRED', 401);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP read: reviewed UUID normalization preserves accepted legacy references', async () => {
  for (const id of [reviewId.toUpperCase(), '11111111-1111-0111-1111-111111111111']) {
    let readId;
    const { handle } = fixture({ rpc: async (name, args) => {
      assert.equal(name, 'project_s_get_step_up_review_v2');
      readId = args.p_review_id;
      return { data: { ...snapshot, reviewId: readId }, error: null };
    } });
    const response = await handle(request(`${binding.audience}/api/v2/authority/step-ups/${id}`));
    assert.equal(response.status, 200);
    assert.equal(readId, id.toLowerCase());
    assert.equal(v2StepUpReviewResponseSchema.parse(await response.json()).data.reviewId, readId);
  }
});

test('step-up HTTP read: an earlier successful read cannot cache an account that later loses verification', async () => {
  let authCalls = 0;
  const { handle, calls } = fixture({ auth: { getUser: async () => {
    authCalls++;
    return authCalls === 1
      ? { data: { user: { id: principalId, is_anonymous: false } }, error: null }
      : { data: { user: null }, error: diagnostic };
  } } });
  assert.equal((await handle(request())).status, 200);
  await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
  assert.equal(authCalls, 2);
  assert.equal(calls.rpc.length, 1);
});

test('step-up HTTP read: anonymous, missing and failed Auth identity have the same bounded denial', async () => {
  const results = [];
  for (const user of [null, { id: principalId, is_anonymous: true }, { id: principalId }, { id: 'invalid', is_anonymous: false }]) {
    let rpcCalls = 0;
    const { handle } = fixture({ auth: { getUser: async () => ({ data: { user }, error: null }) },
      rpc: async () => { rpcCalls++; assert.fail('Unverified identity reached RPC'); } });
    const result = await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
    results.push({ ...result.error, requestId: '' });
    assert.equal(rpcCalls, 0);
  }
  for (const getUser of [async () => ({ data: { user: { id: principalId, is_anonymous: false } }, error: diagnostic }),
    async () => { throw new Error(diagnostic); }]) {
    const { handle, calls } = fixture({ auth: { getUser } });
    const result = await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
    results.push({ ...result.error, requestId: '' });
    assert.equal(calls.rpc.length, 0);
  }
  for (const result of results) assert.deepEqual(result, results[0]);
});

test('step-up HTTP read: malformed instance binding fails closed before account verification', async () => {
  for (const invalidBinding of [{ ...binding, epoch: 0 }, { ...binding, instanceId: 'bad' },
    { ...binding, audience: 'http://remote.example.invalid' }, { ...binding, audience: `${binding.audience}/path` },
    { ...binding, principalId }]) {
    const { handle, calls } = fixture({ binding: invalidBinding });
    await problem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP read: supplied foreign or opaque origins cannot read or trigger preflight CORS', async () => {
  for (const origin of ['https://other.example.invalid', 'null', `${binding.audience}/`, `${binding.audience}.other.invalid`]) {
    const { handle, calls } = fixture();
    await problem(await handle(request(endpoint, { headers: { origin } })), 'FORBIDDEN', 403);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP read: other methods and paths never invoke authority or write adapters', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const { handle, calls } = fixture();
    await problem(await handle(request(endpoint, { method })), 'NOT_FOUND', 404);
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.rpc.length, 0);
  }
  for (const path of ['/api/v1/authority/step-ups/', '/api/v2/authority/mandates/',
    `/api/v2/authority/step-ups/${reviewId}/approve`, `/api/v2/authority/step-ups/${reviewId}/`,
    '/authority/review', '/api/v2/delegated/step-ups/']) {
    const { handle, calls } = fixture();
    await problem(await handle(request(new URL(path, binding.audience))), 'NOT_FOUND', 404);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP read: query context, fragments and unexpected GET bodies are rejected without RPC', async () => {
  for (const extra of [`?principalId=${otherPrincipalId}`, '?context=%7B%7D', '?returnTo=https://other.example.invalid',
    '?reviewId=other', '#review=other']) {
    const { handle, calls } = fixture();
    await problem(await handle(request(endpoint + extra)), 'VALIDATION_ERROR', 400);
    assert.equal(calls.rpc.length, 0);
  }
  const { handle, calls } = fixture();
  const withBody = request();
  Object.defineProperty(withBody, 'body', { value: new ReadableStream({ start(controller) { controller.close(); } }) });
  await problem(await handle(withBody), 'VALIDATION_ERROR', 400);
  assert.equal(calls.rpc.length, 0);
});

test('step-up HTTP read: malformed object references never reach SQL', async () => {
  for (const id of ['not-a-uuid', 'bbbbbbbb-bbbb-xbbb-8bbb-bbbbbbbbbbbb', `${reviewId}%2Fapprove`, '%20' + reviewId]) {
    const { handle, calls } = fixture();
    const response = await handle(request(`${binding.audience}/api/v2/authority/step-ups/${id}`));
    const result = v2ProblemEnvelopeSchema.parse(await response.json());
    assert.ok(['NOT_FOUND', 'VALIDATION_ERROR'].includes(result.error.code), `${id}: ${result.error.code}`);
    privacyHeaders(response);
    assert.equal(calls.rpc.length, 0);
  }
});

test('step-up HTTP read: unknown and foreign reviews share a uniform denial after verified identity', async () => {
  const denials = [];
  for (const message of ['missing', `foreign owner ${principalId}`]) {
    let calls = 0;
    const { handle } = fixture({ auth: { getUser: async () => ({ data: { user: { id: otherPrincipalId, is_anonymous: false } }, error: null }) },
      rpc: async (name, args) => {
        calls++;
        assert.equal(name, 'project_s_get_step_up_review_v2');
        assert.equal(args.p_context.principalId, otherPrincipalId);
        return { data: null, error: { code: 'PT403', message } };
      } });
    const result = await problem(await handle(request()), 'FORBIDDEN', 403);
    denials.push({ ...result.error, requestId: '' });
    assert.equal(calls, 1);
  }
  assert.deepEqual(denials[0], denials[1]);
});

for (const [sql, code, status] of [['PT400', 'VALIDATION_ERROR', 400], ['PT401', 'AUTHENTICATION_REQUIRED', 401],
  ['PT403', 'FORBIDDEN', 403], ['PT409', 'VERSION_CONFLICT', 409], ['XX000', 'INTERNAL_ERROR', 500]]) {
  test(`step-up HTTP read: ${sql} is a strict redacted ${code} envelope`, async () => {
    const { handle } = fixture({ rpc: async () => ({ data: null, error: { code: sql, message: diagnostic } }) });
    const response = await handle(request());
    await problem(response, code, status);
    assert.equal(response.headers.get('retry-after'), null);
  });
}

for (const sql of ['PT503', '55P03', '57014', '40P01', '40001']) {
  test(`step-up HTTP read: ${sql} exposes only bounded same-request retry guidance`, async () => {
    const { handle } = fixture({ rpc: async () => ({ data: null, error: { code: sql, message: diagnostic } }) });
    const response = await handle(request());
    const result = await problem(response, 'AUTHORITY_BUSY', 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.deepEqual(result.error.retry, { action: 'retry_after', afterSeconds: 1 });
  });
}

test('step-up HTTP read: RPC network failures and expanded private output never escape', async () => {
  const outputs = [{ ...snapshot, principalId }, { ...snapshot, state: 'approved' }, { ...snapshot, revision: 2 },
    { ...snapshot, reviewId: principalId }, { ...snapshot, exactSummary: { ...snapshot.exactSummary, notes: diagnostic } },
    { ...snapshot, differences: [{ ...snapshot.differences[0], field: 'private_policy' }] }, null];
  for (const data of outputs) {
    const { handle } = fixture({ rpc: async () => ({ data, error: null }) });
    await problem(await handle(request()), 'INTERNAL_ERROR', 500);
  }
  const { handle } = fixture({ rpc: async () => { throw new Error(diagnostic); } });
  await problem(await handle(request()), 'INTERNAL_ERROR', 500);
});
