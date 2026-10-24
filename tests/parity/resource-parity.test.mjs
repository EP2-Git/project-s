import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  PROJECT_S_PUBLIC_REQUEST_MAX_BYTES,
  PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES,
  arrayNode, contractNode, objectNode,
  generateContractArtifacts, operationRegistryById, stableStringify,
} from '@project-s/contracts';
import { generateV2ContractArtifacts } from '../../packages/contracts/dist/v2/index.js';
import { createProjectSClient, ProjectSApiError, ProjectSProtocolError } from '../../packages/sdk/dist/index.js';
import { parseRequestBody } from '../../supabase/functions/_shared/requestBody.ts';
import { goldenParityVectors } from './golden-vectors.mjs';

// The same fixtures execute in Node and standalone Deno with the production
// Edge import map. No listening socket, environment credentials or DB is used.
const test = globalThis.Deno?.test
  ? globalThis.Deno.test.bind(globalThis.Deno)
  : (await import('node:test')).default;
const encoder = new TextEncoder();
const requestId = 'resource-parity-request';
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
const request = (body, headers = {}, signal) => new Request('http://127.0.0.1/resource-parity', {
  method: 'POST', body, headers, signal, duplex: 'half',
});

test('resource parity: nested collection early rejection, sync/async and normalization', async () => {
  let visits = 0;
  const element = contractNode(z.preprocess((value) => { visits++; return value; }, z.string().trim()), { type: 'string' });
  const schema = objectNode({ rows: arrayNode(arrayNode(element, { maxItems: 2 }), { maxItems: 2 }) }).zod;
  const oversized = { rows: [Array(32).fill(0)] };
  for (const parsed of [schema.safeParse(oversized), await schema.safeParseAsync(oversized)]) {
    assert.equal(parsed.success, false);
    assert.equal(parsed.error.issues.length, 1);
    assert.deepEqual(parsed.error.issues[0].path, ['rows', 0]);
  }
  assert.equal(visits, 0);
  assert.deepEqual(schema.parse({ rows: [[' a ', ' b ']] }), { rows: [['a', 'b']] });
  assert.equal(schema.safeParse({ rows: [], unknown: true }).success, false);
});

test('resource parity: HTTP consumes only the first excessive chunk and cancels', async () => {
  for (const headers of [{}, { 'content-length': '1' }, { 'content-length': 'invalid' }]) {
    const { state, stream } = streamFixture(Array.from({ length: 40 }, () => new Uint8Array(1_024).fill(32)));
    await assert.rejects(parseRequestBody(request(stream, headers)), (error) =>
      error.status === 413 && error.code === 'VALIDATION_ERROR' && error.message === 'The request body is too large.');
    assert.equal(state.pulls, 17);
    assert.equal(state.cancelled, true);
    assert.equal(stream.locked, false);
  }
});

test('resource parity: HTTP exact byte boundary, malformed/empty JSON and declared length', async () => {
  const atLimit = encoder.encode(`{"value":"${'a'.repeat(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES - 12)}"}`);
  assert.equal(atLimit.byteLength, PROJECT_S_PUBLIC_REQUEST_MAX_BYTES);
  assert.equal((await parseRequestBody(request(atLimit))).value.length, PROJECT_S_PUBLIC_REQUEST_MAX_BYTES - 12);
  await assert.rejects(parseRequestBody(request(new Uint8Array(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES + 1))),
    (error) => error.status === 413 && error.code === 'VALIDATION_ERROR');
  await assert.rejects(parseRequestBody(request('{')), (error) => error.status === 400 && error.code === 'VALIDATION_ERROR');
  assert.deepEqual(await parseRequestBody(request(null)), {});
  const { state, stream } = streamFixture([encoder.encode('{}')]);
  await assert.rejects(parseRequestBody(request(stream, { 'content-length': String(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES + 1) })),
    (error) => error.status === 413);
  assert.equal(state.pulls, 0);
  assert.equal(state.cancelled, true);
  assert.equal(stream.locked, false);
});

test('resource parity: HTTP abort interrupts pending read and cancels', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const pending = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const result = parseRequestBody(request(pending, {}, controller.signal));
  controller.abort(new Error('isolated abort'));
  await assert.rejects(result, /isolated abort/);
  assert.equal(cancelled, true);
  assert.equal(pending.locked, false);
});

for (const vector of goldenParityVectors) {
  test(`resource parity: existing ${vector.applicationMethod} SDK normalization and strictness`, async () => {
    const operation = operationRegistryById[vector.operationId];
    const data = operation.successSchema.parse({ contractVersion: 1, requestId, data: vector.authorityData });
    const client = createProjectSClient({ baseUrl: 'http://127.0.0.1', fetch: async () => new Response(JSON.stringify(data)) });
    const result = await client.public[vector.sdkMethod](vector.input);
    assert.deepEqual(result, data);
    await assert.rejects(client.public[vector.sdkMethod]({ ...vector.input, unrecognized: true }));
  });
}

test('resource parity: SDK success and error streams both stop at the same byte budget', async () => {
  for (const status of [200, 400]) {
    const chunks = Array.from({ length: 4 }, () => new Uint8Array(Math.floor(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES / 2)).fill(32));
    const { stream, state } = streamFixture(chunks);
    const client = createProjectSClient({ baseUrl: 'http://127.0.0.1', fetch: async () =>
      new Response(stream, { status, headers: { 'content-length': '1' } }) });
    await assert.rejects(client.public.getBookingPage({ username: 'host_one' }), (error) =>
      error instanceof ProjectSProtocolError && !(error instanceof ProjectSApiError) && error.payload === undefined);
    assert.equal(state.pulls, 3);
    assert.equal(state.cancelled, true);
    assert.equal(stream.locked, false);
  }
});

test('resource parity: v1/v2 generated artifacts remain byte-identical', () => {
  const digest = (value) => createHash('sha256').update(stableStringify(value, 0)).digest('hex');
  assert.equal(digest(generateContractArtifacts()), '827656a8a8748d1d58afa9042daae09fa3be586d274d86308e09ae8ace3f57be');
  assert.equal(digest(generateV2ContractArtifacts()), '66977092b59068359dce6eb48fbf2c226f3f6f8a78ab1c6587ef39499e8fa813');
});
