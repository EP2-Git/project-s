import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  authenticateActor,
  authenticatePrincipal,
  createActorCredential,
  registerActorCredential,
  revokeActorCredential,
} from '../../supabase/functions/_shared/actorCredentials.ts';
import {
  v2ActorContextSchema,
  v2ActorRevokedDataSchema,
  v2PrincipalContextSchema,
} from '../../packages/contracts/dist/v2/index.js';

// Identical bounded synthetic vectors run in Node and Deno. No Auth server,
// database, browser storage, environment credential or network is used here.
const test = globalThis.Deno?.test
  ? globalThis.Deno.test.bind(globalThis.Deno)
  : (await import('node:test')).default;

const instant = '2030-01-01T12:00:00.000000Z';
const now = () => new Date(instant);
const requestId = 'actor-credential-parity';
const principalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherPrincipal = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const actorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const credentialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const binding = {
  instanceId: '11111111-1111-4111-8111-111111111111',
  epoch: 7,
  audience: 'https://authority.example.invalid',
};
const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
const encode = (value) => btoa(String.fromCharCode(...value))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value) => Uint8Array.from(
  atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='),
  (character) => character.charCodeAt(0),
);
const verifier = createHash('sha256').update(bytes).digest('hex');
const credential = `psa2.${credentialId}.${encode(bytes)}`;
const authorization = `Bearer ${credential}`;
const privateDiagnostic = 'synthetic private credential diagnostic';
const principalContext = {
  contractVersion: 2, requestId, principalId, subjectId: principalId,
  instanceId: binding.instanceId, epoch: binding.epoch,
  verifiedAt: instant, transport: 'ui',
};
const record = () => ({
  principalId, subjectId: principalId, actorId, credentialId, revision: 1,
  verifier, issuedAt: instant, expiresAt: '2030-01-03T12:00:00.000000Z',
  ...binding,
});
const actorOptions = (rpc, overrides = {}) => ({
  authorization, requestId, transport: 'http', binding, now, rpc, ...overrides,
});
const principalOptions = (getUser, overrides = {}) => ({
  authorization: 'Bearer synthetic-account-token', requestId, transport: 'ui',
  binding, now, auth: {
    getUser,
    getSession() { throw new Error('Unverified session state must never be read.'); },
  },
  ...overrides,
});
const registeredUser = (id = principalId) => ({
  data: { user: { id, is_anonymous: false } }, error: null,
});
const lookup = (data = record()) => async () => ({ data, error: null });
const safeFailure = (code, status) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  const rendered = `${String(error)} ${JSON.stringify(error)}`;
  assert.equal(rendered.includes(credential), false);
  assert.equal(rendered.includes(privateDiagnostic), false);
  assert.equal(rendered.includes(verifier), false);
  return true;
};

test('actor credentials: generated secrets are canonical 32-byte values with independent lookup identities', async () => {
  const first = await createActorCredential();
  const second = await createActorCredential();
  for (const generated of [first, second]) {
    assert.deepEqual(Object.keys(generated).sort(), ['actorId', 'credential', 'credentialId', 'verifier']);
    const parts = generated.credential.split('.');
    assert.deepEqual(parts.slice(0, 2), ['psa2', generated.credentialId]);
    assert.match(generated.actorId, /^[0-9a-f-]{36}$/);
    assert.match(generated.credentialId, /^[0-9a-f-]{36}$/);
    assert.match(parts[2], /^[A-Za-z0-9_-]{43}$/);
    const decoded = decode(parts[2]);
    assert.equal(decoded.length, 32);
    assert.equal(encode(decoded), parts[2]);
    assert.equal(createHash('sha256').update(decoded).digest('hex'), generated.verifier);
    assert.notEqual(generated.actorId, generated.credentialId);
  }
  assert.notEqual(first.credential, second.credential);
  assert.notEqual(first.actorId, second.actorId);
  assert.notEqual(first.credentialId, second.credentialId);
});

