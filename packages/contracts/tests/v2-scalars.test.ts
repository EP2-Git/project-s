import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  canonicalizeV2Instant,
  compareV2Instants,
  v2ContractVersionNode,
  v2DigestNode,
  v2InstantNode,
  v2InstantSchema,
  v2InstantToEpochMicroseconds,
  v2RevisionNode,
  v2UuidNode,
  type V2Instant,
} from '../src/v2/scalars.js';

describe('strict v2 scalar contracts', () => {
  it('requires version 2, positive safe integer revisions, UUIDs and lowercase digests', () => {
    expect(v2ContractVersionNode.zod.parse(2)).toBe(2);
    expect(v2RevisionNode.zod.parse(1)).toBe(1);
    expect(v2RevisionNode.zod.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(v2UuidNode.zod.parse('12345678-ABCD-4ABC-8ABC-123456789ABC'))
      .toBe('12345678-abcd-4abc-8abc-123456789abc');
    expect(v2DigestNode.zod.parse('a9'.repeat(32))).toBe('a9'.repeat(32));

    for (const value of [1, '2', 3, null]) {
      expect(v2ContractVersionNode.zod.safeParse(value).success).toBe(false);
    }
    for (const value of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1']) {
      expect(v2RevisionNode.zod.safeParse(value).success).toBe(false);
    }
    for (const value of ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), ` ${'a'.repeat(64)}`, `${'a'.repeat(64)}\n`]) {
      expect(v2DigestNode.zod.safeParse(value).success).toBe(false);
    }
    for (const value of ['not-a-uuid', '12345678ABCD4ABC8ABC123456789ABC', '', '12345678-abcd-4abc-8abc-123456789abc\n']) {
      expect(v2UuidNode.zod.safeParse(value).success).toBe(false);
    }
  });

  it('refuses non-scalar values rather than coercing them', () => {
    const nodes = [v2ContractVersionNode, v2RevisionNode, v2UuidNode, v2DigestNode, v2InstantNode];
    for (const node of nodes) {
      for (const value of [undefined, null, {}, [], true, false, 1n]) {
        expect(node.zod.safeParse(value).success).toBe(false);
      }
    }
    expectTypeOf<V2Instant>().toEqualTypeOf<string>();
  });
});

