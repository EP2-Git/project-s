import { z } from 'zod';

export type JsonSchema = Readonly<Record<string, unknown>>;

export type ContractNode<TSchema extends z.ZodType = z.ZodType> = Readonly<{
  zod: TSchema;
  jsonSchema: JsonSchema;
  optional: boolean;
}>;

type ContractShape = Readonly<Record<string, ContractNode>>;
type ZodShape<TShape extends ContractShape> = {
  [TKey in keyof TShape]: TShape[TKey]['zod'];
};

const cloneJson = (value: JsonSchema): Record<string, unknown> => ({ ...value });

const receivedType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isNaN(value)) return 'nan';
  if (typeof value === 'object') {
    if ('then' in value && typeof value.then === 'function'
      && 'catch' in value && typeof value.catch === 'function') return 'promise';
    if (value instanceof Map) return 'map';
    if (value instanceof Set) return 'set';
    if (value instanceof Date) return 'date';
  }
  return typeof value;
};
const quotedValues = (values: readonly unknown[], separator = ' | '): string =>
  values.map((value) => typeof value === 'string' ? `'${value}'` : String(value)).join(separator);

/** Schema-local wording for Project S's existing public field-error contract. */
export const projectSValidationError: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'Required'
        : `Expected ${issue.expected === 'int' ? 'integer' : issue.expected}, received ${issue.expected === 'int' ? 'float' : receivedType(issue.input)}`;
    case 'unrecognized_keys':
      return `Unrecognized key(s) in object: ${quotedValues(issue.keys, ', ')}`;
    case 'too_small':
      if (issue.origin === 'string') return `String must contain ${issue.exact ? 'exactly' : issue.inclusive ? 'at least' : 'over'} ${issue.minimum} character(s)`;
      if (issue.origin === 'array') return `Array must contain ${issue.exact ? 'exactly' : issue.inclusive ? 'at least' : 'more than'} ${issue.minimum} element(s)`;
      if (issue.origin === 'number' || issue.origin === 'int') return `Number must be ${issue.exact ? 'exactly equal to ' : issue.inclusive ? 'greater than or equal to ' : 'greater than '}${issue.minimum}`;
      break;
    case 'too_big':
      if (issue.origin === 'string') return `String must contain ${issue.exact ? 'exactly' : issue.inclusive ? 'at most' : 'under'} ${issue.maximum} character(s)`;
      if (issue.origin === 'array') return `Array must contain ${issue.exact ? 'exactly' : issue.inclusive ? 'at most' : 'less than'} ${issue.maximum} element(s)`;
      if (issue.origin === 'number' || issue.origin === 'int') return `Number must be ${issue.exact ? 'exactly' : issue.inclusive ? 'less than or equal to' : 'less than'} ${issue.maximum}`;
      break;
    case 'invalid_format':
      return issue.format === 'regex' ? 'Invalid' : `Invalid ${issue.format}`;
    case 'custom':
      return 'Invalid input';
  }
  return undefined;
};

// Preserve the v1 GUID-shaped grammar, including its non-RFC-version UUIDs.
const legacyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const legacyDate = '(?:(?:\\d\\d(?:[2468][048]|[13579][26]|0[48])|(?:[02468][048]|[13579][26])00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2[0-8])))';
const legacyDatetime = new RegExp(`^${legacyDate}T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})$`);

export type ContractStringOptions = Readonly<{
  trim?: boolean;
  minLength?: number;
  maxLength?: number;
  length?: number;
  pattern?: RegExp;
  format?: 'uuid' | 'datetime' | 'url';
}>;

