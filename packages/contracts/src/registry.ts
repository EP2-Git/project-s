import type { z } from 'zod';

import {
  projectSProblemEnvelopeJsonSchema,
  projectSProblemJsonSchema,
  type ProjectSScope,
} from './common.js';
import {
  createBookingDataNode,
  createBookingInputNode,
  createBookingResponseNode,
  getBookingPageDataNode,
  getBookingPageInputNode,
  getBookingPageResponseNode,
  listFreeSlotsDataNode,
  listFreeSlotsInputNode,
  listFreeSlotsResponseNode,
  prepareBookingDataNode,
  prepareBookingInputNode,
  prepareBookingResponseNode,
} from './operations.js';
import type { ContractNode, JsonSchema } from './schema.js';

export const projectSOperationIds = [
  'project-s.public.get_booking_page.v1',
  'project-s.public.list_free_slots.v1',
  'project-s.public.prepare_booking.v1',
  'project-s.public.create_booking.v1',
] as const;
export type ProjectSOperationId = (typeof projectSOperationIds)[number];

export const projectSMcpToolNames = [
  'project_s_get_booking_page_v1',
  'project_s_list_free_slots_v1',
  'project_s_prepare_booking_v1',
  'project_s_create_booking_v1',
] as const;
export type ProjectSMcpToolName = (typeof projectSMcpToolNames)[number];

export type ProjectSHttpMethod = 'GET' | 'POST';
export type ProjectSOperationStability = 'prealpha' | 'stable';

export type ProjectSOperationDescriptor<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TData extends z.ZodTypeAny = z.ZodTypeAny,
  TSuccess extends z.ZodTypeAny = z.ZodTypeAny,
> = Readonly<{
  id: ProjectSOperationId;
  version: 1;
  stability: ProjectSOperationStability;
  scope: ProjectSScope;
  summary: string;
  description: string;
  http: Readonly<{
    method: ProjectSHttpMethod;
    path: string;
    successStatus: 200 | 201;
  }>;
  mcp: Readonly<{
    toolName: ProjectSMcpToolName;
    title: string;
    description: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  }>;
  inputSchema: TInput;
  dataSchema: TData;
  successSchema: TSuccess;
  inputJsonSchema: JsonSchema;
  dataJsonSchema: JsonSchema;
  successJsonSchema: JsonSchema;
  resultJsonSchema: JsonSchema;
}>;

const resultJsonSchema = (successJsonSchema: JsonSchema): JsonSchema => ({
  oneOf: [successJsonSchema, projectSProblemEnvelopeJsonSchema],
});

const defineOperation = <
  TInput extends z.ZodTypeAny,
  TData extends z.ZodTypeAny,
  TSuccess extends z.ZodTypeAny,
>(definition: Omit<
  ProjectSOperationDescriptor<TInput, TData, TSuccess>,
  | 'inputSchema'
  | 'dataSchema'
  | 'successSchema'
  | 'inputJsonSchema'
  | 'dataJsonSchema'
  | 'successJsonSchema'
  | 'resultJsonSchema'
> & Readonly<{
  input: ContractNode<TInput>;
  data: ContractNode<TData>;
  success: ContractNode<TSuccess>;
}>): ProjectSOperationDescriptor<TInput, TData, TSuccess> => ({
  id: definition.id,
  version: definition.version,
  stability: definition.stability,
  scope: definition.scope,
  summary: definition.summary,
  description: definition.description,
  http: definition.http,
  mcp: definition.mcp,
  inputSchema: definition.input.zod,
  dataSchema: definition.data.zod,
  successSchema: definition.success.zod,
  inputJsonSchema: definition.input.jsonSchema,
  dataJsonSchema: definition.data.jsonSchema,
  successJsonSchema: definition.success.jsonSchema,
  resultJsonSchema: resultJsonSchema(definition.success.jsonSchema),
});