test('actor credentials: principal identity comes from getUser, never session metadata or caller overrides', async () => {
  const tokens = [];
  const context = await authenticatePrincipal(principalOptions(async (token) => {
    tokens.push(token);
    return { data: { user: {
      id: principalId.toUpperCase(), is_anonymous: false,
      user_metadata: { principalId: otherPrincipal, is_anonymous: false },
      email: 'untrusted@example.invalid',
    } }, error: null };
  }, { principalId: otherPrincipal, subjectId: otherPrincipal }));
  assert.deepEqual(tokens, ['synthetic-account-token']);
  assert.deepEqual(context, principalContext);
  assert.deepEqual(v2PrincipalContextSchema.parse(context), context);
  assert.equal(JSON.stringify(context).includes('untrusted@example.invalid'), false);
});

test('actor credentials: absent, malformed and actor credentials cannot reach account verification', async () => {
  for (const value of [null, '', 'Basic synthetic', 'Bearer', 'Bearer x y', authorization]) {
    let calls = 0;
    await assert.rejects(authenticatePrincipal(principalOptions(async () => {
      calls++; return registeredUser();
    }, { authorization: value })), safeFailure('AUTHENTICATION_REQUIRED', 401));
    assert.equal(calls, 0);
  }
});

test('actor credentials: missing, anonymous, ambiguous and invalid Auth identities fail closed', async () => {
  for (const reply of [
    { data: { user: null }, error: null },
    { data: { user: { id: principalId, is_anonymous: true } }, error: null },
    { data: { user: { id: principalId } }, error: null },
    { data: { user: { id: 'not-a-uuid', is_anonymous: false } }, error: null },
    { data: null, error: null },
    { ...registeredUser(), error: { message: privateDiagnostic } },
  ]) {
    await assert.rejects(authenticatePrincipal(principalOptions(async () => reply)),
      safeFailure('AUTHENTICATION_REQUIRED', 401));
  }
  await assert.rejects(authenticatePrincipal(principalOptions(async () => {
    throw new Error(`${privateDiagnostic}: ${credential}`);
  })), safeFailure('AUTHENTICATION_REQUIRED', 401));
});

test('actor credentials: invalid configured bindings do not reach identity providers', async () => {
  for (const invalid of [
    { ...binding, instanceId: 'not-an-instance' },
    { ...binding, epoch: 0 },
    { ...binding, epoch: Number.MAX_SAFE_INTEGER + 1 },
    { ...binding, audience: 'http://authority.example.invalid' },
    { ...binding, audience: 'https://authority.example.invalid/path' },
    { ...binding, audience: 'https://authority.example.invalid?host=other' },
    { ...binding, audience: 'https://authority.example.invalid#review' },
    { ...binding, audience: 'https://user:password@example.invalid' },
  ]) {
    let calls = 0;
    await assert.rejects(authenticatePrincipal(principalOptions(async () => {
      calls++; return registeredUser();
    }, { binding: invalid })));
    assert.equal(calls, 0);
  }
  const loopback = { ...binding, audience: 'http://127.0.0.1:55431' };
  const context = await authenticatePrincipal(principalOptions(async () => registeredUser(), { binding: loopback }));
  assert.equal(context.instanceId, binding.instanceId);
});

test('actor credentials: actor identity is derived from live private metadata and exact secret', async () => {
  const calls = [];
  const context = await authenticateActor(actorOptions(async (name, args) => {
    calls.push({ name, args }); return { data: record(), error: null };
  }, { principalId: otherPrincipal, subjectId: otherPrincipal }));
  assert.deepEqual(calls, [{ name: 'project_s_get_actor_credential_v2', args: {
    p_credential_id: credentialId, p_instance_id: binding.instanceId, p_epoch: binding.epoch,
  } }]);
  assert.deepEqual(context, {
    ...principalContext, transport: 'http', actorId, credentialId,
    credentialRevision: 1, credentialFingerprint: verifier,
  });
  assert.deepEqual(v2ActorContextSchema.parse(context), context);
  assert.equal(JSON.stringify(calls).includes(credential), false);
  assert.equal(JSON.stringify(calls).includes(encode(bytes)), false);
  assert.equal(JSON.stringify(context).includes(credential), false);
  assert.equal(context.principalId, principalId);
});

