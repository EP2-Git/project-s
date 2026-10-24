import { z } from 'zod';

import {
  arrayNode,
  contractNode,
  contractString,
  contractNumber,
  contractEnum,
  contractLiteral,
  contractTransform,
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

export const contractVersionNode = contractNode(contractLiteral(1), {
  type: 'integer',
  const: 1,
});
export const contractVersionSchema = contractVersionNode.zod;

export const requestIdNode = contractNode(
  contractString({ minLength: 8, maxLength: 128, pattern: /^[A-Za-z0-9._~-]+$/ }),
  {
    type: 'string',
    minLength: 8,
    maxLength: 128,
    pattern: '^[A-Za-z0-9._~-]+$',
  },
);
export const requestIdSchema = requestIdNode.zod;

export const uuidNode = contractNode(contractString({ format: 'uuid' }), {
  type: 'string',
  format: 'uuid',
});
export const uuidSchema = uuidNode.zod;

export const localDateNode = contractNode(
  contractString().refine(validLocalDate, 'Invalid calendar date.'),
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
  contractString({ format: 'datetime' }).regex(new RegExp(isoInstantPattern), 'Invalid'),
  { type: 'string', format: 'date-time', pattern: isoInstantPattern },
);
export const isoInstantSchema = isoInstantNode.zod;

export const ianaTimeZoneNode = contractNode(
  contractString({ minLength: 1, maxLength: 255 }).refine(validTimeZone, 'Invalid IANA time zone.'),
  {
    type: 'string',
    minLength: 1,
    maxLength: 255,
    'x-project-s-format': 'iana-time-zone',
  },
);
export const ianaTimeZoneSchema = ianaTimeZoneNode.zod;

export const publicUsernameNode = contractNode(
  contractString({ minLength: 3, maxLength: 30, pattern: /^[a-z0-9][a-z0-9_-]{2,29}$/ }),
  {
    type: 'string',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-z0-9][a-z0-9_-]{2,29}$',
  },
);
export const publicUsernameSchema = publicUsernameNode.zod;

