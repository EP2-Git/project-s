import { z } from 'zod';

import {
  arrayNode,
  contractNode,
  nullableNode,
  objectNode,
  optionalNode,
  type ContractNode,
} from './schema.js';

export const PROJECT_S_CONTRACT_VERSION = 1 as const;
export const PROJECT_S_CONTRACT_MEDIA_TYPE =
  'application/vnd.project-s.v1+json' as const;
export const PROJECT_S_PROBLEM_MEDIA_TYPE = 'application/problem+json' as const;

const validLocalDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day)
  );
};

const validTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const contractVersionNode = contractNode(z.literal(1), {
  type: 'integer',
  const: 1,
});
export const contractVersionSchema = contractVersionNode.zod;

export const requestIdNode = contractNode(
  z.string().min(8).max(128).regex(/^[A-Za-z0-9._~-]+$/),
  {
    type: 'string',
    minLength: 8,
    maxLength: 128,
    pattern: '^[A-Za-z0-9._~-]+$',
  },
);
export const requestIdSchema = requestIdNode.zod;

export const uuidNode = contractNode(z.string().uuid(), {
  type: 'string',
  format: 'uuid',
});
export const uuidSchema = uuidNode.zod;

export const localDateNode = contractNode(
  z.string().refine(validLocalDate, 'Invalid calendar date.'),
  {
    type: 'string',
    format: 'date',
    pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  },
);
export const localDateSchema = localDateNode.zod;

const isoInstantPattern =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?(?:[zZ]|[+-]\\d{2}:\\d{2})$';
export const isoInstantNode = contractNode(
  z
    .string()
    .datetime({ offset: true })
    .regex(new RegExp(isoInstantPattern)),
  { type: 'string', format: 'date-time', pattern: isoInstantPattern },
);
export const isoInstantSchema = isoInstantNode.zod;

export const ianaTimeZoneNode = contractNode(
  z.string().min(1).max(255).refine(validTimeZone, 'Invalid IANA time zone.'),
  {
    type: 'string',
    minLength: 1,
    maxLength: 255,
    'x-project-s-format': 'iana-time-zone',
  },
);
export const ianaTimeZoneSchema = ianaTimeZoneNode.zod;

export const publicUsernameNode = contractNode(
  z.string().min(3).max(30).regex(/^[a-z0-9][a-z0-9_-]{2,29}$/),
  {
    type: 'string',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-z0-9][a-z0-9_-]{2,29}$',
  },
);
export const publicUsernameSchema = publicUsernameNode.zod;

export const displayNameNode = contractNode(z.string().trim().min(1).max(120), {
  type: 'string',
  minLength: 1,
  maxLength: 120,
});
export const titleNode = contractNode(z.string().trim().min(1).max(160), {
  type: 'string',
  minLength: 1,
  maxLength: 160,
});
export const descriptionNode = nullableNode(
  contractNode(z.string().trim().max(2_000), {
    type: 'string',
    maxLength: 2_000,
  }),
);
export const httpsOrLocalUrlNode = contractNode(
  z.string().url().max(2_048).refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  }, 'URL must use HTTPS except on loopback hosts.'),
  {
    type: 'string',
    format: 'uri',
    maxLength: 2_048,
  },
);
export const nullablePublicUrlNode = nullableNode(httpsOrLocalUrlNode);

const bookerEmailPattern =
  '^ *(?![^@ ]*\\.\\.)([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9._+-]{0,62}[A-Za-z0-9])@([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9])(\\.([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]))+ *$';
const bookerNamePattern =
  '^ *[^\\u0000-\\u0020\\u007f-\\u009f][^\\u0000-\\u001f\\u007f-\\u009f]{0,118}[^\\u0000-\\u0020\\u007f-\\u009f] *$';
const bookerNotesPattern = '^ *(?:\\S|\\S[\\s\\S]{0,1998}\\S) *$';
const trimAsciiSpaces = (value: string) => value.replace(/^ +| +$/g, '');

export const emailNode = contractNode(
  z
    .string()
    .regex(new RegExp(bookerEmailPattern))
    .transform((value) => trimAsciiSpaces(value).toLowerCase())
    .pipe(z.string().max(320)),
  {
    type: 'string',
    pattern: bookerEmailPattern,
    'x-project-s-normalization': 'trim-ascii-spaces-and-lowercase',
  },
);

export const bookerNode = objectNode(
  {
    email: emailNode,
    name: contractNode(
      z
        .string()
        .regex(new RegExp(bookerNamePattern))
        .transform(trimAsciiSpaces),
      {
        type: 'string',
        pattern: bookerNamePattern,
        'x-project-s-normalization': 'trim-ascii-spaces',
      },
    ),
    notes: optionalNode(
      contractNode(
        z
          .string()
          .regex(new RegExp(bookerNotesPattern))
          .transform(trimAsciiSpaces),
        {
          type: 'string',
          pattern: bookerNotesPattern,
          'x-project-s-normalization': 'trim-ascii-spaces',
        },
      ),
    ),
  },
  { title: 'Booker' },
);
export const bookerSchema = bookerNode.zod;

