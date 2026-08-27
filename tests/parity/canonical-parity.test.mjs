import assert from 'node:assert/strict';
import test from 'node:test';

import * as contracts from '@project-s/contracts';
import {
  PROJECT_S_CONTRACT_MEDIA_TYPE,
  PROJECT_S_PROBLEM_MEDIA_TYPE,
  operationRegistryById,
  projectSProblemEnvelopeSchema,
} from '@project-s/contracts';
import {
  ProjectSApplication,
  ProjectSApplicationError,
} from '@project-s/application';
import {
  ProjectSApiError,
  ProjectSProtocolError,
  createProjectSClient,
} from '@project-s/sdk';

import {
  buildProjectSMcpTools,
  createProjectSMcpClientOptions,
} from '../../packages/mcp-server/src/runtime.mjs';
import { createProjectSMcpServer } from '../../packages/mcp-server/src/server.mjs';
import { MCP_PROTOCOL_VERSION } from '../../packages/mcp-server/src/constants.mjs';
import { goldenParityVectors } from './golden-vectors.mjs';

const API_BASE_URL = 'http://127.0.0.1:9876';
const UNKNOWN_MARKER = 'parity-private-unknown-field-value';
const AUTHORITY_METHODS = Object.freeze([
  'getBookingPage',
  'listFreeSlots',
  'prepareBooking',
  'createBooking',
]);

const MCP_META = Object.freeze({
  'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': {
    name: 'project-s-golden-parity',
    version: '1.0.0',
  },
});

const mcpCall = (id, vector, input) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: {
    name: vector.mcpToolName,
    arguments: input,
    _meta: MCP_META,
  },
});

const contextFor = (vector, suffix) => ({
  actorKind: 'anonymous',
  provenance: { source: 'internal' },
  requestId: `parity-app-${vector.applicationMethod}-${suffix}`,
  scopes: [vector.scope],
  transport: 'internal',
});

const makeAuthority = (handler) => {
  const calls = [];
  const authority = Object.fromEntries(
    AUTHORITY_METHODS.map((method) => [
      method,
      async (input, context) => {
        calls.push({ method, input, context });
        return handler(method, input, context);
      },
    ]),
  );
  return { authority, calls };
};

const makeFetch = ({ payload, status }) => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    calls.push({
      url: String(url),
      method: init.method,
      headers,
      body:
        typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        'content-type':
          status >= 400
            ? PROJECT_S_PROBLEM_MEDIA_TYPE
            : PROJECT_S_CONTRACT_MEDIA_TYPE,
        'x-request-id':
          payload?.requestId ?? payload?.error?.requestId ?? 'parity-response',
      },
    });
  };
  return { fetch, calls };
};

const createDirectClient = (fetch) =>
  createProjectSClient({
    baseUrl: API_BASE_URL,
    fetch,
    requestId: () => 'parity-sdk-fallback-request',
  });

const createMcpHarness = (fetch) => {
  const client = createProjectSClient(
    createProjectSMcpClientOptions({ baseUrl: API_BASE_URL, fetch }),
  );
  const tools = buildProjectSMcpTools({
    contracts,
    client,
  });
  return createProjectSMcpServer({ tools });
};

const assertHttpCall = (call, vector, { mcp = false } = {}) => {
  assert.ok(call, `${vector.operationId} did not cross the HTTP seam`);
  const url = new URL(call.url);
  assert.equal(url.origin, API_BASE_URL);
  assert.equal(url.pathname, vector.http.path);
  assert.equal(call.method, vector.http.method);
  assert.match(call.headers.get('accept') ?? '', /vnd\.project-s\.v1\+json/);

  if (vector.http.method === 'GET') {
    assert.equal(call.body, undefined);
    assert.equal(call.headers.has('content-type'), false);
  } else {
    assert.deepEqual(call.body, vector.normalizedInput);
    assert.equal(call.headers.get('content-type'), PROJECT_S_CONTRACT_MEDIA_TYPE);
  }

  if (mcp) {
    assert.equal(call.headers.get('x-project-s-source'), 'project_s_mcp');
  }
};

const assertSafeMcpText = (text, expected, forbidden = []) => {
  assert.deepEqual(JSON.parse(text), expected);
  assert.doesNotMatch(text, new RegExp(UNKNOWN_MARKER, 'i'));
  for (const fragment of forbidden) {
    assert.equal(
      text.includes(fragment),
      false,
      `MCP text leaked forbidden fragment: ${fragment}`,
    );
  }
};

const expectedSuccessFor = (vector) => {
  const operation = operationRegistryById[vector.operationId];
  const requestId = `parity-${vector.applicationMethod}-success`;
  return operation.successSchema.parse({
    contractVersion: 1,
    requestId,
    data: vector.authorityData,
  });
};