/** Keep UTF-16 bounds and legacy formats without a process-global Zod override. */
export const contractString = (options: ContractStringOptions = {}): z.ZodString => {
  let schema = z.string({ error: projectSValidationError });
  if (options.trim) schema = schema.trim();
  const minimum = options.length ?? options.minLength;
  const maximum = options.length ?? options.maxLength;
  if (minimum !== undefined || maximum !== undefined) {
    schema = schema.check((context) => {
      const common = { origin: 'string', inclusive: true, exact: options.length !== undefined,
        input: context.value, continue: true } as const;
      if (minimum !== undefined && context.value.length < minimum) context.issues.push({
        ...common, code: 'too_small', minimum,
        message: `String must contain ${common.exact ? 'exactly' : 'at least'} ${minimum} character(s)`,
      });
      if (maximum !== undefined && context.value.length > maximum) context.issues.push({
        ...common, code: 'too_big', maximum,
        message: `String must contain ${common.exact ? 'exactly' : 'at most'} ${maximum} character(s)`,
      });
    });
  }
  if (options.format === 'uuid') schema = schema.regex(legacyUuid, 'Invalid uuid');
  if (options.format === 'datetime') schema = schema.regex(legacyDatetime, 'Invalid datetime');
  if (options.format === 'url') schema = schema.refine((value) => {
    try { new URL(value); return true; } catch { return false; }
  }, 'Invalid url');
  if (options.pattern) schema = schema.regex(options.pattern, 'Invalid');
  return schema;
};

/** Retain finite bounds and legacy integer diagnostics without a new safe-int limit. */
export const contractNumber = (options: Readonly<{
  integer?: boolean;
  minimum?: number;
  maximum?: number;
}> = {}) => z.custom<number>().check((context) => {
  const value = context.value;
  if (typeof value !== 'number' || Number.isNaN(value)) {
    context.issues.push({ code: 'invalid_type', expected: 'number', input: value,
      message: value === undefined ? 'Required' : `Expected number, received ${receivedType(value)}` });
    return;
  }
  if (options.integer && !Number.isInteger(value)) context.issues.push({
    code: 'invalid_type', expected: 'int', input: value, continue: true,
    message: 'Expected integer, received float',
  });
  if (options.minimum !== undefined && value < options.minimum) context.issues.push({
    code: 'too_small', origin: 'number', minimum: options.minimum, inclusive: true,
    input: value, continue: true, message: `Number must be greater than or equal to ${options.minimum}`,
  });
  if (options.maximum !== undefined && value > options.maximum) context.issues.push({
    code: 'too_big', origin: 'number', maximum: options.maximum, inclusive: true,
    input: value, continue: true, message: `Number must be less than or equal to ${options.maximum}`,
  });
});

export const contractEnum = <const TValues extends readonly string[]>(values: TValues) =>
  z.enum(values, { error: (issue) => {
    if (issue.code !== 'invalid_value') return projectSValidationError(issue);
    if (typeof issue.input !== 'string') return issue.input === undefined ? 'Required'
      : `Expected ${quotedValues(issue.values)}, received ${receivedType(issue.input)}`;
    return `Invalid enum value. Expected ${quotedValues(issue.values)}, received '${issue.input}'`;
  } });

export const contractLiteral = <const TValue extends string | number | boolean>(value: TValue) =>
  z.literal(value, { error: () => `Invalid literal value, expected ${JSON.stringify(value)}` });

/** Preserve v3's abort when a synchronous base fails before normalization. */
export const contractTransform = <TSchema extends z.ZodType, TOutput>(
  schema: TSchema,
  transform: (value: z.output<TSchema>) => TOutput,
) => z.preprocess((value: z.input<TSchema>, context) => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue({ ...issue, continue: false });
    return z.NEVER;
  }
  return parsed.data;
}, z.custom<z.output<TSchema>>().transform(transform));

/** Reject legacy non-object categories before visiting a caller's object schema. */
export const withContractObjectInput = <TSchema extends z.ZodType>(schema: TSchema) => {
  return z.preprocess((value: z.input<TSchema>, context) => {
    const received = receivedType(value);
    if (received !== 'object') {
      context.addIssue({ code: 'invalid_type', expected: 'object',
        message: received === 'undefined' ? 'Required' : `Expected object, received ${received}` });
      return z.NEVER;
    }
    return value;
  }, schema);
};

export type ContractObjectSchema<TShape extends z.ZodRawShape> =
  z.ZodPreprocess<z.ZodObject<TShape, z.core.$strict>, z.input<z.ZodObject<TShape, z.core.$strict>>>;