test('actor credentials: the seven-day boundary works for stdio without widening the caller context', async () => {
  const context = await authenticateActor(actorOptions(lookup({
    ...record(), expiresAt: '2030-01-08T12:00:00.000000Z',
  }), { transport: 'stdio_mcp' }));
  assert.equal(context.transport, 'stdio_mcp');
  assert.equal(context.principalId, principalId);
  assert.equal(context.subjectId, principalId);
  assert.equal(context.credentialId, credentialId);
  assert.deepEqual(v2ActorContextSchema.parse(context), context);
});

test('actor credentials: malformed, oversized and noncanonical token encodings make no lookup', async () => {
  const secret = encode(bytes);
  const badPadBits = `${secret.slice(0, -1)}9`;
  assert.deepEqual(decode(badPadBits), bytes, 'Fixture changes padding bits, not secret bytes.');
  for (const token of [
    null, '', 'Bearer synthetic-account-token', 'Basic synthetic',
    `Bearer ${credential} `, `Bearer  ${credential}`, `Bearer ${credential}\n`,
    `Bearer Psa2.${credentialId}.${secret}`,
    `Bearer psa2.${credentialId.toUpperCase()}.${secret}`,
    `Bearer psa2.${credentialId}.${secret}=`,
    `Bearer psa2.${credentialId}.${badPadBits}`,
    `Bearer psa2.${credentialId}.${secret.slice(1)}`,
    `Bearer psa2.${credentialId}.${'a'.repeat(10_000)}`,
    `Bearer psa2.${credentialId}.${secret.slice(0, -1)}+`,
    `Bearer ${credential}.extra`,
  ]) {
    let calls = 0;
    await assert.rejects(authenticateActor(actorOptions(async () => {
      calls++; return { data: record(), error: null };
    }, { authorization: token })), safeFailure('AUTHENTICATION_REQUIRED', 401));
    assert.equal(calls, 0);
  }
});

test('actor credentials: missing or revoked lookup and a wrong secret give the same refusal', async () => {
  await assert.rejects(authenticateActor(actorOptions(lookup(null))), safeFailure('AUTHENTICATION_REQUIRED', 401));
  const differentBytes = bytes.slice(); differentBytes[0] ^= 1;
  await assert.rejects(authenticateActor(actorOptions(lookup(), {
    authorization: `Bearer psa2.${credentialId}.${encode(differentBytes)}`,
  })), safeFailure('AUTHENTICATION_REQUIRED', 401));
});

test('actor credentials: inconsistent private binding and unexpected metadata never authenticate', async () => {
  for (const data of [
    { ...record(), credentialId: otherPrincipal },
    { ...record(), principalId: otherPrincipal },
    { ...record(), actorId: 'not-an-actor' },
    { ...record(), instanceId: otherPrincipal },
    { ...record(), epoch: binding.epoch + 1 },
    { ...record(), audience: 'https://other.example.invalid' },
    { ...record(), revision: 0 },
    { ...record(), revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...record(), verifier: verifier.toUpperCase() },
    { ...record(), verifier: verifier.slice(1) },
    { ...record(), state: 'revoked' },
    { ...record(), privateDiagnostic },
    { ...record(), issuedAt: '2030-01-01T12:00:00.000001Z' },
    { ...record(), expiresAt: '2030-01-08T12:00:00.000001Z' },
    { ...record(), expiresAt: instant },
    { ...record(), expiresAt: '2029-12-31T23:59:59.999999Z' },
    [], true, 'unknown credential',
  ]) {
    await assert.rejects(authenticateActor(actorOptions(lookup(data))), safeFailure('AUTHENTICATION_REQUIRED', 401));
  }
});

