import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const PROJECT_S_MCP_PROTOCOL_VERSION = '2026-07-28';

export const PROJECT_S_MCP_TOOL_NAMES = Object.freeze([
  'project_s_get_booking_page_v1',
  'project_s_list_free_slots_v1',
  'project_s_prepare_booking_v1',
  'project_s_create_booking_v1',
]);

export class ProjectSMcpProtocolError extends Error {
  constructor(code, message, data) {
    super(message);
    this.name = 'ProjectSMcpProtocolError';
    this.code = code;
    this.data = data;
  }
}

const defaultClientInfo = Object.freeze({
  name: 'project-s-authority-demo',
  version: '0.1.0-prealpha',
});

const waitFor = (milliseconds) =>
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });

export const startProjectSMcpClient = ({
  apiBaseUrl,
  clientInfo = defaultClientInfo,
  cwd = process.cwd(),
  environment = process.env,
  timeoutMs = 20_000,
} = {}) => {
  if (typeof apiBaseUrl !== 'string' || apiBaseUrl.trim() === '') {
    throw new TypeError('apiBaseUrl is required to start the Project S MCP client.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('timeoutMs must be a positive integer.');
  }
  if (
    !clientInfo ||
    typeof clientInfo.name !== 'string' ||
    clientInfo.name.length === 0 ||
    typeof clientInfo.version !== 'string' ||
    clientInfo.version.length === 0
  ) {
    throw new TypeError('clientInfo must contain a name and version.');
  }

  const child = spawn(process.execPath, ['packages/mcp-server/src/bin.mjs'], {
    cwd,
    env: {
      ...environment,
      PROJECT_S_API_BASE_URL: apiBaseUrl,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const pending = new Map();
  let nextId = 1;
  let closing = false;
  let closed = false;

  const rejectPending = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  };

  const closedPromise = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      closed = true;
      if (pending.size > 0) {
        rejectPending(
          new Error(
            `Project S MCP exited before completing a request (code ${code ?? 'unknown'}).`,
          ),
        );
      }
      resolve({ code, signal });
    });
  });

  child.once('error', () => {
    rejectPending(new Error('Project S MCP could not be started.'));
  });
  child.stderr.resume();
  child.stdin.on('error', () => {
    rejectPending(new Error('The Project S MCP input stream closed unexpectedly.'));
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      rejectPending(new Error('Project S MCP emitted an invalid protocol response.'));
      child.kill();
      return;
    }

    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);

    if (message.error) {
      entry.reject(
        new ProjectSMcpProtocolError(
          message.error.code,
          message.error.message,
          message.error.data,
        ),
      );
      return;
    }
    entry.resolve(message.result);
  });

  const request = (method, params = {}) => {
    if (closing || closed) {
      return Promise.reject(new Error('Project S MCP client is closed.'));
    }

    return new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for MCP ${method}.`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timeout });
      const payload = `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion':
              PROJECT_S_MCP_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': clientInfo,
          },
        },
      })}\n`;

      child.stdin.write(payload, (error) => {
        if (!error) return;
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        clearTimeout(entry.timeout);
        entry.reject(new Error('Could not write to the Project S MCP process.'));
      });
    });
  };

  const completeRequest = async (method, params) => {
    const result = await request(method, params);
    if (!result || result.resultType !== 'complete') {
      throw new Error(`Project S MCP returned an incomplete ${method} response.`);
    }
    return result;
  };

  const close = async () => {
    if (closing) {
      const result = await closedPromise;
      if (result.code !== 0) throw new Error('Project S MCP did not exit cleanly.');
      return;
    }

    closing = true;
    if (!closed && child.stdin.writable) child.stdin.end();
    let result = await Promise.race([closedPromise, waitFor(3_000)]);
    if (!result) {
      child.kill();
      result = await Promise.race([closedPromise, waitFor(3_000)]);
    }
    if (!result) throw new Error('Project S MCP did not stop.');
    if (result.code !== 0) throw new Error('Project S MCP did not exit cleanly.');
  };

  return Object.freeze({
    request,
    discover: () => completeRequest('server/discover', {}),
    listTools: () => completeRequest('tools/list', {}),
    callTool: (name, args) =>
      completeRequest('tools/call', { name, arguments: args }),
    close,
  });
};

export const createProjectSMcpClient = ({
  baseUrl,
  clientName = defaultClientInfo.name,
  ...options
} = {}) =>
  startProjectSMcpClient({
    ...options,
    apiBaseUrl: baseUrl,
    clientInfo: {
      name: clientName,
      version: defaultClientInfo.version,
    },
  });
