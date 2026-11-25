import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDelegatedStepUpHandler } from '../../supabase/functions/_shared/delegatedStepUpHttp.ts';
import { getDelegatedStepUp } from '../../supabase/functions/_shared/delegatedPreparations.ts';
import {
  v2DelegatedStepUpResponseSchema, v2ProblemEnvelopeSchema,
} from '../../supabase/functions/_shared/.generated/contracts/dist/v2/index.js';

// Same transport vectors on Node and Edge. Live credentials, SQL decisions
// and races are covered separately using a disposable local backend.
const test = globalThis.Deno?.test ? globalThis.Deno.test.bind(globalThis.Deno) : (await import('node:test')).default;
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const foreignId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const credentialId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const preparationId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const binding = { instanceId: '11111111-1111-4111-8111-111111111111', epoch: 7, audience: 'https://authority.example.invalid' };
const endpoint = `${binding.audience}/api/v2/delegated/step-ups/${reviewId}`;
const instant = '2030-02-04T12:00:00.000000Z';
const now = () => new Date(instant);
const credentialSecret = Uint8Array.from({ length: 32 }, (_, index) => index);
const encode = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const verifier = createHash('sha256').update(credentialSecret).digest('hex');
const credential = `psa2.${credentialId}.${encode(credentialSecret)}`;
const diagnostic = 'private upstream diagnostic guest@example.invalid';
const expiresAt = '2030-02-04T12:05:00.000001Z';
const pending = { reviewId, state: 'pending', expiresAt };
const approved = { ...pending, state: 'approved', preparationId };
const actor = {
  contractVersion: 2, requestId: 'fixture-request-id', transport: 'http', verifiedAt: instant,
  principalId, subjectId: principalId, instanceId: binding.instanceId, epoch: binding.epoch,
  actorId, credentialId, credentialRevision: 1, credentialFingerprint: verifier,
};
const record = {
  principalId, subjectId: principalId, actorId, credentialId, revision: 1, verifier,
  issuedAt: instant, expiresAt: '2030-02-06T12:00:00.000000Z', ...binding,
};
const denial = { data: null, error: { code: 'PT403', message: diagnostic } };
const request = (url = endpoint, init = {}) => new Request(url, {
  ...init, headers: { authorization: `Bearer ${credential}`, ...init.headers },
});
const fixture = ({ outcome = pending, lookup = () => ({ data: record }), read = () => ({ data: outcome }) } = {}) => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'project_s_get_actor_credential_v2') return lookup(args);
    if (name === 'project_s_get_delegated_step_up_v2') return read(args);
    assert.fail('Unexpected RPC');
  };
  return { calls, handle: createDelegatedStepUpHandler({ binding, rpc, now }) };
};
const privacyHeaders = (response) => {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const [name] of response.headers) assert.equal(name.startsWith('access-control-'), false);
};
const checkProblem = async (response, code, status) => {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/problem+json');
  privacyHeaders(response);
  const wire = await response.text();
  const result = v2ProblemEnvelopeSchema.parse(JSON.parse(wire));
  assert.equal(result.error.code, code);
  assert.equal(result.error.status, status);
  assert.equal(result.error.requestId, result.requestId);
  for (const hidden of [credential, credentialId, verifier, diagnostic, principalId, actorId, reviewId, preparationId]) {
    assert.equal(wire.includes(hidden), false);
  }
  return result.error;
};

