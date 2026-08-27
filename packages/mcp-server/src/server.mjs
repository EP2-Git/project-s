import { randomUUID } from 'node:crypto';
import {
  MCP_PROTOCOL_VERSION,
  PROJECT_S_MCP_INSTRUCTIONS,
  PROJECT_S_MCP_SERVER_INFO,
} from './constants.mjs';

const PROTOCOL_META = Object.freeze({
  'io.modelcontextprotocol/serverInfo': PROJECT_S_MCP_SERVER_INFO,
});

const SAFE_PROBLEMS = Object.freeze({
  VALIDATION_ERROR: [
    400,
    'Booking request is invalid',
    'Review the requested fields and try again.',
  ],
  INTERNAL_ERROR: [
    500,
    'Project S could not complete the request',
    'Try again. If the problem continues, contact the Project S operator.',
  ],
});

const createProblem = (code, { fieldErrors } = {}) => {
  const [status, title, detail] = SAFE_PROBLEMS[code] ?? SAFE_PROBLEMS.INTERNAL_ERROR;
  return {
    type: `https://project-s.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    detail,
    requestId: randomUUID(),
    ...(fieldErrors?.length ? { fieldErrors } : {}),
  };
};

const serverMeta = () => ({ ...PROTOCOL_META });

const completeResult = (value) => ({
  resultType: 'complete',
  ...value,
  _meta: serverMeta(),
});

const jsonRpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

export const jsonRpcError = (id, code, message, data) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  error: {
    code,
    message,
    ...(data === undefined ? {} : { data }),
  },
});

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const safeFieldErrors = (issues) =>
  issues.slice(0, 12).map((issue) => {
    const path = Array.isArray(issue.path)
      ? issue.path
          .filter((segment) =>
            typeof segment === 'number' || /^[A-Za-z0-9_.-]+$/.test(segment),
          )
          .join('/')
      : '';
    return {
      path: path ? `/${path}` : '/',
      code: 'INVALID_FIELD',
      message: 'Invalid value.',
    };
  });

const safeTextFor = (toolName, structuredContent, isError) => {
  if (isError) {
    return JSON.stringify({
      status: 'error',
      code: structuredContent.error.code,
      requestId: structuredContent.requestId,
    });
  }

  return JSON.stringify({
    status: 'complete',
    operation: toolName,
    requestId: structuredContent.requestId,
  });
};

const toolResult = (toolName, structuredContent, isError) =>
  completeResult({
    content: [
      {
        type: 'text',
        text: safeTextFor(toolName, structuredContent, isError),
      },
    ],
    structuredContent,
    isError,
  });

const problemEnvelope = (problem) => ({
  contractVersion: 1,
  requestId: problem.requestId,
  error: problem,
});

const validateModernMeta = (params) => {
  if (!isRecord(params) || !isRecord(params._meta)) {
    return jsonRpcError(
      undefined,
      -32602,
      'Invalid params: modern MCP request metadata is required.',
    );
  }

  const requested = params._meta['io.modelcontextprotocol/protocolVersion'];
  const capabilities =
    params._meta['io.modelcontextprotocol/clientCapabilities'];
  const clientInfo = params._meta['io.modelcontextprotocol/clientInfo'];

  if (typeof requested !== 'string') {
    return jsonRpcError(
      undefined,
      -32602,
      'Invalid params: protocol version is required.',
    );
  }

  if (requested !== MCP_PROTOCOL_VERSION) {
    return jsonRpcError(undefined, -32022, 'Unsupported protocol version', {
      supported: [MCP_PROTOCOL_VERSION],
      requested,
    });
  }

  if (!isRecord(capabilities)) {
    return jsonRpcError(
      undefined,
      -32602,
      'Invalid params: client capabilities are required.',
    );
  }

  if (
    clientInfo !== undefined &&
    (!isRecord(clientInfo) ||
      typeof clientInfo.name !== 'string' ||
      clientInfo.name.length === 0 ||
      typeof clientInfo.version !== 'string' ||
      clientInfo.version.length === 0)
  ) {
    return jsonRpcError(
      undefined,
      -32602,
      'Invalid params: clientInfo must include a name and version.',
    );
  }

  return null;
};

const validateRequest = (message) => {
  if (
    !isRecord(message) ||
    message.jsonrpc !== '2.0' ||
    (typeof message.id !== 'string' &&
      !(typeof message.id === 'number' && Number.isInteger(message.id))) ||
    typeof message.method !== 'string'
  ) {
    return jsonRpcError(
      isRecord(message) && (typeof message.id === 'string' || typeof message.id === 'number')
        ? message.id
        : undefined,
      -32600,
      'Invalid Request',
    );
  }
  return null;
};

const validateNotification = (message) =>
  isRecord(message) &&
  message.jsonrpc === '2.0' &&
  message.id === undefined &&
  typeof message.method === 'string';

export const createProjectSMcpServer = ({ tools, diagnostics = () => {} }) => {
  if (!Array.isArray(tools) || tools.length !== 4) {
    throw new Error('Project S MCP requires exactly four approved v1 tools.');
  }

  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const inFlight = new Map();

  const handleNotification = (message) => {
    if (!validateNotification(message)) return;
    if (message.method !== 'notifications/cancelled') return;

    const requestId = message.params?.requestId;
    inFlight.get(requestId)?.abort();
  };

  const callTool = async (params, signal) => {
    if (
      !isRecord(params) ||
      typeof params.name !== 'string' ||
      !isRecord(params.arguments)
    ) {
      return {
        protocolError: jsonRpcError(
          undefined,
          -32602,
          'Invalid params: tool name and object arguments are required.',
        ),
      };
    }

    const tool = toolsByName.get(params.name);
    if (!tool) {
      return {
        protocolError: jsonRpcError(
          undefined,
          -32602,
          'Invalid params: unknown Project S tool.',
        ),
      };
    }

    const parsedInput = tool.parseInput(params.arguments);
    if (!parsedInput.success) {
      const problem = createProblem('VALIDATION_ERROR', {
        fieldErrors: safeFieldErrors(parsedInput.error.issues ?? []),
      });
      return {
        result: toolResult(tool.name, problemEnvelope(problem), true),
      };
    }

    try {
      const success = await tool.execute(parsedInput.data, signal);
      return { result: toolResult(tool.name, success, false) };
    } catch (error) {
      if (signal.aborted) {
        return { cancelled: true };
      }

      const parsedProblem = tool.parseProblem(error?.problem);
      const problem = parsedProblem.success
        ? parsedProblem.data
        : createProblem('INTERNAL_ERROR');
      try {
        diagnostics({
          event: 'tool_error',
          toolName: tool.name,
          code: problem.code,
          requestId: problem.requestId,
        });
      } catch {
        // Diagnostics are best-effort and must never alter protocol semantics.
      }
      return {
        result: toolResult(tool.name, problemEnvelope(problem), true),
      };
    }
  };

  const handleRequest = async (message) => {
    const invalidRequest = validateRequest(message);
    if (invalidRequest) return invalidRequest;

    if (message.method === 'initialize') {
      return jsonRpcError(
        message.id,
        -32601,
        `Method not found. This server supports modern MCP ${MCP_PROTOCOL_VERSION}; send server/discover with per-request metadata.`,
        { supported: [MCP_PROTOCOL_VERSION] },
      );
    }

    const invalidMeta = validateModernMeta(message.params);
    if (invalidMeta) return { ...invalidMeta, id: message.id };

    if (message.method === 'server/discover') {
      if (Object.keys(message.params).some((key) => key !== '_meta')) {
        return jsonRpcError(
          message.id,
          -32602,
          'Invalid params: server/discover accepts only request metadata.',
        );
      }
      return jsonRpcResult(
        message.id,
        completeResult({
          supportedVersions: [MCP_PROTOCOL_VERSION],
          capabilities: { tools: { listChanged: false } },
          instructions: PROJECT_S_MCP_INSTRUCTIONS,
          ttlMs: 300_000,
          cacheScope: 'public',
        }),
      );
    }

    if (message.method === 'ping') {
      if (Object.keys(message.params).some((key) => key !== '_meta')) {
        return jsonRpcError(
          message.id,
          -32602,
          'Invalid params: ping accepts only request metadata.',
        );
      }
      return jsonRpcResult(message.id, completeResult({}));
    }

    if (message.method === 'tools/list') {
      if (message.params.cursor !== undefined) {
        return jsonRpcError(message.id, -32602, 'Invalid params: no cursor is expected.');
      }
      return jsonRpcResult(
        message.id,
        completeResult({
          tools: tools.map(
            ({ name, title, description, inputSchema, outputSchema, annotations }) => ({
              name,
              title,
              description,
              inputSchema,
              outputSchema,
              annotations,
            }),
          ),
          ttlMs: 300_000,
          cacheScope: 'public',
        }),
      );
    }

    if (message.method === 'tools/call') {
      const controller = new AbortController();
      inFlight.set(message.id, controller);
      try {
        const outcome = await callTool(message.params, controller.signal);
        if (outcome.cancelled) return null;
        if (outcome.protocolError) {
          return { ...outcome.protocolError, id: message.id };
        }
        return jsonRpcResult(message.id, outcome.result);
      } finally {
        inFlight.delete(message.id);
      }
    }

    return jsonRpcError(message.id, -32601, 'Method not found');
  };

  return Object.freeze({
    handle(message) {
      if (isRecord(message) && message.id === undefined) {
        if (!validateNotification(message)) {
          return Promise.resolve(jsonRpcError(undefined, -32600, 'Invalid Request'));
        }
        handleNotification(message);
        return Promise.resolve(null);
      }
      return handleRequest(message);
    },
    cancelAll() {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    },
  });
};