export const preparationTokenNode = contractNode(
  z.string().min(32).max(4_096).regex(/^[A-Za-z0-9._~-]+$/),
  {
    type: 'string',
    minLength: 32,
    maxLength: 4_096,
    pattern: '^[A-Za-z0-9._~-]+$',
  },
);
export const preparationTokenSchema = preparationTokenNode.zod;

export const projectSProblemCodes = [
  'VALIDATION_ERROR',
  'INVALID_TIME_ZONE',
  'NOT_FOUND',
  'MEETING_TYPE_UNAVAILABLE',
  'SLOT_UNAVAILABLE',
  'OUTSIDE_BOOKING_WINDOW',
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'INSUFFICIENT_SCOPE',
  'CONFIRMATION_REQUIRED',
  'PREPARATION_EXPIRED',
  'PREPARATION_MISMATCH',
  'PREPARATION_STALE',
  'PREPARATION_ALREADY_COMMITTED',
  'IDEMPOTENCY_KEY_REUSED',
  'VERSION_CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export const projectSProblemCodeNode = contractNode(z.enum(projectSProblemCodes), {
  type: 'string',
  enum: [...projectSProblemCodes],
});
export const projectSProblemCodeSchema = projectSProblemCodeNode.zod;

const retryActionValues = [
  'choose_alternative',
  'confirm_in_browser',
  'prepare_again',
  'retry',
  'retry_after',
  'contact_support',
] as const;
export const retryActionSchema = z.enum(retryActionValues);
const retryActionNode = contractNode(retryActionSchema, {
  type: 'string',
  enum: [...retryActionValues],
});

const fieldErrorNode = objectNode({
  code: optionalNode(
    contractNode(z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/), {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      pattern: '^[A-Z0-9_]+$',
    }),
  ),
  message: contractNode(z.string().min(1).max(500), {
    type: 'string',
    minLength: 1,
    maxLength: 500,
  }),
  path: contractNode(z.string().min(1).max(256).regex(/^\/?[A-Za-z0-9_./-]+$/), {
    type: 'string',
    minLength: 1,
    maxLength: 256,
    pattern: '^\\/?[A-Za-z0-9_./-]+$',
  }),
});

const alternativeNode = objectNode({
  endAt: isoInstantNode,
  startAt: isoInstantNode,
});

const retryNode = objectNode({
  action: retryActionNode,
  afterSeconds: optionalNode(
    contractNode(z.number().int().nonnegative().max(86_400), {
      type: 'integer',
      minimum: 0,
      maximum: 86_400,
    }),
  ),
});

export const projectSProblemNode = objectNode(
  {
    alternatives: optionalNode(arrayNode(alternativeNode, { maxItems: 3 })),
    code: projectSProblemCodeNode,
    detail: contractNode(z.string().min(1).max(2_000), {
      type: 'string',
      minLength: 1,
      maxLength: 2_000,
    }),
    fieldErrors: optionalNode(arrayNode(fieldErrorNode, { maxItems: 32 })),
    requestId: requestIdNode,
    retry: optionalNode(retryNode),
    status: contractNode(z.number().int().min(400).max(599), {
      type: 'integer',
      minimum: 400,
      maximum: 599,
    }),
    title: contractNode(z.string().min(1).max(200), {
      type: 'string',
      minLength: 1,
      maxLength: 200,
    }),
    type: httpsOrLocalUrlNode,
  },
  { title: 'ProjectSProblem' },
);
export const projectSProblemSchema = projectSProblemNode.zod;
export const projectSProblemJsonSchema = projectSProblemNode.jsonSchema;

export const projectSProblemEnvelopeNode = objectNode(
  {
    contractVersion: contractVersionNode,
    error: projectSProblemNode,
    requestId: requestIdNode,
  },
  { title: 'ProjectSProblemEnvelope' },
);
export const projectSProblemEnvelopeSchema = projectSProblemEnvelopeNode.zod;
export const projectSProblemEnvelopeJsonSchema = projectSProblemEnvelopeNode.jsonSchema;

export const successEnvelopeNode = <TSchema extends z.ZodTypeAny>(
  data: ContractNode<TSchema>,
): ContractNode<z.ZodObject<{
  contractVersion: typeof contractVersionSchema;
  data: TSchema;
  requestId: typeof requestIdSchema;
}, 'strict'>> =>
  objectNode(
    {
      contractVersion: contractVersionNode,
      data,
      requestId: requestIdNode,
    },
    { title: 'ProjectSSuccessEnvelope' },
  );

export const projectSSuccessEnvelopeSchema = <TSchema extends z.ZodTypeAny>(
  dataSchema: TSchema,
) => z.object({
  contractVersion: contractVersionSchema,
  data: dataSchema,
  requestId: requestIdSchema,
}).strict();

