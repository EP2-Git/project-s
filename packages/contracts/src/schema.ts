import { z } from 'zod';

export type JsonSchema = Readonly<Record<string, unknown>>;

export type ContractNode<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = Readonly<{
  zod: TSchema;
  jsonSchema: JsonSchema;
  optional: boolean;
}>;

type ContractShape = Readonly<Record<string, ContractNode>>;
type ZodShape<TShape extends ContractShape> = {
  [TKey in keyof TShape]: TShape[TKey]['zod'];
};

const cloneJson = (value: JsonSchema): Record<string, unknown> => ({ ...value });

export const contractNode = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  jsonSchema: JsonSchema,
): ContractNode<TSchema> => ({ zod: schema, jsonSchema, optional: false });

export const optionalNode = <TSchema extends z.ZodTypeAny>(
  node: ContractNode<TSchema>,
): ContractNode<z.ZodOptional<TSchema>> => ({
  zod: node.zod.optional(),
  jsonSchema: node.jsonSchema,
  optional: true,
});

export const nullableNode = <TSchema extends z.ZodTypeAny>(
  node: ContractNode<TSchema>,
): ContractNode<z.ZodNullable<TSchema>> =>
  contractNode(node.zod.nullable(), {
    anyOf: [cloneJson(node.jsonSchema), { type: 'null' }],
  });

// Zod 3 records a size issue but still parses every element. Keep its array
// API/types and ordinary parsing, but abort an excessive raw array first.
class BoundedZodArray<
  TSchema extends z.ZodTypeAny,
  TCardinality extends z.ArrayCardinality = 'many',
> extends z.ZodArray<TSchema, TCardinality> {
  override _parse(input: z.ParseInput): z.ParseReturnType<this['_output']> {
    if (Array.isArray(input.data)) {
      const exact = this._def.exactLength;
      const maximum = this._def.maxLength;
      const exceeded = exact !== null && input.data.length > exact.value
        ? { ...exact, exact: true }
        : maximum !== null && input.data.length > maximum.value
          ? { ...maximum, exact: false }
          : null;
      if (exceeded !== null) {
        z.addIssueToContext(this._getOrReturnCtx(input), {
          code: z.ZodIssueCode.too_big,
          maximum: exceeded.value,
          type: 'array',
          inclusive: true,
          exact: exceeded.exact,
          message: exceeded.message,
        });
        return z.INVALID;
      }
    }
    return super._parse(input);
  }

  override min(value: number, message?: Parameters<z.ZodArray<TSchema>['min']>[1]): this {
    return new BoundedZodArray<TSchema, TCardinality>(super.min(value, message)._def) as this;
  }

  override max(value: number, message?: Parameters<z.ZodArray<TSchema>['max']>[1]): this {
    return new BoundedZodArray<TSchema, TCardinality>(super.max(value, message)._def) as this;
  }

  override length(value: number, message?: Parameters<z.ZodArray<TSchema>['length']>[1]): this {
    return new BoundedZodArray<TSchema, TCardinality>(super.length(value, message)._def) as this;
  }
}

export const arrayNode = <TSchema extends z.ZodTypeAny>(
  node: ContractNode<TSchema>,
  options: Readonly<{ minItems?: number; maxItems?: number }> = {},
): ContractNode<z.ZodArray<TSchema>> => {
  let schema = new BoundedZodArray(node.zod.array()._def);
  if (options.minItems !== undefined) schema = schema.min(options.minItems);
  if (options.maxItems !== undefined) schema = schema.max(options.maxItems);
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
): ContractNode<z.ZodObject<ZodShape<TShape>, 'strict'>> => {
  const keys = Object.keys(shape).sort();
  const zodShape = Object.fromEntries(
    keys.map((key) => [key, shape[key].zod]),
  ) as ZodShape<TShape>;
  const properties = Object.fromEntries(
    keys.map((key) => [key, cloneJson(shape[key].jsonSchema)]),
  );
  const required = keys.filter((key) => !shape[key].optional);

  return contractNode(z.object(zodShape).strict(), {
    type: 'object',
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.description === undefined ? {} : { description: options.description }),
    properties,
    required,
    additionalProperties: false,
  });
};

export const withDescription = <TSchema extends z.ZodTypeAny>(
  node: ContractNode<TSchema>,
  description: string,
): ContractNode<TSchema> => ({
  ...node,
  jsonSchema: { ...node.jsonSchema, description },
});

export const withExample = <TSchema extends z.ZodTypeAny>(
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
