import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { test } from 'node:test';
import { startStepUpHttpProof } from '../../scripts/lib/step-up-http-proof.mjs';

// These tests prove the HTTP adapter only. Live Auth/RPC/SQL proof is separate.
const rawRequest = (origin, { path = '/review', method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const url = new URL(origin);
  const request = httpRequest({ host: '127.0.0.1', port: url.port, path, method, headers }, (response) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
      text: Buffer.concat(chunks).toString('utf8') }));
  });
  request.on('error', reject);
  request.end(body);
});
const deferred = () => {
  let resolve;
  const promise = new Promise((ready) => { resolve = ready; });
  return { promise, resolve };
};

test('HTTP proof binds only an ephemeral IPv4 loopback listener and preserves fetch metadata', async () => {
  let received;
  const bridge = await startStepUpHttpProof({ handler: async (request) => {
    received = request;
    return new Response(JSON.stringify({ value: await request.json() }), { status: 201,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
        'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*' } });
  } });
  try {
    assert.match(bridge.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${bridge.origin}/review?exact=1`, {
      method: 'POST', headers: { authorization: 'Bearer synthetic-proof-token', 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1 }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { value: { expectedRevision: 1 } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(received.url, `${bridge.origin}/review?exact=1`);
    assert.equal(received.headers.get('authorization'), 'Bearer synthetic-proof-token');
    assert.equal(received.signal.aborted, false, 'Normal completed input must not look like a disconnect');
  } finally { await bridge.close(); }
});

test('HTTP proof dispatches a streamed request before its last chunk arrives', async () => {
  const first = deferred();
  const finish = deferred();
  const bridge = await startStepUpHttpProof({ handler: async (request) => {
    const reader = request.body.getReader();
    try {
      const chunk = await reader.read();
      first.resolve(new TextDecoder().decode(chunk.value));
      await finish.promise;
      let rest = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rest += new TextDecoder().decode(chunk.value);
      }
      return new Response(rest);
    } finally { reader.releaseLock(); }
  } });
  try {
    const result = new Promise((resolve, reject) => {
      const request = httpRequest(`${bridge.origin}/review`, { method: 'POST' }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      request.on('error', reject);
      request.write('first');
      void first.promise.then(() => { request.end('last'); finish.resolve(); });
    });
    assert.equal(await first.promise, 'first');
    assert.equal(await result, 'last');
  } finally { finish.resolve(); await bridge.close(); }
});

test('HTTP proof preserves an early bounded-body refusal when its parser cancels reading', async () => {
  let signal;
  let firstBytes = 0;
  const bridge = await startStepUpHttpProof({ handler: async (request) => {
    signal = request.signal;
    const reader = request.body.getReader();
    try {
      firstBytes = (await reader.read()).value.byteLength;
      await reader.cancel();
      return new Response('{"error":"bounded"}', { status: 413, headers: { 'content-type': 'application/json' } });
    } finally { reader.releaseLock(); }
  } });
  try {
    const response = await fetch(`${bridge.origin}/review`, { method: 'POST', body: 'x'.repeat(64 * 1_024) });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'bounded' });
    assert(firstBytes > 0);
    assert.equal(signal.aborted, false, 'Parser cancellation is not a caller disconnect');
  } finally { await bridge.close(); }
});

test('HTTP proof drops a response only after the awaited handler succeeded, then permits a fresh exact request', async () => {
  const commit = deferred();
  const entered = deferred();
  let completed = false;
  let count = 0;
  let dropped = 0;
  const bridge = await startStepUpHttpProof({ handler: async (request) => {
    count++;
    assert.equal(await request.text(), 'same-exact-input');
    entered.resolve();
    await commit.promise;
    completed = true;
    return new Response('{"state":"approved"}', { headers: { 'content-type': 'application/json' } });
  }, dropResponse: (_request, response) => {
    assert.equal(completed, true);
    assert.equal(response.status, 200);
    return dropped++ === 0;
  } });
  try {
    const first = assert.rejects(fetch(`${bridge.origin}/approve`, { method: 'POST', body: 'same-exact-input' }));
    await entered.promise;
    assert.equal(completed, false);
    commit.resolve();
    await first;
    assert.equal(count, 1, 'The bridge must not retry a mutation');
    const response = await fetch(`${bridge.origin}/approve`, { method: 'POST', body: 'same-exact-input' });
    assert.deepEqual(await response.json(), { state: 'approved' });
    assert.equal(count, 2);
  } finally { commit.resolve(); await bridge.close(); }
});

test('HTTP proof rejects foreign Host, absolute/dot targets and GET bodies before handler dispatch', async () => {
  let calls = 0;
  const bridge = await startStepUpHttpProof({ handler: async () => { calls++; return new Response('unused'); } });
  try {
    for (const input of [
      { headers: { host: 'foreign.example.invalid' } },
      { path: 'http://foreign.example.invalid/review' },
      { path: '/other/../review' },
      { path: '//other/review' },
      { headers: { 'content-length': '1' }, body: 'x' },
      { method: 'HEAD', headers: { 'content-length': '1' }, body: 'x' },
    ]) {
      const response = await rawRequest(bridge.origin, input);
      assert.equal(response.status, 400);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    }
    assert.equal(calls, 0);
  } finally { await bridge.close(); }
});

test('HTTP proof redacts handler errors and invalid responses without logging or reflecting input', async () => {
  for (const handler of [async () => { throw new Error('private diagnostic synthetic-secret'); }, async () => ({ private: true })]) {
    const bridge = await startStepUpHttpProof({ handler });
    try {
      const response = await fetch(`${bridge.origin}/synthetic-secret`);
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: 'Synthetic HTTP proof request failed.' });
      assert.equal(response.headers.get('cache-control'), 'no-store');
    } finally { await bridge.close(); }
  }
});

test('HTTP proof deadline aborts the handler request and closes a stalled connection', async () => {
  const aborted = deferred();
  const bridge = await startStepUpHttpProof({ timeoutMs: 1_000, handler: async (request) => {
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    aborted.resolve(request.signal.aborted);
    return new Response('too late');
  } });
  try {
    await assert.rejects(fetch(`${bridge.origin}/review`));
    assert.equal(await aborted.promise, true);
  } finally { await bridge.close(); }
});

test('HTTP proof deadline also closes a peer that never finishes its headers', async () => {
  let calls = 0;
  const bridge = await startStepUpHttpProof({ timeoutMs: 1_000, handler: async () => {
    calls++; return new Response('unused');
  } });
  const started = performance.now();
  try {
    await new Promise((resolve, reject) => {
      const socket = connect({ host: '127.0.0.1', port: Number(new URL(bridge.origin).port) }, () => {
        socket.write('POST /review HTTP/1.1\r\nHost:');
      });
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    assert.equal(calls, 0);
    assert(performance.now() - started < 5_000);
  } finally { await bridge.close(); }
});

test('HTTP proof forwards a client disconnect before its upload completes', async () => {
  const entered = deferred();
  const aborted = deferred();
  const bridge = await startStepUpHttpProof({ handler: async (request) => {
    entered.resolve();
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    aborted.resolve(request.signal.aborted);
    return new Response('too late');
  } });
  try {
    const request = httpRequest(`${bridge.origin}/review`, { method: 'POST' });
    const disconnected = new Promise((resolve) => request.once('error', resolve));
    request.write('partial');
    await entered.promise;
    request.destroy(new Error('Synthetic client disconnected'));
    await disconnected;
    assert.equal(await aborted.promise, true);
  } finally { await bridge.close(); }
});

test('HTTP proof forwards an actual client disconnect and cancels a streamed response', async () => {
  const started = deferred();
  const cancelled = deferred();
  const bridge = await startStepUpHttpProof({ handler: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('first')); started.resolve(); },
    cancel() { cancelled.resolve(); },
  })) });
  try {
    const controller = new AbortController();
    const response = await fetch(`${bridge.origin}/review`, { signal: controller.signal });
    await started.promise;
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
    controller.abort();
    await cancelled.promise;
    await assert.rejects(reader.read());
    reader.releaseLock();
  } finally { await bridge.close(); }
});

test('HTTP proof close is idempotent, aborts owned work and closes the listener', async () => {
  const entered = deferred();
  const aborted = deferred();
  const bridge = await startStepUpHttpProof({ handler: async (request) => {
    entered.resolve();
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    aborted.resolve();
    return new Response('closed');
  } });
  const result = assert.rejects(fetch(`${bridge.origin}/review`));
  await entered.promise;
  const closing = bridge.close();
  assert.equal(bridge.close(), closing);
  await closing;
  await aborted.promise;
  await result;
  await assert.rejects(fetch(`${bridge.origin}/review`));
});

test('HTTP proof close waits for an owned handler that ignores cancellation and disposes its late reply', async () => {
  const entered = deferred();
  const release = deferred();
  let completed = false;
  let replyCancelled = false;
  const bridge = await startStepUpHttpProof({ handler: async () => {
    entered.resolve();
    await release.promise;
    completed = true;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('not delivered')); },
      cancel() { replyCancelled = true; },
    }));
  } });
  const result = assert.rejects(fetch(`${bridge.origin}/review`));
  await entered.promise;
  let closeReturned = false;
  const closing = bridge.close().then(() => { closeReturned = true; });
  try {
    await result;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(completed, false);
    assert.equal(closeReturned, false, 'Closing the socket is not handler quiescence');
    release.resolve();
    await closing;
    assert.equal(completed, true);
    assert.equal(replyCancelled, true);
    await assert.rejects(fetch(`${bridge.origin}/review`));
  } finally { release.resolve(); await closing; }
});

test('HTTP proof close rejects boundedly when an owned handler never becomes quiescent', async () => {
  const entered = deferred();
  const bridge = await startStepUpHttpProof({ timeoutMs: 1_000, handler: async () => {
    entered.resolve();
    await new Promise(() => undefined);
    return new Response('unreachable');
  } });
  const result = assert.rejects(fetch(`${bridge.origin}/review`));
  await entered.promise;
  const started = performance.now();
  const closing = bridge.close();
  assert.equal(bridge.close(), closing);
  await assert.rejects(closing, { message: 'Synthetic HTTP proof request failed.' });
  assert(performance.now() - started < 5_000);
  await result;
  await assert.rejects(fetch(`${bridge.origin}/review`));
  assert.equal(bridge.close(), closing, 'A failed close must not later claim success');
});

test('HTTP proof rejects missing handlers and unbounded deadlines', async () => {
  for (const options of [undefined, {}, { handler: async () => new Response(), timeoutMs: 0 },
    { handler: async () => new Response(), timeoutMs: 10_001 },
    { handler: async () => new Response(), timeoutMs: Infinity },
    { handler: async () => new Response(), dropResponse: true }]) {
    await assert.rejects(startStepUpHttpProof(options), /Invalid synthetic HTTP proof options/);
  }
});