export type ContractObjectNode<TShape extends ContractShape> =
  ContractNode<ContractObjectSchema<ZodShape<TShape>>> & Readonly<{ shape: ZodShape<TShape> }>;

export const contractObject = <TShape extends z.ZodRawShape>(shape: TShape): ContractObjectSchema<TShape> => {
  const schema: z.ZodObject<TShape, z.core.$strict> =
    z.strictObject(shape, { error: projectSValidationError });
  return withContractObjectInput(schema);
};

export const contractNode = <TSchema extends z.ZodType>(
  schema: TSchema,
  jsonSchema: JsonSchema,
): ContractNode<TSchema> => ({ zod: schema, jsonSchema, optional: false });

export const optionalNode = <TSchema extends z.ZodType>(
  node: ContractNode<TSchema>,
): ContractNode<z.ZodOptional<TSchema>> => ({
  zod: node.zod.optional(),
  jsonSchema: node.jsonSchema,
  optional: true,
});

export const nullableNode = <TSchema extends z.ZodType>(
  node: ContractNode<TSchema>,
): ContractNode<z.ZodNullable<TSchema>> =>
  contractNode(node.zod.nullable(), {
    anyOf: [cloneJson(node.jsonSchema), { type: 'null' }],
  });

export const arrayNode = <TSchema extends z.ZodType>(
  node: ContractNode<TSchema>,
  options: Readonly<{ minItems?: number; maxItems?: number }> = {},
): ContractNode<z.ZodArray<TSchema>> => {
  // Patched Zod 4 runs its leading upper bound before parsing any child.
  let schema = z.array(node.zod, { error: projectSValidationError });
  // Public core checks retain native leading bounds while guarding their
  // post-parse `when`: a wrong-type string must report only Expected array.
  if (options.minItems !== undefined) schema = schema.check(new z.core.$ZodCheckMinLength({
    check: 'min_length', minimum: options.minItems, error: projectSValidationError,
    when: ({ value }) => Array.isArray(value),
  }));
  if (options.maxItems !== undefined) schema = schema.check(new z.core.$ZodCheckMaxLength({
    check: 'max_length', maximum: options.maxItems, error: projectSValidationError,
    when: ({ value }) => Array.isArray(value),
  }));
  return contractNode(schema, {
    type: 'array',
    items: cloneJson(node.jsonSchema),
    ...(options.minItems === undefined ? {} : { minItems: options.minItems }),
    ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
  });
};

export const objectNode = <const TShape extends ContractShape>(
  shape: TShape,
  options: Readonly<{ title?: string; description?: string }> = {},
): ContractObjectNode<TShape> => {
  const keys = Object.keys(shape).sort();
  const zodShape = Object.fromEntries(
    keys.map((key) => [key, shape[key].zod]),
  ) as ZodShape<TShape>;
  const properties = Object.fromEntries(
    keys.map((key) => [key, cloneJson(shape[key].jsonSchema)]),
  );
  const required = keys.filter((key) => !shape[key].optional);

  const node = contractNode(contractObject(zodShape), {
    type: 'object',
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined ? {} : { description: options.description }),
    properties,
    required,
    additionalProperties: false,
  });
  return { ...node, shape: zodShape };
};

export const withDescription = <TSchema extends z.ZodType>(
  node: ContractNode<TSchema>,
  description: string,
): ContractNode<TSchema> => ({
  ...node,
  jsonSchema: { ...node.jsonSchema, description },
});

export const withExample = <TSchema extends z.ZodType>(
  node: ContractNode<TSchema>,
  example: unknown,
): ContractNode<TSchema> => ({
  ...node,
  jsonSchema: { ...node.jsonSchema, examples: [example] },
});

export const stableStringify = (value: unknown, indentation = 2): string => {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === 'object') {
      if (seen.has(input)) throw new TypeError('Cannot stringify a cyclic value.');
      seen.add(input);
      const normalized = Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, child]) => child !== undefined)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, child]) => [key, normalize(child)]),
      );
      seen.delete(input);
      return normalized;
    }
    return input;
  };

  return `${JSON.stringify(normalize(value), null, indentation)}\n`;
};
