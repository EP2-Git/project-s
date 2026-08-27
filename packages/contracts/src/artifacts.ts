import {
  PROJECT_S_CONTRACT_MEDIA_TYPE,
  PROJECT_S_PROBLEM_MEDIA_TYPE,
  executionContextJsonSchema,
  projectSProblemEnvelopeJsonSchema,
  projectSProblemJsonSchema,
} from './common.js';
import { operationRegistry } from './registry.js';
import type { JsonSchema } from './schema.js';

const schemaNameFor = (operationId: string, suffix: string): string => {
  const base = operationId
    .replace(/^project-s\.public\./, '')
    .replace(/\.v1$/, '')
    .split('_')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
  return `${base}${suffix}`;
};

const response = (schema: JsonSchema, description: string) => ({
  description,
  content: {
    [PROJECT_S_CONTRACT_MEDIA_TYPE]: { schema },
    'application/json': { schema },
  },
});

const problemResponse = {
  description: 'A canonical Project S problem response.',
  headers: {
    'Retry-After': {
      description: 'Delay in seconds when retrying is safe.',
      schema: { type: 'integer', minimum: 0 },
    },
    'X-Request-Id': {
      description: 'Request correlation identifier.',
      schema: { type: 'string' },
    },
  },
  content: {
    [PROJECT_S_PROBLEM_MEDIA_TYPE]: { schema: projectSProblemJsonSchema },
    'application/json': { schema: projectSProblemJsonSchema },
  },
};

const requestBodyFor = (schema: JsonSchema) => ({
  required: true,
  content: {
    [PROJECT_S_CONTRACT_MEDIA_TYPE]: { schema },
    'application/json': { schema },
  },
});

const openApiOperationFor = (operation: (typeof operationRegistry)[number]) => {
  const common = {
    operationId: operation.id,
    summary: operation.summary,
    description: operation.description,
    tags: ['Public booking'],
    security: [],
    responses: {
      [String(operation.http.successStatus)]: response(
        operation.successJsonSchema,
        'The operation completed successfully.',
      ),
      default: problemResponse,
    },
  };

  if (operation.http.method === 'GET') {
    return {
      ...common,
      parameters: [
        {
          name: 'username',
          in: 'path',
          required: true,
          schema: (
            operation.inputJsonSchema.properties as Record<string, JsonSchema>
          ).username,
        },
      ],
    };
  }

  return { ...common, requestBody: requestBodyFor(operation.inputJsonSchema) };
};

export const generateJsonSchemaBundle = () => {
  const operationDefinitions = Object.fromEntries(
    operationRegistry.flatMap((operation) => [
      [schemaNameFor(operation.id, 'Input'), operation.inputJsonSchema],
      [schemaNameFor(operation.id, 'Data'), operation.dataJsonSchema],
      [schemaNameFor(operation.id, 'Success'), operation.successJsonSchema],
      [schemaNameFor(operation.id, 'Result'), operation.resultJsonSchema],
    ]),
  );

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://project-s.example/schemas/public-booking-v1.json',
    title: 'Project S public booking contract v1',
    description:
      'Transport-neutral contracts for Project S public booking UI, HTTP, SDK, and MCP clients.',
    $defs: {
      ExecutionContext: executionContextJsonSchema,
      ProjectSProblem: projectSProblemJsonSchema,
      ProjectSProblemEnvelope: projectSProblemEnvelopeJsonSchema,
      ...operationDefinitions,
    },
  } as const;
};

export const generateOpenApiDocument = () => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operationRegistry) {
    paths[operation.http.path] = {
      ...(paths[operation.http.path] ?? {}),
      [operation.http.method.toLowerCase()]: openApiOperationFor(operation),
    };
  }

  return {
    openapi: '3.1.1',
    info: {
      title: 'Project S public booking API',
      version: '0.1.0-prealpha',
      description:
        'The four-operation Project S Core pre-alpha public booking boundary. Names containing v1 identify the current wire contract and do not imply stability. PostgreSQL RPC names are not part of this API.',
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [{ url: '/', description: 'Current Project S deployment' }],
    paths,
    components: {
      schemas: {
        ExecutionContext: executionContextJsonSchema,
        ProjectSProblem: projectSProblemJsonSchema,
        ProjectSProblemEnvelope: projectSProblemEnvelopeJsonSchema,
      },
    },
  } as const;
};

export const generateMcpManifest = () => ({
  schemaVersion: 1,
  protocolRevision: '2026-07-28',
  server: {
    name: 'project-s-mcp',
    version: '0.1.0-prealpha',
    transport: 'stdio',
  },
  tools: operationRegistry.map((operation) => ({
    name: operation.mcp.toolName,
    title: operation.mcp.title,
    description: operation.mcp.description,
    operationId: operation.id,
    requiredScope: operation.scope,
    inputSchema: operation.inputJsonSchema,
    outputSchema: operation.resultJsonSchema,
    annotations: {
      title: operation.mcp.title,
      readOnlyHint: operation.mcp.readOnlyHint,
      destructiveHint: operation.mcp.destructiveHint,
      idempotentHint: operation.mcp.idempotentHint,
      openWorldHint: operation.mcp.openWorldHint,
    },
  })),
});

export const generateContractArtifacts = () => ({
  jsonSchemaBundle: generateJsonSchemaBundle(),
  openApi: generateOpenApiDocument(),
  mcpManifest: generateMcpManifest(),
});

export type ProjectSContractArtifacts = ReturnType<typeof generateContractArtifacts>;