describe('lossless v2 instants', () => {
  it.each([
    ['2026-10-21T13:00:00Z', '2026-10-21T13:00:00.000000Z'],
    ['2026-10-21T13:00:00z', '2026-10-21T13:00:00.000000Z'],
    ['2026-10-21T13:00:00.1Z', '2026-10-21T13:00:00.100000Z'],
    ['2026-10-21T13:00:00.123Z', '2026-10-21T13:00:00.123000Z'],
    ['2026-10-21T13:00:00.123456Z', '2026-10-21T13:00:00.123456Z'],
    ['2026-10-21T10:30:00.123456-02:30', '2026-10-21T13:00:00.123456Z'],
    ['2026-10-22T12:59:00.123456+23:59', '2026-10-21T13:00:00.123456Z'],
    ['2026-10-20T13:01:00.123456-23:59', '2026-10-21T13:00:00.123456Z'],
    ['2026-10-21T13:00:00.000001-00:00', '2026-10-21T13:00:00.000001Z'],
    ['0000-02-29T00:00:00.000001Z', '0000-02-29T00:00:00.000001Z'],
    ['0099-12-31T23:59:59.999999Z', '0099-12-31T23:59:59.999999Z'],
    ['2000-02-29T00:00:00+00:00', '2000-02-29T00:00:00.000000Z'],
    ['0000-01-01T00:01:00+00:01', '0000-01-01T00:00:00.000000Z'],
    ['9999-12-31T23:58:59.999999-00:01', '9999-12-31T23:59:59.999999Z'],
  ])('normalizes %s to %s without changing precision', (input, canonical) => {
    expect(v2InstantSchema.parse(input)).toBe(canonical);
    expect(canonicalizeV2Instant(input)).toBe(canonical);
    expect(canonicalizeV2Instant(canonical)).toBe(canonical);
    expect(compareV2Instants(input, canonical)).toBe(0);
    expect(typeof v2InstantSchema.parse(input)).toBe('string');
  });

  it('preserves offset and trailing-zero equivalence for hashing', () => {
    const values = [
      '2026-10-21T13:00:00.1Z',
      '2026-10-21T13:00:00.100000+00:00',
      '2026-10-21T10:30:00.100-02:30',
      '2026-10-21T14:00:00.1000+01:00',
    ];
    expect(new Set(values.map(canonicalizeV2Instant))).toEqual(
      new Set(['2026-10-21T13:00:00.100000Z']),
    );
  });

  it('distinguishes adjacent microseconds, including the negative epoch boundary', () => {
    expect(v2InstantToEpochMicroseconds('1969-12-31T23:59:59.999998Z')).toBe(-2n);
    expect(v2InstantToEpochMicroseconds('1969-12-31T23:59:59.999999Z')).toBe(-1n);
    expect(v2InstantToEpochMicroseconds('1970-01-01T00:00:00Z')).toBe(0n);
    expect(v2InstantToEpochMicroseconds('1970-01-01T00:00:00.000001Z')).toBe(1n);
    expect(compareV2Instants('1969-12-31T23:59:59.999999Z', '1970-01-01T00:00:00Z')).toBe(-1);
    expect(compareV2Instants('2026-10-21T13:00:00.123457Z', '2026-10-21T13:00:00.123456Z'))
      .toBe(1);
    expect(canonicalizeV2Instant('2026-10-21T13:00:00.123457Z'))
      .not.toBe(canonicalizeV2Instant('2026-10-21T13:00:00.123456Z'));
    // The supported four-digit year range exceeds Number's safe microsecond range.
    expect(v2InstantToEpochMicroseconds('9999-12-31T23:59:59.999999Z') -
      v2InstantToEpochMicroseconds('9999-12-31T23:59:59.999998Z')).toBe(1n);
  });

  it.each([
    '2026-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '0100-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-00-01T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-01-00T00:00:00Z', '2026-01-32T00:00:00Z', '2026-01-01T24:00:00Z',
    '2026-01-01T23:60:00Z', '2026-01-01T23:59:60Z',
    '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00-24:00',
    '2026-01-01T00:00:00+00:60', '2026-01-01T00:00:00+01',
    '2026-01-01T00:00:00.1234567Z', '2026-01-01T00:00:00.Z',
    '2026-01-01T00:00Z', '2026-01-01T00:00:00', '2026-01-01t00:00:00Z',
    '2026-01-01 00:00:00Z', ' 2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z ',
    '2026-01-01T00:00:00Z\n', '2026-01-01T00:00:00Z\r\n',
    '+010000-01-01T00:00:00Z', '999-01-01T00:00:00Z',
    '0000-01-01T00:00:00+00:01', '9999-12-31T23:59:59-00:01',
  ])('rejects invalid grammar, calendar or unrepresentable canonical UTC: %s', (input) => {
    expect(v2InstantSchema.safeParse(input).success).toBe(false);
    expect(() => canonicalizeV2Instant(input)).toThrow(RangeError);
    expect(() => v2InstantToEpochMicroseconds(input)).toThrow(RangeError);
    expect(() => compareV2Instants(input, '1970-01-01T00:00:00Z')).toThrow(RangeError);
  });

  it('retains exact order for deterministic microsecond and offset vectors', () => {
    // Recorded deterministic seed, independent integer reference around the epoch.
    let seed = 0x21_10_2026;
    for (let index = 0; index < 256; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const fraction = seed % 1_000_000;
      const offset = (seed % (23 * 60 + 60)) - (12 * 60);
      const sign = offset < 0 ? '-' : '+';
      const absoluteOffset = Math.abs(offset);
      const suffix = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, '0')}:`
        + String(absoluteOffset % 60).padStart(2, '0');
      const fractionText = String(fraction).padStart(6, '0');
      const input = `1970-01-01T00:00:00.${fractionText}${suffix}`;
      const reference = BigInt(fraction) - BigInt(offset) * 60_000_000n;
      expect(v2InstantToEpochMicroseconds(input), `seed=${seed}`).toBe(reference);
      const canonical = canonicalizeV2Instant(input);
      expect(v2InstantToEpochMicroseconds(canonical), `seed=${seed}`).toBe(reference);
      expect(compareV2Instants(input, canonical), `seed=${seed}`).toBe(0);
      if (fraction < 999_999) {
        const next = `1970-01-01T00:00:00.${String(fraction + 1).padStart(6, '0')}${suffix}`;
        expect(compareV2Instants(input, next), `seed=${seed}`).toBe(-1);
        expect(v2InstantToEpochMicroseconds(next) - reference, `seed=${seed}`).toBe(1n);
      }
    }
  });

  it('describes input grammar, semantic checks and wire normalization without a BigInt field', () => {
    expect(v2InstantNode.jsonSchema.type).toBe('string');
    expect(v2InstantNode.jsonSchema['x-project-s-normalization'])
      .toBe('utc-fixed-six-fractional-digits');
    expect(v2InstantNode.jsonSchema['x-project-s-semantic-validation'])
      .toEqual(['gregorian-calendar-date', 'four-digit-canonical-utc-year']);
    const pattern = new RegExp(v2InstantNode.jsonSchema.pattern as string);
    expect(pattern.test('2026-10-21T13:00:00.000001-23:59')).toBe(true);
    expect(pattern.test('2026-10-21T13:00:00.0000001Z')).toBe(false);
    expect(pattern.test('2026-10-21T13:00:00+24:00')).toBe(false);
    expect(() => JSON.stringify(v2InstantSchema.parse('2026-10-21T13:00:00.000001Z')))
      .not.toThrow();
  });
});