export const displayNameNode = contractNode(contractString({ trim: true, minLength: 1, maxLength: 120 }), {
  type: 'string',
  minLength: 1,
  maxLength: 120,
});
export const titleNode = contractNode(contractString({ trim: true, minLength: 1, maxLength: 160 }), {
  type: 'string',
  minLength: 1,
  maxLength: 160,
});
export const descriptionNode = nullableNode(
  contractNode(contractString({ trim: true, maxLength: 2_000 }), {
    type: 'string',
    maxLength: 2_000,
  }),
);
export const httpsOrLocalUrlNode = contractNode(
  contractString({ format: 'url', maxLength: 2_048 }).refine((value) => {
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
  contractTransform(contractString({ pattern: new RegExp(bookerEmailPattern) }),
    (value) => trimAsciiSpaces(value).toLowerCase())
    .pipe(contractString({ maxLength: 320 })),
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
      contractTransform(contractString({ pattern: new RegExp(bookerNamePattern) }), trimAsciiSpaces),
      {
        type: 'string',
        pattern: bookerNamePattern,
        'x-project-s-normalization': 'trim-ascii-spaces',
      },
    ),
    notes: optionalNode(
      contractNode(
        contractTransform(contractString({ pattern: new RegExp(bookerNotesPattern) }), trimAsciiSpaces),
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
  contractString({ minLength: 32, maxLength: 4_096, pattern: /^[A-Za-z0-9._~-]+$/ }),
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

export const projectSProblemCodeNode = contractNode(contractEnum(projectSProblemCodes), {
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
export const retryActionSchema = contractEnum(retryActionValues);
const retryActionNode = contractNode(retryActionSchema, {
  type: 'string',
  enum: [...retryActionValues],
});

const fieldErrorNode = objectNode({
  code: optionalNode(
    contractNode(contractString({ minLength: 1, maxLength: 64, pattern: /^[A-Z0-9_]+$/ }), {
      type: 'string',
      minLength: 1,
      maxLength: 64,
      pattern: '^[A-Z0-9_]+$',
    }),
  ),
  message: contractNode(contractString({ minLength: 1, maxLength: 500 }), {
    type: 'string',
    minLength: 1,
    maxLength: 500,
  }),
  path: contractNode(contractString({ minLength: 1, maxLength: 256, pattern: /^\/?[A-Za-z0-9_./-]+$/ }), {
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

export const projectSRetryNode = objectNode({
  action: retryActionNode,
  afterSeconds: optionalNode(
    contractNode(contractNumber({ integer: true, minimum: 0, maximum: 86_400 }), {
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
    detail: contractNode(contractString({ minLength: 1, maxLength: 2_000 }), {
      type: 'string',
      minLength: 1,
      maxLength: 2_000,
    }),
    fieldErrors: optionalNode(arrayNode(fieldErrorNode, { maxItems: 32 })),
    requestId: requestIdNode,
    retry: optionalNode(projectSRetryNode),
    status: contractNode(contractNumber({ integer: true, minimum: 400, maximum: 599 }), {
      type: 'integer',
      minimum: 400,
      maximum: 599,
    }),
    title: contractNode(contractString({ minLength: 1, maxLength: 200 }), {
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

type SuccessEnvelopeShape<TSchema extends z.ZodType> = {
  readonly contractVersion: typeof contractVersionNode;
  readonly data: ContractNode<TSchema>;
  readonly requestId: typeof requestIdNode;
};
type SuccessEnvelopeParser<TSchema extends z.ZodType> =
  ReturnType<typeof objectNode<SuccessEnvelopeShape<TSchema>>>['zod'];

export const successEnvelopeNode = <TSchema extends z.ZodType>(
  data: ContractNode<TSchema>,
): ContractNode<SuccessEnvelopeParser<TSchema>> =>
  objectNode<SuccessEnvelopeShape<TSchema>>(
    {
      contractVersion: contractVersionNode,
      data,
      requestId: requestIdNode,
    },
    { title: 'ProjectSSuccessEnvelope' },
  );

export const projectSSuccessEnvelopeSchema = <TSchema extends z.ZodType>(
  dataSchema: TSchema,
): SuccessEnvelopeParser<TSchema> => successEnvelopeNode(contractNode(dataSchema, {})).zod;

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
export const projectSScopeNode = contractNode(contractEnum(projectSScopes), {
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
export const actorKindNode = contractNode(contractEnum(actorKinds), {
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
export const transportNode = contractNode(contractEnum(transportKinds), {
  type: 'string',
  enum: [...transportKinds],
});
export const transportSchema = transportNode.zod;

const boundedIdentifierNode = contractNode(
  contractString({ minLength: 1, maxLength: 128, pattern: /^[A-Za-z0-9._~:@/-]+$/ }),
  {
    type: 'string',
    minLength: 1,
    maxLength: 128,
    pattern: '^[A-Za-z0-9._~:@/-]+$',
  },
);
const hashNode = contractNode(contractString({ pattern: /^[a-f0-9]{64}$/ }), {
  type: 'string',
  pattern: '^[a-f0-9]{64}$',
});

const provenanceSourceValues = [
  'project_s_ui',
  'project_s_sdk',
  'project_s_mcp',
  'internal',
] as const;
const provenanceSourceNode = contractNode(contractEnum(provenanceSourceValues), {
  type: 'string',
  enum: [...provenanceSourceValues],
});

export const provenanceNode = objectNode({
  clientVersion: optionalNode(
    contractNode(contractString({ minLength: 1, maxLength: 64 }), {
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
const confirmationMethodNode = contractNode(contractEnum(confirmationMethodValues), {
  type: 'string',
  enum: [...confirmationMethodValues],
});

export const confirmationGrantNode = objectNode({
  challengeId: optionalNode(
    contractNode(
      contractString({ minLength: 8, maxLength: 128, pattern: /^[A-Za-z0-9._~-]+$/ }),
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

const scopesNode =
  contractNode(
    arrayNode(projectSScopeNode, { maxItems: projectSScopes.length }).zod.refine(
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

export type AnyContractNode = ContractNode<z.ZodType>;