export type ProjectSProblemCode = z.infer<typeof projectSProblemCodeSchema>;
export type ProjectSProblem = z.infer<typeof projectSProblemSchema>;
export type ProjectSProblemEnvelope = z.infer<typeof projectSProblemEnvelopeSchema>;
export type ProjectSSuccessEnvelope<TData> = Readonly<{
  contractVersion: typeof PROJECT_S_CONTRACT_VERSION;
  requestId: string;
  data: TData;
}>;
export type Booker = z.infer<typeof bookerSchema>;

export const projectSScopes = [
  'booking_page:read',
  'slots:read',
  'bookings:prepare',
  'bookings:create',
] as const;
export const projectSScopeNode = contractNode(z.enum(projectSScopes), {
  type: 'string',
  enum: [...projectSScopes],
});
export const projectSScopeSchema = projectSScopeNode.zod;

export const actorKinds = [
  'anonymous',
  'human',
  'api_client',
  'service',
  'delegated_agent',
] as const;
export const actorKindNode = contractNode(z.enum(actorKinds), {
  type: 'string',
  enum: [...actorKinds],
});
export const actorKindSchema = actorKindNode.zod;

export const transportKinds = [
  'ui',
  'http',
  'stdio_mcp',
  'streamable_http_mcp',
  'internal',
] as const;
export const transportNode = contractNode(z.enum(transportKinds), {
  type: 'string',
  enum: [...transportKinds],
});
export const transportSchema = transportNode.zod;

const boundedIdentifierNode = contractNode(
  z.string().min(1).max(128).regex(/^[A-Za-z0-9._~:@/-]+$/),
  {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9._~:@/-]+$',
  },
);
const hashNode = contractNode(z.string().regex(/^[a-f0-9]{64}$/), {
  type: 'string',
  pattern: '^[a-f0-9]{64}$',
});

const provenanceSourceValues = [
  'project_s_ui',
  'project_s_sdk',
  'project_s_mcp',
  'internal',
] as const;
const provenanceSourceNode = contractNode(z.enum(provenanceSourceValues), {
  type: 'string',
  enum: [...provenanceSourceValues],
});

export const provenanceNode = objectNode({
  clientVersion: optionalNode(
    contractNode(z.string().min(1).max(64), {
      type: 'string',
      minLength: 1,
      maxLength: 64,
    }),
  ),
  networkKeyHash: optionalNode(hashNode),
  source: provenanceSourceNode,
  userAgentHash: optionalNode(hashNode),
});
export const provenanceSchema = provenanceNode.zod;

const confirmationMethodValues = ['human_browser', 'verified_challenge'] as const;
const confirmationMethodNode = contractNode(z.enum(confirmationMethodValues), {
  type: 'string',
  enum: [...confirmationMethodValues],
});

export const confirmationGrantNode = objectNode({
  challengeId: optionalNode(
    contractNode(
      z.string().min(8).max(128).regex(/^[A-Za-z0-9._~-]+$/),
      {
        type: 'string',
        minLength: 8,
        maxLength: 128,
        pattern: '^[A-Za-z0-9._~-]+$',
      },
    ),
  ),
  confirmedAt: isoInstantNode,
  grantId: uuidNode,
  method: confirmationMethodNode,
});
export const confirmationGrantSchema = confirmationGrantNode.zod;

const scopesNode: ContractNode<z.ZodEffects<z.ZodArray<typeof projectSScopeSchema>>> =
  contractNode(
    z.array(projectSScopeSchema).max(projectSScopes.length).refine(
      (values) => new Set(values).size === values.length,
      'Scopes must be unique.',
    ),
    {
      type: 'array',
      items: projectSScopeNode.jsonSchema,
      maxItems: projectSScopes.length,
      uniqueItems: true,
    },
  );

export const executionContextNode = objectNode(
  {
    actorKind: actorKindNode,
    clientId: optionalNode(boundedIdentifierNode),
    confirmationGrant: optionalNode(confirmationGrantNode),
    delegationId: optionalNode(uuidNode),
    onBehalfOf: optionalNode(uuidNode),
    principalId: optionalNode(uuidNode),
    provenance: provenanceNode,
    requestId: requestIdNode,
    scopes: scopesNode,
    subjectId: optionalNode(uuidNode),
    transport: transportNode,
  },
  { title: 'ExecutionContext' },
);
export const executionContextSchema = executionContextNode.zod;
export const executionContextJsonSchema = executionContextNode.jsonSchema;

export type ProjectSScope = z.infer<typeof projectSScopeSchema>;
export type ActorKind = z.infer<typeof actorKindSchema>;
export type Transport = z.infer<typeof transportSchema>;
export type Provenance = z.infer<typeof provenanceSchema>;
export type ConfirmationGrant = z.infer<typeof confirmationGrantSchema>;
export type ExecutionContext = z.infer<typeof executionContextSchema>;

export type AnyContractNode = ContractNode<z.ZodTypeAny>;
