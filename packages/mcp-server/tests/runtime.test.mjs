import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_S_MCP_TOOL_NAMES } from '../src/constants.mjs';
import {
  buildProjectSMcpTools,
  createProjectSMcpClientOptions,
  validateProjectSApiBaseUrl,
} from '../src/runtime.mjs';

const makeContracts = () => {
  const problemJsonSchema = {
    type: 'object',
    required: ['contractVersion', 'requestId', 'error'],
  };
  const operationRegistry = PROJECT_S_MCP_TOOL_NAMES.map((toolName) => ({
    mcp: {
      toolName,
      title: toolName,
      description: `Description for ${toolName}`,
      readOnlyHint: toolName.includes('get') || toolName.includes('list'),
      destructiveHint: false,
      idempotentHint: !toolName.includes('prepare'),
      openWorldHint: false,
    },
    inputSchema: {
      safeParse: (value) => ({ success: true, data: value }),
    },
    inputJsonSchema: {
      type: 'object',
      additionalProperties: false,
    },
    successJsonSchema: {
      type: 'object',
      required: ['contractVersion', 'requestId', 'data'],
    },
    resultJsonSchema: {
      oneOf: [
        { type: 'object', required: ['contractVersion', 'requestId', 'data'] },
        problemJsonSchema,
      ],
    },
  }));

  return {
    operationRegistry,
    projectSProblemSchema: {
      safeParse: (value) => ({ success: true, data: value }),
    },
  };
};

test('builds the fixed manifest from contracts and calls only the public SDK seam', async () => {
  const calls = [];
  const implementation = (method) => async (input, options) => {
    calls.push({ method, input, options });
    return { contractVersion: 1, requestId: 'request-1', data: {} };
  };
  const client = {
    public: {
      getBookingPage: implementation('getBookingPage'),
      listFreeSlots: implementation('listFreeSlots'),
      prepareBooking: implementation('prepareBooking'),
      createBooking: implementation('createBooking'),
    },
  };
  const tools = buildProjectSMcpTools({ contracts: makeContracts(), client });
  const controller = new AbortController();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    PROJECT_S_MCP_TOOL_NAMES,
  );
  await tools[2].execute({ username: 'host' }, controller.signal);
  assert.deepEqual(calls, [
    {
      method: 'prepareBooking',
      input: { username: 'host' },
      options: { signal: controller.signal },
    },
  ]);
  assert.equal(tools[2].inputSchema.additionalProperties, false);
  assert.equal(tools[2].outputSchema.oneOf.length, 2);
});

test('fails closed when contracts add an unreviewed fifth MCP tool', () => {
  const contracts = makeContracts();
  contracts.operationRegistry.push({
    ...contracts.operationRegistry[0],
    mcp: {
      ...contracts.operationRegistry[0].mcp,
      toolName: 'project_s_unreviewed_admin_v1',
    },
  });

  assert.throws(
    () => buildProjectSMcpTools({ contracts, client: { public: {} } }),
    /exactly the approved MCP v1 tools/,
  );
});

test('requires HTTPS except on loopback and rejects URL credentials', () => {
  assert.equal(
    validateProjectSApiBaseUrl('https://project-s.example.test/'),
    'https://project-s.example.test',
  );
  assert.equal(
    validateProjectSApiBaseUrl('http://127.0.0.1:54321/'),
    'http://127.0.0.1:54321',
  );
  assert.throws(
    () => validateProjectSApiBaseUrl('http://project-s.example.test'),
    /must use HTTPS/,
  );
  assert.throws(
    () => validateProjectSApiBaseUrl('https://user:secret@example.invalid'),
    /must not contain credentials/,
  );
});

test('identifies MCP provenance without supplying an authority credential', () => {
  const fetch = async () => new Response();
  const options = createProjectSMcpClientOptions({
    baseUrl: 'https://project-s.example.test',
    fetch,
  });

  assert.equal(options.fetch, fetch);
  assert.deepEqual(options.headers, {
    'x-project-s-source': 'project_s_mcp',
    'x-project-s-client': 'project-s-mcp',
    'x-project-s-client-version': '0.1.0-prealpha',
  });
  assert.equal('authorization' in options.headers, false);
  assert.equal('apikey' in options.headers, false);
});