const getBookingPageOperation = defineOperation({
  id: 'project-s.public.get_booking_page.v1',
  version: 1,
  stability: 'prealpha',
  scope: 'booking_page:read',
  summary: 'Get a public booking page',
  description:
    'Returns the host identity, time zone, and public meeting types needed to begin a booking.',
  http: {
    method: 'GET',
    path: '/api/v1/public/booking-pages/{username}',
    successStatus: 200,
  },
  mcp: {
    toolName: 'project_s_get_booking_page_v1',
    title: 'Get booking page',
    description:
      'Get a public Project S booking page by username. Returns only public scheduling metadata.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  input: getBookingPageInputNode,
  data: getBookingPageDataNode,
  success: getBookingPageResponseNode,
});

const listFreeSlotsOperation = defineOperation({
  id: 'project-s.public.list_free_slots.v1',
  version: 1,
  stability: 'prealpha',
  scope: 'slots:read',
  summary: 'List public free slots',
  description:
    'Lists currently available intervals for one meeting type, local date, and display time zone.',
  http: {
    method: 'POST',
    path: '/api/v1/public/free-slots/search',
    successStatus: 200,
  },
  mcp: {
    toolName: 'project_s_list_free_slots_v1',
    title: 'List free slots',
    description:
      'List currently available Project S times. Availability can change until a booking is committed.',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  input: listFreeSlotsInputNode,
  data: listFreeSlotsDataNode,
  success: listFreeSlotsResponseNode,
});

const prepareBookingOperation = defineOperation({
  id: 'project-s.public.prepare_booking.v1',
  version: 1,
  stability: 'prealpha',
  scope: 'bookings:prepare',
  summary: 'Prepare a public booking',
  description:
    'Validates a booking intent and creates a short-lived, non-reserving preparation for human review.',
  http: {
    method: 'POST',
    path: '/api/v1/public/bookings/prepare',
    successStatus: 200,
  },
  mcp: {
    toolName: 'project_s_prepare_booking_v1',
    title: 'Prepare booking',
    description:
      'Prepare a Project S booking for browser confirmation. This does not hold the time or create a booking.',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  input: prepareBookingInputNode,
  data: prepareBookingDataNode,
  success: prepareBookingResponseNode,
});

const createBookingOperation = defineOperation({
  id: 'project-s.public.create_booking.v1',
  version: 1,
  stability: 'prealpha',
  scope: 'bookings:create',
  summary: 'Create a confirmed public booking',
  description:
    'Commits a previously prepared and human-confirmed booking using an idempotency key.',
  http: {
    method: 'POST',
    path: '/api/v1/public/bookings',
    successStatus: 201,
  },
  mcp: {
    toolName: 'project_s_create_booking_v1',
    title: 'Create booking',
    description:
      'Create a Project S booking from a browser-confirmed preparation. Unconfirmed or stale preparations fail safely.',
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  input: createBookingInputNode,
  data: createBookingDataNode,
  success: createBookingResponseNode,
});

export const operationRegistry = Object.freeze([
  getBookingPageOperation,
  listFreeSlotsOperation,
  prepareBookingOperation,
  createBookingOperation,
] as const);

export const operationRegistryById = Object.freeze(
  Object.fromEntries(operationRegistry.map((operation) => [operation.id, operation])) as
    Record<ProjectSOperationId, (typeof operationRegistry)[number]>,
);

export const operationRegistryByMcpToolName = Object.freeze(
  Object.fromEntries(
    operationRegistry.map((operation) => [operation.mcp.toolName, operation]),
  ) as Record<ProjectSMcpToolName, (typeof operationRegistry)[number]>,
);

export const projectSContractVersionPolicy = Object.freeze({
  currentVersion: 1 as const,
  supportedVersions: [1] as const,
  compatibility:
    'V1 inputs, outputs, envelopes, and problems are strict. Any field addition or removal, semantic change, or reason-code change requires a new contract version.',
  unknownInputFields: 'reject' as const,
  unknownAuthorityFields: 'reject' as const,
});

export { projectSProblemJsonSchema };