test('actor credentials: expiry is rechecked after an asynchronous lookup without losing microseconds', async () => {
  let clock = new Date(instant);
  const expiry = '2030-01-01T12:00:00.000001Z';
  const context = await authenticateActor(actorOptions(lookup({ ...record(), expiresAt: expiry }), { now: () => clock }));
  assert.equal(context.credentialId, credentialId, 'One microsecond of remaining validity is not rounded away.');
  await assert.rejects(authenticateActor(actorOptions(async () => {
    clock = new Date('2030-01-01T12:00:00.001Z');
    return { data: { ...record(), expiresAt: expiry }, error: null };
  }, { now: () => clock })), safeFailure('AUTHENTICATION_REQUIRED', 401));
});

test('actor credentials: database failures are sanitized and contention is bounded without automatic retry', async () => {
  for (const code of ['PT503', '55P03', '57014']) {
    let calls = 0;
    await assert.rejects(authenticateActor(actorOptions(async () => {
      calls++; return { data: null, error: { code, message: `${privateDiagnostic} ${credential}` } };
    })), safeFailure('AUTHORITY_BUSY', 503));
    assert.equal(calls, 1);
  }
  await assert.rejects(authenticateActor(actorOptions(async () => ({
    data: null, error: { code: 'XX000', message: privateDiagnostic },
  }))), safeFailure('INTERNAL_ERROR', 500));
  await assert.rejects(authenticateActor(actorOptions(async () => {
    throw new Error(`${privateDiagnostic}: ${credential}`);
  })), safeFailure('INTERNAL_ERROR', 500));
});

test('actor credentials: registration sends only a verifier and returns the raw credential to its caller', async () => {
  const calls = [];
  const result = await registerActorCredential({
    context: principalContext, label: '  Synthetic local agent  ',
    expiresAt: '2030-01-03T12:00:00Z', binding,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: {
        actorId: args.p_actor_id, credentialId: args.p_credential_id, revision: 1,
        issuedAt: instant, expiresAt: '2030-01-03T12:00:00.000000Z', ...binding,
      }, error: null };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'project_s_register_actor_v2');
  assert.deepEqual(Object.keys(calls[0].args).sort(), [
    'p_actor_id', 'p_context', 'p_credential_id', 'p_expires_at', 'p_label', 'p_verifier',
  ]);
  assert.deepEqual(calls[0].args.p_context, principalContext);
  assert.equal(calls[0].args.p_label, 'Synthetic local agent');
  assert.equal(calls[0].args.p_expires_at, '2030-01-03T12:00:00.000000Z');
  const secret = result.credential.split('.')[2];
  const digest = createHash('sha256').update(decode(secret)).digest('hex');
  assert.equal(calls[0].args.p_verifier, `\\x${digest}`);
  assert.equal(JSON.stringify(calls).includes(result.credential), false);
  assert.equal(JSON.stringify(calls).includes(secret), false);
  assert.deepEqual(Object.keys(result).sort(), ['actorId', 'audience', 'credential', 'credentialId', 'expiresAt', 'revision']);
  assert.equal(result.actorId, calls[0].args.p_actor_id);
  assert.equal(result.credentialId, calls[0].args.p_credential_id);
  assert.equal(result.audience, binding.audience);
  assert.equal(result.revision, 1);
});

test('actor credentials: an actor context, stale binding and malformed control input cannot issue', async () => {
  for (const overrides of [
    { context: { ...principalContext, actorId, credentialId, credentialRevision: 1, credentialFingerprint: verifier } },
    { context: { ...principalContext, subjectId: otherPrincipal } },
    { context: { ...principalContext, instanceId: otherPrincipal } },
    { context: { ...principalContext, epoch: binding.epoch + 1 } },
    { context: { ...principalContext, unverified: true } },
    { label: ' ' }, { label: 'a'.repeat(81) }, { expiresAt: 'not-an-instant' },
  ]) {
    let calls = 0;
    await assert.rejects(registerActorCredential({
      context: principalContext, label: 'Synthetic agent',
      expiresAt: record().expiresAt, binding,
      rpc: async () => { calls++; throw new Error(privateDiagnostic); }, ...overrides,
    }));
    assert.equal(calls, 0);
  }
});

