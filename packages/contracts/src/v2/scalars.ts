import { z } from 'zod';

import { contractLiteral, contractNode, contractNumber, contractString, contractTransform } from '../schema.js';

// The wire grammar preserves the reviewed v1-shaped offsets and up to six
// fractional digits. Date is used only for exact whole-second UTC arithmetic;
// fractional microseconds are never passed through its millisecond parser.
const instantPattern =
  '^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)(?:\\.(\\d{1,6}))?(?:[zZ]|([+-])([01]\\d|2[0-3]):([0-5]\\d))(?![\\s\\S])';
const instantExpression = new RegExp(instantPattern);
const invalidInstant = (): RangeError =>
  new RangeError('Invalid v2 instant or UTC value outside four-digit years.');

const parseInstant = (value: string): Readonly<{
  canonical: string;
  epochMicroseconds: bigint;
}> => {
  if (typeof value !== 'string') throw invalidInstant();
  const match = instantExpression.exec(value);
  if (!match) throw invalidInstant();

  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    fractionalText = '', sign, offsetHourText = '0', offsetMinuteText = '0'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) throw invalidInstant();

  // Date.UTC treats years 0..99 as 1900..1999. setUTCFullYear retains the
  // explicit proleptic Gregorian year instead, including leap year 0000.
  const localSecond = new Date(0);
  localSecond.setUTCFullYear(year, month - 1, day);
  localSecond.setUTCHours(Number(hourText), Number(minuteText), Number(secondText), 0);
  const offsetMinutes = (Number(offsetHourText) * 60 + Number(offsetMinuteText)) *
    (sign === '-' ? -1 : 1);
  const utcMilliseconds = localSecond.getTime() - offsetMinutes * 60_000;
  const utcSecond = new Date(utcMilliseconds);
  if (utcSecond.getUTCFullYear() < 0 || utcSecond.getUTCFullYear() > 9_999) {
    throw invalidInstant();
  }

  const fractionalMicroseconds = fractionalText.padEnd(6, '0');
  return {
    canonical: `${utcSecond.toISOString().slice(0, 19)}.${fractionalMicroseconds}Z`,
    epochMicroseconds: BigInt(utcMilliseconds) * 1_000n + BigInt(fractionalMicroseconds),
  };
};

/** Normalize a validated wire instant without rounding or discarding microseconds. */
export const canonicalizeV2Instant = (value: string): string => parseInstant(value).canonical;

/** Exact comparison support only; BigInt is not part of any JSON wire value. */
export const v2InstantToEpochMicroseconds = (value: string): bigint =>
  parseInstant(value).epochMicroseconds;

export const compareV2Instants = (left: string, right: string): -1 | 0 | 1 => {
  const leftMicroseconds = v2InstantToEpochMicroseconds(left);
  const rightMicroseconds = v2InstantToEpochMicroseconds(right);
  return leftMicroseconds < rightMicroseconds ? -1 : leftMicroseconds > rightMicroseconds ? 1 : 0;
};

export const v2ContractVersionNode = contractNode(contractLiteral(2), {
  type: 'integer',
  const: 2,
});
export const v2ContractVersionSchema = v2ContractVersionNode.zod;

export const v2UuidNode = contractNode(contractTransform(contractString({ length: 36, format: 'uuid' }), (value) => value.toLowerCase()), {
  type: 'string',
  format: 'uuid',
  minLength: 36,
  maxLength: 36,
  'x-project-s-normalization': 'lowercase',
});
export const v2UuidSchema = v2UuidNode.zod;

export const v2RevisionNode = contractNode(contractNumber({ integer: true, minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
export const v2RevisionSchema = v2RevisionNode.zod;

export const v2DigestNode = contractNode(contractString({ length: 64, pattern: /^[a-f0-9]{64}$/ }), {
  type: 'string',
  minLength: 64,
  maxLength: 64,
  pattern: '^[a-f0-9]{64}$',
});
export const v2DigestSchema = v2DigestNode.zod;

export const v2InstantNode = contractNode(
  contractString().transform((value, context) => {
    try {
      return canonicalizeV2Instant(value);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: invalidInstant().message, continue: true });
      return z.NEVER;
    }
  }),
  {
    type: 'string',
    format: 'date-time',
    pattern: instantPattern,
    description: 'A real Gregorian calendar instant with a four-digit year, seconds 00..59, '
      + '0..6 fractional digits and Z/z or an offset 00:00..23:59. Canonical UTC must remain '
      + 'within years 0000..9999. Normalized to UTC with exactly six fractional digits '
      + 'without losing microseconds before comparison or hashing.',
    'x-project-s-normalization': 'utc-fixed-six-fractional-digits',
    'x-project-s-semantic-validation': ['gregorian-calendar-date', 'four-digit-canonical-utc-year'],
  },
);
export const v2InstantSchema = v2InstantNode.zod;

export type V2Instant = z.infer<typeof v2InstantSchema>;
