import { bookerNode, emailNode, projectSProblemEnvelopeNode } from './common.js';
import {
  createBookingResponseNode,
  getBookingPageResponseNode,
  listFreeSlotsResponseNode,
  prepareBookingResponseNode,
} from './operations.js';
import type { JsonSchema } from './schema.js';

/** Existing public HTTP request limit, counted as streamed bytes before JSON parsing. */
export const PROJECT_S_PUBLIC_REQUEST_MAX_BYTES = 16_384;

// Normalized booker fields have finite domain bounds even where their legacy
// JSON Schema describes a trimming transform rather than maxLength. These are
// the existing codec limits, not new restrictions on names, notes or email.
const bookerProperties = bookerNode.jsonSchema.properties as Record<string, JsonSchema>;
const normalizedStringLimits = new Map<unknown, number>([
  [emailNode.jsonSchema.pattern, 320],
  [bookerProperties.name.pattern, 120],
  [bookerProperties.notes.pattern, 2_000],
]);
const encoder = new TextEncoder();
const literalBytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;
const quotedStringBytes = (maximumCodeUnits: number): number => 2 + 6 * maximumCodeUnits;

/** Conservative compact-JSON budget; every UTF-16 code unit may require \uXXXX. */
const maximumSerializedBytes = (schema: JsonSchema): number => {
  if ('const' in schema) return literalBytes(schema.const);
  if (Array.isArray(schema.enum)) return Math.max(...schema.enum.map(literalBytes));
  if (Array.isArray(schema.anyOf)) {
    return Math.max(...(schema.anyOf as JsonSchema[]).map(maximumSerializedBytes));
  }
  switch (schema.type) {
    case 'null': return 4;
    case 'boolean': return 5;
    case 'integer': {
      if (typeof schema.minimum !== 'number' || typeof schema.maximum !== 'number') break;
      return Math.max(literalBytes(schema.minimum), literalBytes(schema.maximum));
    }
    case 'string': {
      const maximumCodeUnits = typeof schema.maxLength === 'number' ? schema.maxLength
        : schema.format === 'uuid' ? 36
        : schema.format === 'date' ? 10
        : schema.format === 'date-time' ? 32 // 19 date/time + 7 fraction + 6 UTC offset.
        : normalizedStringLimits.get(schema.pattern);
      if (maximumCodeUnits !== undefined) return quotedStringBytes(maximumCodeUnits);
      break;
    }
    case 'array': {
      if (typeof schema.maxItems !== 'number' || !schema.items) break;
      const count = schema.maxItems;
      return 2 + count * maximumSerializedBytes(schema.items as JsonSchema) + Math.max(0, count - 1);
    }
    case 'object': {
      if (!schema.properties || schema.additionalProperties !== false) break;
      const properties = Object.entries(schema.properties as Record<string, JsonSchema>);
      return 2 + Math.max(0, properties.length - 1) + properties.reduce(
        (total, [key, value]) => total + literalBytes(key) + 1 + maximumSerializedBytes(value), 0,
      );
    }
  }
  throw new TypeError('Public response schema needs an explicit finite serialized-byte bound.');
};

/**
 * Derived from the largest existing public response: all four success DTOs and
 * the problem envelope. Their schemas bound 100 meeting types, 2,000 slots,
 * 32 field errors and three alternatives. Include every optional field, JSON
 * keys, separators and worst-case string escaping. This accommodates valid
 * normalized server DTOs serialized with JSON.stringify. Arbitrarily padded
 * JSON or unrelated fields cannot have an unlimited finite transport budget.
 */
export const PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES = Math.max(...[
  getBookingPageResponseNode,
  listFreeSlotsResponseNode,
  prepareBookingResponseNode,
  createBookingResponseNode,
  projectSProblemEnvelopeNode,
].map((node) => maximumSerializedBytes(node.jsonSchema)));

export class BodyTooLargeError extends Error {
  constructor(readonly maximumBytes: number) {
    super(`Body exceeds the ${maximumBytes}-byte limit.`);
    this.name = 'BodyTooLargeError';
  }
}

const abortReason = (signal: AbortSignal): unknown => {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
};

const declaredLengthExceeds = (declared: string | null | undefined, limit: number): boolean => {
  if (!declared || !/^\d+$/.test(declared.trim())) return false;
  // Avoid numeric overflow or parsing attacker-sized decimal strings as BigInt.
  const digits = declared.trim().replace(/^0+/, '') || '0';
  const maximum = String(limit);
  return digits.length > maximum.length || (digits.length === maximum.length && digits > maximum);
};

const readChunk = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> => {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    // The signal can change between the initial check and listener registration.
    if (signal.aborted) {
      onAbort();
      return;
    }
    reader.read().then((result) => {
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
};

/** Read a stream under a byte cap; Content-Length is an optional rejection hint only. */
export const readBoundedText = async (
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  options: Readonly<{ declaredLength?: string | null; signal?: AbortSignal }> = {},
): Promise<string> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError('maximumBytes must be a nonnegative safe integer.');
  }
  const reader = body?.getReader();
  try {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (declaredLengthExceeds(options.declaredLength, maximumBytes)) {
      throw new BodyTooLargeError(maximumBytes);
    }
    if (!reader) return '';

    // A bounded growing buffer avoids retaining one array/string per tiny chunk.
    // Reject an oversized chunk before copying or decoding any of its bytes.
    let bytes = new Uint8Array(Math.min(maximumBytes, 1_024));
    let byteCount = 0;
    while (true) {
      const { done, value } = await readChunk(reader, options.signal);
      if (options.signal?.aborted) throw abortReason(options.signal);
      if (done) return new TextDecoder().decode(bytes.subarray(0, byteCount));
      if (value.byteLength > maximumBytes - byteCount) throw new BodyTooLargeError(maximumBytes);
      const nextCount = byteCount + value.byteLength;
      if (nextCount > bytes.byteLength) {
        const expanded = new Uint8Array(Math.min(maximumBytes, Math.max(nextCount, bytes.byteLength * 2)));
        expanded.set(bytes);
        bytes = expanded;
      }
      bytes.set(value, byteCount);
      byteCount = nextCount;
    }
  } catch (error) {
    // Cancellation is best effort: a broken or hanging cancel hook must not hide
    // the original size/read/abort failure or delay releasing our reader lock.
    try { void reader?.cancel(error).catch(() => undefined); } catch { /* Preserve the original failure. */ }
    throw error;
  } finally {
    reader?.releaseLock();
  }
};