for (const vector of goldenParityVectors) {
  const label = `${vector.operationId} (${vector.mcpToolName})`;

  test(`${label}: normalizes one golden success across application, HTTP SDK, and MCP`, async () => {
    const operation = operationRegistryById[vector.operationId];
    assert.equal(operation.mcp.toolName, vector.mcpToolName);
    assert.equal(operation.http.method, vector.http.method);
    assert.equal(
      operation.http.path.replace(
        '{username}',
        encodeURIComponent(vector.normalizedInput.username ?? ''),
      ),
      vector.http.path,
    );
    assert.deepEqual(operation.inputSchema.parse(vector.input), vector.normalizedInput);

    const expected = expectedSuccessFor(vector);
    const applicationAuthority = makeAuthority(async (method, input) => {
      assert.equal(method, vector.applicationMethod);
      assert.deepEqual(input, vector.normalizedInput);
      return vector.authorityData;
    });
    const application = new ProjectSApplication({
      authority: applicationAuthority.authority,
    });
    const applicationData = await application[vector.applicationMethod](
      vector.input,
      contextFor(vector, 'success'),
    );
    assert.deepEqual(applicationData, expected.data);
    assert.equal(applicationAuthority.calls.length, 1);

    const sdkHttp = makeFetch({
      payload: {
        contractVersion: 1,
        requestId: expected.requestId,
        data: vector.authorityData,
      },
      status: operation.http.successStatus,
    });
    const sdkResult = await createDirectClient(sdkHttp.fetch).public[
      vector.sdkMethod
    ](vector.input);
    assert.deepEqual(sdkResult, expected);
    assert.equal(sdkHttp.calls.length, 1);
    assertHttpCall(sdkHttp.calls[0], vector);

    const mcpHttp = makeFetch({
      payload: {
        contractVersion: 1,
        requestId: expected.requestId,
        data: vector.authorityData,
      },
      status: operation.http.successStatus,
    });
    const mcp = createMcpHarness(mcpHttp.fetch);
    const mcpResponse = await mcp.handle(
      mcpCall(`success-${vector.applicationMethod}`, vector, vector.input),
    );
    assert.equal(mcpResponse.result.isError, false);
    assert.deepEqual(mcpResponse.result.structuredContent, expected);
    assertSafeMcpText(
      mcpResponse.result.content[0].text,
      {
        status: 'complete',
        operation: vector.mcpToolName,
        requestId: expected.requestId,
      },
      vector.forbiddenText,
    );
    assert.equal(mcpHttp.calls.length, 1);
    assertHttpCall(mcpHttp.calls[0], vector, { mcp: true });
  });

  test(`${label}: rejects an unknown request field at every ingress`, async () => {
    const inputWithUnknown = {
      ...vector.input,
      parityUnknownField: UNKNOWN_MARKER,
    };

    const applicationAuthority = makeAuthority(async () => vector.authorityData);
    const application = new ProjectSApplication({
      authority: applicationAuthority.authority,
    });
    await assert.rejects(
      application[vector.applicationMethod](
        inputWithUnknown,
        contextFor(vector, 'unknown-input'),
      ),
      (error) => {
        assert.ok(error instanceof ProjectSApplicationError);
        assert.equal(error.status, 400);
        assert.equal(error.code, 'VALIDATION_ERROR');
        return true;
      },
    );
    assert.equal(applicationAuthority.calls.length, 0);

    const sdkHttp = makeFetch({ payload: {}, status: 200 });
    await assert.rejects(
      createDirectClient(sdkHttp.fetch).public[vector.sdkMethod](inputWithUnknown),
      (error) => {
        assert.equal(error?.name, 'ZodError');
        assert.ok(Array.isArray(error?.issues));
        return true;
      },
    );
    assert.equal(sdkHttp.calls.length, 0);

    const mcpHttp = makeFetch({ payload: {}, status: 200 });
    const mcp = createMcpHarness(mcpHttp.fetch);
    const mcpResponse = await mcp.handle(
      mcpCall(`unknown-${vector.applicationMethod}`, vector, inputWithUnknown),
    );
    const parsedProblem = projectSProblemEnvelopeSchema.parse(
      mcpResponse.result.structuredContent,
    );
    assert.equal(mcpResponse.result.isError, true);
    assert.equal(parsedProblem.error.status, 400);
    assert.equal(parsedProblem.error.code, 'VALIDATION_ERROR');
    assertSafeMcpText(mcpResponse.result.content[0].text, {
      status: 'error',
      code: 'VALIDATION_ERROR',
      requestId: parsedProblem.requestId,
    });
    assert.equal(mcpHttp.calls.length, 0);
  });

  test(`${label}: fails closed on an unknown success-data field`, async () => {
    const operation = operationRegistryById[vector.operationId];
    const malformedData = {
      ...vector.authorityData,
      parityUnknownAuthorityField: UNKNOWN_MARKER,
    };
    const applicationAuthority = makeAuthority(async () => malformedData);
    const application = new ProjectSApplication({
      authority: applicationAuthority.authority,
    });
    await assert.rejects(
      application[vector.applicationMethod](
        vector.input,
        contextFor(vector, 'unknown-output'),
      ),
      (error) => {
        assert.ok(error instanceof ProjectSApplicationError);
        assert.equal(error.status, 500);
        assert.equal(error.code, 'INTERNAL_ERROR');
        return true;
      },
    );

    const malformedEnvelope = {
      contractVersion: 1,
      requestId: `parity-${vector.applicationMethod}-malformed`,
      data: malformedData,
    };
    const sdkHttp = makeFetch({
      payload: malformedEnvelope,
      status: operation.http.successStatus,
    });
    await assert.rejects(
      createDirectClient(sdkHttp.fetch).public[vector.sdkMethod](vector.input),
      (error) => {
        assert.ok(error instanceof ProjectSProtocolError);
        assert.equal(error.responseStatus, operation.http.successStatus);
        return true;
      },
    );
    assert.equal(sdkHttp.calls.length, 1);

    const mcpHttp = makeFetch({
      payload: malformedEnvelope,
      status: operation.http.successStatus,
    });
    const mcp = createMcpHarness(mcpHttp.fetch);
    const mcpResponse = await mcp.handle(
      mcpCall(`unknown-output-${vector.applicationMethod}`, vector, vector.input),
    );
    const parsedProblem = projectSProblemEnvelopeSchema.parse(
      mcpResponse.result.structuredContent,
    );
    assert.equal(mcpResponse.result.isError, true);
    assert.equal(parsedProblem.error.status, 500);
    assert.equal(parsedProblem.error.code, 'INTERNAL_ERROR');
    assertSafeMcpText(mcpResponse.result.content[0].text, {
      status: 'error',
      code: 'INTERNAL_ERROR',
      requestId: parsedProblem.requestId,
    });
  });

  test(`${label}: preserves canonical problem semantics and keeps MCP text minimal`, async () => {
    const applicationError = new ProjectSApplicationError({
      status: vector.problem.status,
      code: vector.problem.code,
      detail: vector.problem.detail,
      retryAction: vector.problem.retry?.action,
      afterSeconds: vector.problem.retry?.afterSeconds,
      alternatives: vector.problem.alternatives,
    });
    const applicationAuthority = makeAuthority(async () => {
      throw applicationError;
    });
    const application = new ProjectSApplication({
      authority: applicationAuthority.authority,
    });
    await assert.rejects(
      application[vector.applicationMethod](
        vector.input,
        contextFor(vector, 'problem'),
      ),
      (error) => {
        assert.equal(error, applicationError);
        assert.equal(error.status, vector.problem.status);
        assert.equal(error.code, vector.problem.code);
        assert.equal(error.message, vector.problem.detail);
        assert.equal(error.retryAction, vector.problem.retry?.action);
        assert.equal(error.afterSeconds, vector.problem.retry?.afterSeconds);
        assert.deepEqual(error.alternatives, vector.problem.alternatives);
        return true;
      },
    );

    const sdkHttp = makeFetch({
      payload: vector.problem,
      status: vector.problem.status,
    });
    await assert.rejects(
      createDirectClient(sdkHttp.fetch).public[vector.sdkMethod](vector.input),
      (error) => {
        assert.ok(error instanceof ProjectSApiError);
        assert.equal(error.responseStatus, vector.problem.status);
        assert.deepEqual(error.problem, vector.problem);
        return true;
      },
    );

    const mcpHttp = makeFetch({
      payload: vector.problem,
      status: vector.problem.status,
    });
    const mcp = createMcpHarness(mcpHttp.fetch);
    const mcpResponse = await mcp.handle(
      mcpCall(`problem-${vector.applicationMethod}`, vector, vector.input),
    );
    assert.equal(mcpResponse.result.isError, true);
    assert.deepEqual(mcpResponse.result.structuredContent, {
      contractVersion: 1,
      requestId: vector.problem.requestId,
      error: vector.problem,
    });
    assertSafeMcpText(
      mcpResponse.result.content[0].text,
      {
        status: 'error',
        code: vector.problem.code,
        requestId: vector.problem.requestId,
      },
      [...vector.forbiddenText, vector.problem.detail],
    );
  });
}
