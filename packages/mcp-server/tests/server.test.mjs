import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MCP_PROTOCOL_VERSION,
  PROJECT_S_MCP_TOOL_NAMES,
} from '../src/constants.mjs';
import { createProjectSMcpServer } from '../src/server.mjs';

const META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': {
    name: 'project-s-mcp-test',
    version: '1.0.0',
  },
});

const request = (id, method, params = {}) => ({
  jsonrpc: '2.0',
  id,
  method,
  params: { ...params, _meta: META },
});

const successEnvelope = (requestId = 'req-test') => ({
  contractVersion: 1,
  requestId,
  data: { ok: true },
});

const canonicalProblem = (overrides = {}) => ({
  type: 'https://project-s.example/problems/slot-unavailable',
  title: 'Slot unavailable',
  status: 409,
  code: 'SLOT_UNAVAILABLE',
  detail: 'Choose another available time.',
  requestId: 'req-problem',
  ...overrides,
});

const makeTools = ({ execute, parseInput, parseProblem } = {}) =>
  PROJECT_S_MCP_TOOL_NAMES.map((name) => ({
    name,
    title: name,
    description: `Test descriptor for ${name}`,
    inputSchema: {
      type: 'object',
      properties: { username: { type: 'string' } },
      required: ['username'],
      additionalProperties: false,
    },
    outputSchema: {
      oneOf: [
        { type: 'object', required: ['contractVersion', 'requestId', 'data'] },
        { type: 'object', required: ['contractVersion', 'requestId', 'error'] },
      ],
    },
    annotations: {
      title: name,
      readOnlyHint: !name.includes('create'),
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parseInput:
      parseInput ??
      ((value) =>
        typeof value.username === 'string' &&
        Object.keys(value).every((key) => key === 'username')
          ? { success: true, data: value }
          : {
              success: false,
              error: { issues: [{ path: ['username'], message: 'Required' }] },
            }),
    parseProblem:
      parseProblem ??
      ((value) =>
        value?.code && value?.requestId
          ? { success: true, data: value }
          : { success: false }),
    execute: execute ?? (() => Promise.resolve(successEnvelope())),
  }));

test('discovers a stateless 2026-07-28 tools-only server', async () => {
  const server = createProjectSMcpServer({ tools: makeTools() });
  const response = await server.handle(request('discover', 'server/discover'));

  assert.equal(response.id, 'discover');
  assert.equal(response.result.resultType, 'complete');
  assert.deepEqual(response.result.supportedVersions, [MCP_PROTOCOL_VERSION]);
  assert.deepEqual(response.result.capabilities, {
    tools: { listChanged: false },
  });
  assert.equal(
    response.result._meta['io.modelcontextprotocol/serverInfo'].name,
    'project-s-mcp',
  );
});

test('rejects missing or unsupported per-request protocol metadata', async () => {
  const server = createProjectSMcpServer({ tools: makeTools() });
  const missing = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  const unsupported = await server.handle({
    ...request(2, 'tools/list'),
    params: {
      _meta: {
        ...META,
        'io.modelcontextprotocol/protocolVersion': '2025-11-25',
      },
    },
  });
  const missingVersion = await server.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  });

  assert.equal(missing.error.code, -32602);
  assert.equal(missingVersion.error.code, -32602);
  assert.equal(unsupported.error.code, -32022);
  assert.deepEqual(unsupported.error.data.supported, [MCP_PROTOCOL_VERSION]);
});

test('rejects malformed request objects but never responds to valid notifications', async () => {
  const server = createProjectSMcpServer({ tools: makeTools() });

  const malformed = await server.handle({ jsonrpc: '2.0', params: {} });
  const notification = await server.handle({
    jsonrpc: '2.0',
    method: 'notifications/unknown',
    params: {},
  });

  assert.equal(malformed.error.code, -32600);
  assert.equal(notification, null);
});

