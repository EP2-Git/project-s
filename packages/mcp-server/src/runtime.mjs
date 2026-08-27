import {
  PROJECT_S_MCP_SERVER_INFO,
  PROJECT_S_MCP_TOOL_NAMES,
} from './constants.mjs';

const methodByToolName = Object.freeze({
  project_s_get_booking_page_v1: 'getBookingPage',
  project_s_list_free_slots_v1: 'listFreeSlots',
  project_s_prepare_booking_v1: 'prepareBooking',
  project_s_create_booking_v1: 'createBooking',
});

export const validateProjectSApiBaseUrl = (rawValue) => {
  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    throw new Error('PROJECT_S_API_BASE_URL is required.');
  }

  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error('PROJECT_S_API_BASE_URL must be a valid absolute URL.');
  }
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error(
      'PROJECT_S_API_BASE_URL must use HTTPS, except for an HTTP loopback development URL.',
    );
  }

  if (url.username !== '' || url.password !== '') {
    throw new Error('PROJECT_S_API_BASE_URL must not contain credentials.');
  }

  return url.toString().replace(/\/$/, '');
};

const assertExactToolSet = (operations) => {
  const names = operations.map((operation) => operation?.mcp?.toolName);
  if (
    names.length !== PROJECT_S_MCP_TOOL_NAMES.length ||
    PROJECT_S_MCP_TOOL_NAMES.some((name) => !names.includes(name))
  ) {
    throw new Error(
      `@project-s/contracts must expose exactly the approved MCP v1 tools: ${PROJECT_S_MCP_TOOL_NAMES.join(', ')}.`,
    );
  }
};

export const buildProjectSMcpTools = ({ contracts, client }) => {
  const operations = contracts?.operationRegistry;
  if (!Array.isArray(operations)) {
    throw new Error('@project-s/contracts did not expose operationRegistry.');
  }

  assertExactToolSet(operations);

  return PROJECT_S_MCP_TOOL_NAMES.map((toolName) => {
    const operation = operations.find(
      (candidate) => candidate?.mcp?.toolName === toolName,
    );
    const methodName = methodByToolName[toolName];
    const method = client?.public?.[methodName];

    if (
      !operation?.inputSchema?.safeParse ||
      !operation?.inputJsonSchema ||
      !operation?.successJsonSchema ||
      typeof method !== 'function'
    ) {
      throw new Error(`Incomplete contracts or SDK implementation for ${toolName}.`);
    }

    if (!operation.resultJsonSchema) {
      throw new Error(
        `@project-s/contracts did not expose resultJsonSchema for ${toolName}.`,
      );
    }

    return Object.freeze({
      name: toolName,
      title: operation.mcp.title,
      description: operation.mcp.description,
      inputSchema: operation.inputJsonSchema,
      outputSchema: operation.resultJsonSchema,
      annotations: {
        title: operation.mcp.title,
        readOnlyHint: operation.mcp.readOnlyHint,
        destructiveHint: operation.mcp.destructiveHint,
        idempotentHint: operation.mcp.idempotentHint,
        openWorldHint: operation.mcp.openWorldHint,
      },
      parseInput(input) {
        return operation.inputSchema.safeParse(input);
      },
      parseProblem(problem) {
        return contracts.projectSProblemSchema.safeParse(problem);
      },
      execute(input, signal) {
        return method.call(client.public, input, { signal });
      },
    });
  });
};

export const createProjectSMcpClientOptions = ({ baseUrl, fetch }) => ({
  baseUrl,
  fetch,
  headers: {
    'x-project-s-source': 'project_s_mcp',
    'x-project-s-client': PROJECT_S_MCP_SERVER_INFO.name,
    'x-project-s-client-version': PROJECT_S_MCP_SERVER_INFO.version,
  },
});

export const loadProjectSMcpRuntime = async ({
  environment = process.env,
  fetch: fetchImplementation = globalThis.fetch,
} = {}) => {
  const [contracts, sdk] = await Promise.all([
    import('@project-s/contracts'),
    import('@project-s/sdk'),
  ]);
  const baseUrl = validateProjectSApiBaseUrl(environment.PROJECT_S_API_BASE_URL);
  const client = sdk.createProjectSClient(
    createProjectSMcpClientOptions({
      baseUrl,
      fetch: fetchImplementation,
    }),
  );

  return {
    tools: buildProjectSMcpTools({ contracts, client }),
  };
};
