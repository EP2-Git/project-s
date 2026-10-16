import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { promisify } from 'node:util';
import { operationRegistry, PROJECT_S_CONTRACT_MEDIA_TYPE } from '@project-s/contracts';
import { createHttpTransport } from '../../examples/http.mjs';
import { createMcpTransport } from '../../examples/mcp.mjs';
import { createSdkTransport } from '../../.cache/booking-examples/sdk.js';
import { bindings, fixture } from '../../examples/fixture.mjs';
import { localApiBaseUrl, runPreparationExample } from '../../examples/shared.mjs';

const meetingTypeId = '20000000-0000-4000-8000-000000000001';
const preparationToken = 'prep_synthetic_example_token_abcdefghijklmnopqrstuvwxyz';
const idempotencyKey = '30000000-0000-4000-8000-000000000001';
const problem = (code = 'CONFIRMATION_REQUIRED') => ({
  type: 'https://example.invalid/problems/confirmation-required', title: 'Confirmation required',
  detail: 'A person must confirm in the browser.', status: 428, code,
  requestId: 'example-problem-1', retry: { action: 'confirm_in_browser' },
});

// Strict HTTP stub: verifies real SDK serialization and real MCP stdio plumbing.
// It is not a scheduling engine or evidence that database authority works.
async function mockApi({ held = false, createCode = 'CONFIRMATION_REQUIRED', unexpectedSuccess = false, extraProblemField = false } = {}) {
  const calls = [];
  let prepared;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const input = raw ? JSON.parse(raw) : { username: fixture.username };
    calls.push({ method: request.method, path: request.url, input, headers: request.headers });
    const operation = operationRegistry.find((candidate) => candidate.http.method === request.method
      && candidate.http.path.replace('{username}', fixture.username) === request.url);
    if (!operation || !operation.inputSchema.safeParse(input).success) {
      response.writeHead(400); response.end('{}'); return;
    }
    let data;
    if (operation.id === bindings.getBookingPage.id) data = {
      username: fixture.username, displayName: 'DemoHost', avatarUrl: null, hostTimeZone: 'America/Halifax',
      meetingTypes: [{ meetingTypeId, title: 'Synthetic introduction', description: null,
        durationMinutes: 30, minNoticeMinutes: 0, maxAdvanceDays: 60 }],
    };
    if (operation.id === bindings.listFreeSlots.id) data = {
      ...input, generatedAt: '2030-01-01T12:00:00Z',
      slots: held && prepared ? [] : [{ startAt: `${input.date}T14:00:00Z`, endAt: `${input.date}T14:30:00Z` }],
    };
    if (operation.id === bindings.prepareBooking.id) {
      prepared = input;
      data = {
        preparationId: '40000000-0000-4000-8000-000000000001', preparationToken,
        confirmationUrl: `http://127.0.0.1:8080/booking/confirm#preparation=${preparationToken}`,
        expiresAt: '2030-01-01T12:10:00Z', notHeld: true,
        summary: { ...input, endAt: input.startAt.replace('14:00:00', '14:30:00'),
          hostDisplayName: 'DemoHost', hostTimeZone: 'America/Halifax', meetingTypeTitle: 'Synthetic introduction' },
      };
    }
    if (operation.id === bindings.createBooking.id) {
      if (!unexpectedSuccess) {
        response.writeHead(428, { 'content-type': 'application/problem+json' });
        response.end(JSON.stringify({ ...problem(createCode), ...(extraProblemField ? { privateDiagnostic: preparationToken } : {}) }));
        return;
      }
      data = { username: fixture.username, meetingTypeId, meetingTypeTitle: 'Synthetic introduction',
        startAt: prepared.startAt, endAt: prepared.startAt.replace('14:00:00', '14:30:00'),
        guestTimeZone: fixture.timeZone, hostTimeZone: 'America/Halifax', status: 'confirmed',
        confirmationCode: 'synthetic-unexpected-commit', idempotencyKey: input.idempotencyKey };
    }
    response.writeHead(operation.http.successStatus, { 'content-type': PROJECT_S_CONTRACT_MEDIA_TYPE });
    response.end(JSON.stringify({ contractVersion: 1, requestId: 'example-success-1', data }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

test('example operation IDs, routes, methods and tool names match the entire registry', () => {
  assert.deepEqual(Object.values(bindings).map((binding) => binding.id), operationRegistry.map((operation) => operation.id));
  for (const [method, binding] of Object.entries(bindings)) {
    const operation = operationRegistry.find((candidate) => candidate.id === binding.id);
    assert.equal(binding.method, operation.http.method);
    assert.equal(binding.path, operation.http.path);
    assert.equal(binding.tool, operation.mcp.toolName);
    assert.equal(typeof createSdkTransport('http://127.0.0.1:8080')[method], 'function');
  }
});

for (const [name, createTransport] of Object.entries({ HTTP: createHttpTransport, SDK: createSdkTransport, MCP: createMcpTransport })) {
  test(`${name} uses shared public inputs, preserves no-hold evidence and requires browser authority`, async () => {
    const api = await mockApi(); const logs = [];
    let transport;
    try {
      transport = await createTransport(api.baseUrl);
      assert.deepEqual(await runPreparationExample(transport, {
        now: new Date('2030-01-01T12:00:00Z'), idempotencyKey, log: (line) => logs.push(line),
      }), { notHeld: true, refusal: 'CONFIRMATION_REQUIRED' });
      assert.deepEqual(api.calls.map((call) => call.path), [
        `/api/v1/public/booking-pages/${fixture.username}`, bindings.listFreeSlots.path,
        bindings.prepareBooking.path, bindings.listFreeSlots.path, bindings.createBooking.path,
      ]);
      assert.deepEqual(api.calls[2].input, { username: fixture.username, meetingTypeId,
        startAt: '2030-01-02T14:00:00Z', guestTimeZone: fixture.timeZone, booker: fixture.booker });
      assert.deepEqual(api.calls[4].input, { preparationToken, idempotencyKey });
      assert.ok(api.calls.every((call) => !call.headers.authorization && !call.headers.cookie));
      assert.ok(api.calls.filter((call) => call.method === 'POST').every((call) => call.headers['content-type'] === PROJECT_S_CONTRACT_MEDIA_TYPE));
      assert.ok(logs.some((line) => line.includes('CONFIRMATION_REQUIRED')));
      assert.ok(!logs.join('').includes(preparationToken));
      assert.ok(!logs.join('').includes(fixture.booker.email));
    } finally { await transport?.close?.(); await api.close(); }
  });
}

test('a no-longer-listed slot fails before the create attempt', async () => {
  const api = await mockApi({ held: true });
  try {
    await assert.rejects(runPreparationExample(createHttpTransport(api.baseUrl), { log: () => {} }), /no longer listed/);
    assert.ok(!api.calls.some((call) => call.path === bindings.createBooking.path));
  } finally { await api.close(); }
});

test('unexpected unconfirmed success cannot be reported as a passing example', async () => {
  const api = await mockApi({ unexpectedSuccess: true }); const logs = [];
  try {
    await assert.rejects(runPreparationExample(createHttpTransport(api.baseUrl), { log: (line) => logs.push(line) }), /Unexpected create success/);
    assert.ok(!logs.some((line) => line.includes('did not commit')));
  } finally { await api.close(); }
});

test('an unrelated canonical problem is not accepted as confirmation-required evidence', async () => {
  const api = await mockApi({ createCode: 'PREPARATION_EXPIRED' });
  try { await assert.rejects(runPreparationExample(createHttpTransport(api.baseUrl), { log: () => {} })); }
  finally { await api.close(); }
});

test('examples reject remote, credential-bearing and path/query/fragment targets', () => {
  for (const url of ['https://example.invalid', 'http://localhost.evil.invalid',
    'http://user:private@127.0.0.1:8080', 'http://127.0.0.1:8080/api',
    'http://127.0.0.1:8080/?token=private', 'http://127.0.0.1:8080/#private']) {
    assert.throws(() => localApiBaseUrl(url));
  }
});

for (const entry of ['examples/http.mjs', '.cache/booking-examples/sdk.js', 'examples/mcp.mjs']) {
  test(`${entry} CLI exits successfully only after exercising the API and redacts failures`, async () => {
    const api = await mockApi();
    try {
      const result = await promisify(execFile)(process.execPath, [entry], {
        env: { ...process.env, PROJECT_S_API_BASE_URL: api.baseUrl }, windowsHide: true, timeout: 30_000,
      });
      assert.match(result.stdout, /Create refused: CONFIRMATION_REQUIRED/);
      assert.equal(api.calls.length, 5);
      assert.ok(!result.stdout.includes(preparationToken));
    } finally { await api.close(); }
    const malformed = await mockApi({ extraProblemField: true });
    try {
      await assert.rejects(promisify(execFile)(process.execPath, [entry], {
        env: { ...process.env, PROJECT_S_API_BASE_URL: malformed.baseUrl }, windowsHide: true, timeout: 30_000,
      }), (error) => error.code === 1 && error.stderr.includes('Details are withheld')
        && !error.stderr.includes(preparationToken) && !error.stdout.includes(preparationToken));
    } finally { await malformed.close(); }
  });
}