test('delegated step-up HTTP: each continued request reauthenticates the actor and emits only its current reference', async () => {
  const { handle, calls } = fixture({ read: () => ({ data: calls.length === 2 ? pending : approved }) });
  const ids = [];
  for (const data of [pending, approved]) {
    const response = await handle(request(endpoint, { headers: {
      origin: binding.audience, 'x-principal-id': foreignId, 'x-request-id': 'untrusted-request-id',
    } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/vnd.project-s.v2+json');
    privacyHeaders(response);
    const result = v2DelegatedStepUpResponseSchema.parse(await response.json());
    assert.deepEqual(result.data, data);
    assert.match(result.requestId, /^[0-9a-f-]{36}$/);
    ids.push(result.requestId);
    const [lookup, read] = calls.slice(-2);
    assert.deepEqual(lookup, {
      name: 'project_s_get_actor_credential_v2',
      args: { p_credential_id: credentialId, p_instance_id: binding.instanceId, p_epoch: binding.epoch },
    });
    assert.deepEqual(read, {
      name: 'project_s_get_delegated_step_up_v2',
      args: { p_context: { ...actor, requestId: result.requestId }, p_review_id: reviewId },
    });
  }
  assert.equal(calls.length, 4);
  assert.equal(new Set(ids).size, 2);
});

test('delegated step-up HTTP: rejected input reaches neither credential lookup nor continuation', async () => {
  const { handle, calls } = fixture();
  for (const method of ['POST', 'HEAD', 'OPTIONS']) {
    await checkProblem(await handle(request(endpoint, { method })), 'NOT_FOUND', 404);
  }
  for (const path of [endpoint.replace('/delegated/', '/authority/'), `${endpoint}/approve`, `${endpoint}/`]) {
    await checkProblem(await handle(request(path)), 'NOT_FOUND', 404);
  }
  for (const path of [`${endpoint}?`, `${endpoint}?context=override`, `${endpoint}#`, `${endpoint}#private`,
    endpoint.replace(reviewId, 'invalid'), endpoint.replace(reviewId, `%62${reviewId.slice(1)}`)]) {
    await checkProblem(await handle(request(path)), 'VALIDATION_ERROR', 400);
  }
  for (const headers of [{ 'content-length': '1' }, { 'transfer-encoding': 'chunked' }]) {
    await checkProblem(await handle(request(endpoint, { headers })), 'VALIDATION_ERROR', 400);
  }
  for (const origin of ['null', 'https://other.example.invalid', `${binding.audience}/`]) {
    await checkProblem(await handle(request(endpoint, { headers: { origin } })), 'FORBIDDEN', 403);
  }
  for (const authorization of ['', 'Bearer account-jwt', 'Bearer psa2.broken', 'Basic untrusted']) {
    await checkProblem(await handle(request(endpoint, { headers: {
      authorization, cookie: `session=${credential}`,
    } })), 'AUTHENTICATION_REQUIRED', 401);
  }
  assert.deepEqual(calls, []);
});

test('delegated step-up HTTP: a formerly valid credential is checked again and cannot reach the read after revocation', async () => {
  let count = 0;
  const { handle, calls } = fixture({ lookup: () => ({ data: ++count === 1 ? record : null }) });
  assert.equal((await handle(request())).status, 200);
  await checkProblem(await handle(request()), 'AUTHENTICATION_REQUIRED', 401);
  assert.equal(count, 2);
  assert.equal(calls.filter(({ name }) => name === 'project_s_get_delegated_step_up_v2').length, 1);
});

test('delegated step-up HTTP: inaccessible and unusable reviews have one redacted refusal', async () => {
  const { handle } = fixture({ read: () => denial });
  const foreign = await checkProblem(await handle(request(endpoint.replace(reviewId, foreignId))), 'FORBIDDEN', 403);
  const unavailable = await checkProblem(await handle(request()), 'FORBIDDEN', 403);
  assert.deepEqual({ ...foreign, requestId: '' }, { ...unavailable, requestId: '' });

  const busy = fixture({ read: () => ({ data: null, error: { code: 'PT503', message: diagnostic } }) });
  const response = await busy.handle(request());
  assert.equal(response.headers.get('retry-after'), '1');
  assert.deepEqual((await checkProblem(response, 'AUTHORITY_BUSY', 503)).retry, {
    action: 'retry_after', afterSeconds: 1,
  });
});

test('delegated step-up HTTP: malformed or misbound RPC response cannot disclose data or mint a reference', async () => {
  for (const data of [null, { ...pending, preparationId }, { ...approved, preparationId: null },
    { ...approved, reviewId: foreignId }, { ...pending, state: 'revoked' }, { ...pending, expiresAt: 'invalid' },
    { ...approved, summaryDigest: verifier }, { ...pending, exactSummary: { email: diagnostic } },
    JSON.parse(`{"__proto__":{"reviewId":"${foreignId}"},"reviewId":"${reviewId}","state":"pending","expiresAt":"${expiresAt}"}`)]) {
    const { handle } = fixture({ outcome: data });
    await checkProblem(await handle(request()), 'INTERNAL_ERROR', 500);
  }
});

test('delegated step-up adapter: only a matching actor context and valid review reference reach RPC', async () => {
  let count = 0;
  const rpc = async (_name, args) => {
    count++;
    assert.equal(args.p_review_id, reviewId);
    return { data: approved };
  };
  const args = { context: actor, binding, reviewId, rpc };
  for (const context of [{ ...actor, subjectId: foreignId }, { ...actor, epoch: 8 }, { ...actor, principalId: foreignId }, null]) {
    await assert.rejects(getDelegatedStepUp({ ...args, context }), { code: 'AUTHENTICATION_REQUIRED' });
  }
  await assert.rejects(getDelegatedStepUp({ ...args, reviewId: 'invalid' }), { code: 'VALIDATION_ERROR' });
  assert.equal(count, 0);
  assert.deepEqual(await getDelegatedStepUp({ ...args, reviewId: reviewId.toUpperCase() }), approved);
  assert.equal(count, 1);
});