test('validates optional client identity and method-specific parameter shapes', async () => {
  const server = createProjectSMcpServer({ tools: makeTools() });
  const badClient = await server.handle({
    ...request(1, 'tools/list'),
    params: {
      _meta: {
        ...META,
        'io.modelcontextprotocol/clientInfo': { name: 'missing-version' },
      },
    },
  });
  const extraDiscoveryParam = await server.handle(
    request(2, 'server/discover', { unexpected: true }),
  );

  assert.equal(badClient.error.code, -32602);
  assert.equal(extraDiscoveryParam.error.code, -32602);
});

test('lists exactly four tools in deterministic order with strict schemas', async () => {
  const server = createProjectSMcpServer({ tools: makeTools() });
  const response = await server.handle(request(1, 'tools/list'));

  assert.deepEqual(
    response.result.tools.map((tool) => tool.name),
    PROJECT_S_MCP_TOOL_NAMES,
  );
  for (const tool of response.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.ok(tool.outputSchema);
    assert.ok(tool.annotations);
  }
});

test('returns structured success without echoing guest PII into text', async () => {
  let received;
  const server = createProjectSMcpServer({
    tools: makeTools({
      parseInput: (value) => ({ success: true, data: value }),
      execute: async (value) => {
        received = value;
        return successEnvelope('req-success');
      },
    }),
  });
  const response = await server.handle(
    request(1, 'tools/call', {
      name: 'project_s_prepare_booking_v1',
      arguments: {
        booker: { name: 'Private Person', email: 'private@example.invalid' },
      },
    }),
  );

  assert.equal(received.booker.email, 'private@example.invalid');
  assert.deepEqual(response.result.structuredContent, successEnvelope('req-success'));
  assert.equal(response.result.isError, false);
  assert.doesNotMatch(response.result.content[0].text, /Private Person/);
  assert.doesNotMatch(response.result.content[0].text, /private@example\.invalid/);
});

test('returns validation failures as a shared problem envelope without calling SDK', async () => {
  let calls = 0;
  const server = createProjectSMcpServer({
    tools: makeTools({
      execute: async () => {
        calls += 1;
        return successEnvelope();
      },
    }),
  });
  const response = await server.handle(
    request(1, 'tools/call', {
      name: 'project_s_get_booking_page_v1',
      arguments: { username: 'valid', extra: 'rejected' },
    }),
  );

  assert.equal(calls, 0);
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.contractVersion, 1);
  assert.equal(response.result.structuredContent.error.code, 'VALIDATION_ERROR');
  assert.equal(response.result.structuredContent.error.fieldErrors[0].path, '/username');
});

test('maps SDK problems and redacts thrown details from diagnostics and text', async () => {
  const events = [];
  const problem = canonicalProblem();
  const server = createProjectSMcpServer({
    tools: makeTools({
      execute: async () => {
        const error = new Error('private@example.invalid tried a taken slot');
        error.problem = problem;
        throw error;
      },
    }),
    diagnostics: (event) => events.push(event),
  });
  const response = await server.handle(
    request(1, 'tools/call', {
      name: 'project_s_get_booking_page_v1',
      arguments: { username: 'valid' },
    }),
  );

  assert.equal(response.result.isError, true);
  assert.deepEqual(response.result.structuredContent, {
    contractVersion: 1,
    requestId: problem.requestId,
    error: problem,
  });
  assert.deepEqual(events, [
    {
      event: 'tool_error',
      toolName: 'project_s_get_booking_page_v1',
      code: 'SLOT_UNAVAILABLE',
      requestId: 'req-problem',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private@example\.invalid/);
  assert.doesNotMatch(response.result.content[0].text, /private@example\.invalid/);
});

test('cancellation aborts the SDK request and emits no later response', async () => {
  let observedAbort = false;
  const server = createProjectSMcpServer({
    tools: makeTools({
      execute: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            observedAbort = true;
            reject(new Error('aborted'));
          });
        }),
    }),
  });

  const pending = server.handle(
    request('cancel-me', 'tools/call', {
      name: 'project_s_get_booking_page_v1',
      arguments: { username: 'valid' },
    }),
  );
  await server.handle({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 'cancel-me', reason: 'test' },
  });

  assert.equal(await pending, null);
  assert.equal(observedAbort, true);
});