test('actor credentials: unsuccessful or malformed issuance never leaks a raw credential', async () => {
  for (const rpc of [
    async () => { throw new Error(`${privateDiagnostic} ${credential}`); },
    async () => ({ data: null, error: { code: 'XX000', message: privateDiagnostic } }),
    async (_, args) => ({ data: {
      actorId: args.p_actor_id, credentialId: args.p_credential_id, revision: 1,
      issuedAt: instant, expiresAt: record().expiresAt, ...binding,
      credential: `${privateDiagnostic} ${credential}`,
    }, error: null }),
    async (_, args) => ({ data: {
      actorId: args.p_actor_id, credentialId: otherPrincipal, revision: 1,
      issuedAt: instant, expiresAt: record().expiresAt, ...binding,
    }, error: null }),
  ]) {
    await assert.rejects(registerActorCredential({
      context: principalContext, label: 'Synthetic agent', expiresAt: record().expiresAt, binding, rpc,
    }), (error) => {
      const rendered = `${String(error)} ${JSON.stringify(error)}`;
      assert.equal(rendered.includes(privateDiagnostic), false);
      assert.equal(rendered.includes('psa2.'), false);
      return true;
    });
  }
});

test('actor credentials: revoke uses the principal context and exact compare-and-swap input', async () => {
  const calls = [];
  const revoked = { actorId, revision: 2, state: 'revoked', revokedAt: instant };
  const options = {
    context: principalContext, actorId, expectedRevision: 1, binding,
    rpc: async (name, args) => { calls.push({ name, args }); return { data: revoked, error: null }; },
  };
  assert.deepEqual(await revokeActorCredential(options), revoked);
  assert.deepEqual(await revokeActorCredential(options), revoked);
  assert.deepEqual(calls, Array.from({ length: 2 }, () => ({
    name: 'project_s_revoke_actor_v2', args: {
      p_context: principalContext, p_actor_id: actorId, p_expected_revision: 1,
    },
  })));
  assert.deepEqual(v2ActorRevokedDataSchema.parse(revoked), revoked);
});

test('actor credentials: issuer denial and stale revisions are preserved without diagnostic disclosure', async () => {
  for (const [sqlCode, code, status] of [['PT400', 'VALIDATION_ERROR', 400], ['PT403', 'FORBIDDEN', 403], ['PT409', 'VERSION_CONFLICT', 409]]) {
    let calls = 0;
    await assert.rejects(revokeActorCredential({
      context: principalContext, actorId, expectedRevision: 1, binding,
      rpc: async () => {
        calls++; return { data: null, error: { code: sqlCode, message: privateDiagnostic } };
      },
    }), safeFailure(code, status));
    assert.equal(calls, 1);
  }
});

test('actor credentials: revoke rejects malformed input before RPC and unbound acknowledgements after RPC', async () => {
  for (const overrides of [
    { actorId: 'not-an-actor' }, { expectedRevision: 0 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { context: { ...principalContext, transport: 'stdio_mcp' } },
    { context: { ...principalContext, credentialId } },
  ]) {
    let calls = 0;
    await assert.rejects(revokeActorCredential({
      context: principalContext, actorId, expectedRevision: 1, binding,
      rpc: async () => { calls++; throw new Error(privateDiagnostic); }, ...overrides,
    }));
    assert.equal(calls, 0);
  }
  for (const data of [
    { actorId: otherPrincipal, revision: 2, state: 'revoked', revokedAt: instant },
    { actorId, revision: 2, state: 'active', revokedAt: instant },
    { actorId, revision: 2, state: 'revoked', revokedAt: instant, privateDiagnostic },
  ]) {
    await assert.rejects(revokeActorCredential({
      context: principalContext, actorId, expectedRevision: 1, binding,
      rpc: async () => ({ data, error: null }),
    }), (error) => {
      assert.equal(`${String(error)} ${JSON.stringify(error)}`.includes(privateDiagnostic), false);
      return true;
    });
  }
});
