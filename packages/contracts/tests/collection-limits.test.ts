import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';

import { arrayNode, contractNode, nullableNode, objectNode, optionalNode } from '../src/schema.js';
import {
  executionContextSchema, getBookingPageResponseSchema, listFreeSlotsResponseSchema,
  projectSProblemSchema, projectSScopes,
} from '../src/index.js';

const countedElement = () => {
  const visit = vi.fn((value: unknown) => value);
  return { visit, node: contractNode(z.preprocess(visit, z.string()), { type: 'string' }) };
};

describe('collection work limits', () => {
  it('demonstrates the bounded stock Zod 3 regression without exhausting memory', () => {
    const visit = vi.fn((value: unknown) => value);
    const result = z.array(z.preprocess(visit, z.string())).max(2).safeParse(Array(32).fill(0));
    expect(result.success).toBe(false);
    expect(visit).toHaveBeenCalledTimes(32);
    if (!result.success) expect(result.error.issues).toHaveLength(33);
  });

  it.each(['parse', 'safeParse', 'parseAsync', 'safeParseAsync'] as const)(
    '%s rejects oversized invalid arrays before calling any element validator', async (method) => {
      const { visit, node } = countedElement();
      const schema = arrayNode(node, { maxItems: 2 }).zod;
      if (method === 'parseAsync') await expect(schema.parseAsync(Array(32).fill(0))).rejects.toBeInstanceOf(z.ZodError);
      else if (method === 'parse') expect(() => schema.parse(Array(32).fill(0))).toThrow(z.ZodError);
      else {
        const result = await schema[method](Array(32).fill(0));
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues).toEqual([
          expect.objectContaining({ code: 'too_big', maximum: 2, type: 'array', path: [] }),
        ]);
      }
      expect(visit).not.toHaveBeenCalled();
    },
  );

  it('does not start async element work for oversized arrays', async () => {
    const visit = vi.fn(async (value: string) => value.toUpperCase());
    const schema = arrayNode(contractNode(z.string().transform(visit), { type: 'string' }), { maxItems: 2 }).zod;
    await expect(schema.safeParseAsync(Array(32).fill('valid'))).resolves.toMatchObject({ success: false });
    expect(visit).not.toHaveBeenCalled();
    await expect(schema.parseAsync(['a', 'b'])).resolves.toEqual(['A', 'B']);
    expect(visit).toHaveBeenCalledTimes(2);
  });

  it('bounds both outer and nested arrays, including optional/nullable nodes', async () => {
    const { visit, node } = countedElement();
    const nested = objectNode({
      rows: optionalNode(nullableNode(arrayNode(arrayNode(node, { maxItems: 2 }), { maxItems: 2 }))),
    }).zod;
    expect(nested.safeParse({ rows: Array(32).fill(Array(32).fill(0)) }).success).toBe(false);
    expect(visit).not.toHaveBeenCalled();
    const result = await nested.safeParseAsync({ rows: [Array(32).fill(0)] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual([
      expect.objectContaining({ code: 'too_big', path: ['rows', 0], maximum: 2 }),
    ]);
    expect(visit).not.toHaveBeenCalled();
    expect(nested.parse({ rows: [['a', 'b']] })).toEqual({ rows: [['a', 'b']] });
    expect(nested.parse({ rows: null })).toEqual({ rows: null });
    expect(nested.parse({})).toEqual({});
    expect(nested.safeParse({ rows: [], unknown: true }).success).toBe(false);
  });

  it('preserves array types, normalization, cardinality, and boundary behavior', async () => {
    const element = z.string().trim().transform((value) => value.length);
    const node = arrayNode(contractNode(element, { type: 'string', maxLength: 10 }), { minItems: 1, maxItems: 2 });
    expectTypeOf<z.input<typeof node.zod>>().toEqualTypeOf<string[]>();
    expectTypeOf<z.output<typeof node.zod>>().toEqualTypeOf<number[]>();
    expectTypeOf<z.input<ReturnType<typeof node.zod.nonempty>>>().toEqualTypeOf<[string, ...string[]]>();
    expect(node.zod).toBeInstanceOf(z.ZodArray);
    expect(node.zod.element).toBe(element);
    expect(node.jsonSchema).toEqual({ type: 'array', items: { type: 'string', maxLength: 10 }, minItems: 1, maxItems: 2 });
    expect(node.zod.parse([' a ', ' bb '])).toEqual([1, 2]);
    await expect(node.zod.parseAsync([' a ', ' bb '])).resolves.toEqual([1, 2]);
    expect(node.zod.safeParse([]).success).toBe(false);
    expect(node.zod.safeParse('not an array').success).toBe(false);
    expect(node.zod.safeParse([1]).success).toBe(false);
  });

  it.each(['min', 'max', 'length', 'nonempty', 'describe'] as const)(
    'retains the early guard after %s derivation', (method) => {
      const { visit, node } = countedElement();
      const schema = arrayNode(node, { maxItems: 2 }).zod;
      const derived = method === 'describe' ? schema.describe('bounded')
        : method === 'nonempty' ? schema.nonempty()
          : schema[method](2, 'bounded array');
      expect(derived.safeParse(Array(32).fill(0)).success).toBe(false);
      expect(visit).not.toHaveBeenCalled();
    },
  );

  it('uses exact length and custom error mapping without leaking element errors', () => {
    const { visit, node } = countedElement();
    const schema = arrayNode(node).zod.length(2, 'Exactly two items.');
    const result = schema.safeParse(Array(32).fill(0));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual([
      expect.objectContaining({ code: 'too_big', maximum: 2, exact: true, message: 'Exactly two items.' }),
    ]);
    expect(visit).not.toHaveBeenCalled();
  });

  it('continues to reject sets and maps as invalid array types without visiting elements', () => {
    const { visit, node } = countedElement();
    const schema = arrayNode(node, { maxItems: 2 }).zod;
    expect(schema.safeParse(new Set([1, 2, 3])).success).toBe(false);
    expect(schema.safeParse(new Map([[1, 2], [3, 4]])).success).toBe(false);
    expect(visit).not.toHaveBeenCalled();
  });

  it('preserves caller error maps for an early size error', () => {
    const { visit, node } = countedElement();
    const result = arrayNode(node, { maxItems: 2 }).zod.safeParse(Array(32).fill(0), {
      errorMap: (issue, context) => ({ message: `${issue.code}: ${context.defaultError}` }),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual([
      expect.objectContaining({ message: 'too_big: Array must contain at most 2 element(s)' }),
    ]);
    expect(visit).not.toHaveBeenCalled();
  });

  it.each([
    ['meeting types', getBookingPageResponseSchema.shape.data.shape.meetingTypes, 100],
    ['slots', listFreeSlotsResponseSchema.shape.data.shape.slots, 2_000],
    ['field errors', projectSProblemSchema.shape.fieldErrors.unwrap(), 32],
    ['alternatives', projectSProblemSchema.shape.alternatives.unwrap(), 3],
    ['scopes', executionContextSchema.shape.scopes.innerType(), projectSScopes.length],
  ] as const)('protects the shipped %s collection', async (_label, schema, maximum) => {
    const spy = vi.spyOn(schema.element, '_parse');
    try {
      const sync = schema.safeParse(Array(maximum + 1).fill(null));
      const asyncResult = await schema.safeParseAsync(Array(maximum + 1).fill(null));
      expect(sync.success).toBe(false);
      expect(asyncResult.success).toBe(false);
      if (!sync.success) expect(sync.error.issues).toHaveLength(1);
      if (!asyncResult.success) expect(asyncResult.error.issues).toHaveLength(1);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
