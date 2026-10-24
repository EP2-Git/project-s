import { describe, expect, it, vi } from 'vitest';

import {
  BodyTooLargeError,
  PROJECT_S_PUBLIC_REQUEST_MAX_BYTES,
  PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES,
  createBookingResponseSchema,
  getBookingPageResponseSchema,
  listFreeSlotsResponseSchema,
  prepareBookingResponseSchema,
  projectSProblemEnvelopeSchema,
  readBoundedText,
} from '../src/index.js';

const encoder = new TextEncoder();
const chunksOf = (bytes: Uint8Array, chunkSize: number): Uint8Array[] => {
  const result: Uint8Array[] = [];
  for (let index = 0; index < bytes.byteLength; index += chunkSize) {
    result.push(bytes.subarray(index, index + chunkSize));
  }
  return result;
};
const streamed = (chunks: Uint8Array[]) => {
  let index = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  return { body, cancel, pull };
};

describe('bounded streamed transport bodies', () => {
  it('reads an exact byte boundary and releases its reader on normal completion', async () => {
    const { body, cancel } = streamed([encoder.encode('123'), encoder.encode('45')]);
    await expect(readBoundedText(body, 5)).resolves.toBe('12345');
    expect(body.locked).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '0', '1', '00001'])(
    'counts actual chunks despite absent or understated Content-Length %s', async (declaredLength) => {
      const { body, cancel, pull } = streamed([
        encoder.encode('123'), encoder.encode('456'), encoder.encode('never-read'),
      ]);
      await expect(readBoundedText(body, 5, { declaredLength })).rejects.toBeInstanceOf(BodyTooLargeError);
      expect(pull).toHaveBeenCalledTimes(2);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    },
  );

  it('rejects an oversized single chunk before reading the rest of the body', async () => {
    const { body, cancel, pull } = streamed([new Uint8Array(16_385), encoder.encode('unread')]);
    await expect(readBoundedText(body, PROJECT_S_PUBLIC_REQUEST_MAX_BYTES)).rejects.toMatchObject({
      name: 'BodyTooLargeError', maximumBytes: 16_384,
    });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it.each(['6', '00006', '999999999999999999999999999999999999999999'])(
    'rejects oversized declared length %s before pulling, but cancels the body', async (declaredLength) => {
      const { body, cancel, pull } = streamed([encoder.encode('12345')]);
      await expect(readBoundedText(body, 5, { declaredLength })).rejects.toBeInstanceOf(BodyTooLargeError);
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    },
  );

  it.each(['unknown', '-1', '1.5', '1, 9', 'Infinity'])(
    'ignores malformed declared length %s and continues to enforce actual bytes', async (declaredLength) => {
      const { body } = streamed([encoder.encode('12345')]);
      await expect(readBoundedText(body, 5, { declaredLength })).resolves.toBe('12345');
      expect(body.locked).toBe(false);
    },
  );

  it('decodes split UTF-8 code points and applies byte limits rather than character counts', async () => {
    const text = 'é🦊\n';
    const bytes = encoder.encode(text);
    expect(bytes.byteLength).toBe(7);
    const exact = streamed(chunksOf(bytes, 1));
    await expect(readBoundedText(exact.body, 7)).resolves.toBe(text);
    const tooSmall = streamed(chunksOf(bytes, 1));
    await expect(readBoundedText(tooSmall.body, 6)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(tooSmall.cancel).toHaveBeenCalledTimes(1);
    expect(tooSmall.body.locked).toBe(false);
  });

  it('supports empty/null bodies and a zero-byte limit without permitting a nonempty body', async () => {
    await expect(readBoundedText(null, 0)).resolves.toBe('');
    const empty = streamed([]);
    await expect(readBoundedText(empty.body, 0)).resolves.toBe('');
    expect(empty.body.locked).toBe(false);
    const nonempty = streamed([new Uint8Array(1)]);
    await expect(readBoundedText(nonempty.body, 0)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(nonempty.cancel).toHaveBeenCalledTimes(1);
    expect(nonempty.body.locked).toBe(false);
  });

  it('preserves standard text decoding for malformed UTF-8 and a leading BOM', async () => {
    const { body } = streamed([new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28])]);
    await expect(readBoundedText(body, 5)).resolves.toBe('�(');
  });

  it('cancels and releases without reading an already-aborted signal', async () => {
    const controller = new AbortController();
    const reason = new Error('stopped before read');
    controller.abort(reason);
    const { body, cancel, pull } = streamed([encoder.encode('unread')]);
    await expect(readBoundedText(body, 100, { signal: controller.signal })).rejects.toBe(reason);
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
  });

  it('interrupts a pending read on abort and releases even if source cancellation never settles', async () => {
    const controller = new AbortController();
    const reason = new Error('stop pending body');
    let markPending: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { markPending = resolve; });
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      pull() { markPending?.(); },
      cancel,
    }, { highWaterMark: 0 });
    const result = readBoundedText(body, 100, { signal: controller.signal });
    await pending;
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
  });

  it('removes abort listeners after every read instead of retaining them for every tiny chunk', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const { body } = streamed(chunksOf(encoder.encode('many tiny chunks'), 1));
    await expect(readBoundedText(body, 20, { signal: controller.signal })).resolves.toBe('many tiny chunks');
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
    expect(body.locked).toBe(false);
  });

  it('preserves a read failure, attempts cancellation and releases the reader lock', async () => {
    const reason = new Error('source read failed');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(reason); },
    }, { highWaterMark: 0 });
    const reader = body.getReader();
    const cancel = vi.spyOn(reader, 'cancel');
    vi.spyOn(body, 'getReader').mockReturnValue(reader);
    await expect(readBoundedText(body, 100)).rejects.toBe(reason);
    expect(cancel).toHaveBeenCalledWith(reason);
    expect(body.locked).toBe(false);
  });

  it('keeps the size failure when the source cancel hook rejects', async () => {
    const cancelError = new Error('cancel failed');
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(encoder.encode('too large')); },
      cancel() { return Promise.reject(cancelError); },
    }, { highWaterMark: 0 });
    await expect(readBoundedText(body, 1)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(body.locked).toBe(false);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid caller-provided limit %s', async (maximumBytes) => {
      await expect(readBoundedText(null, maximumBytes)).rejects.toBeInstanceOf(RangeError);
    },
  );
});

const meetingTypeId = '11111111-1111-4111-8111-111111111111';
const preparationId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const requestId = 'r'.repeat(128);
const startAt = '2026-11-04T14:00:00.123456+00:00';
const endAt = '2026-11-04T15:00:00.123456+00:00';
const username = 'a'.repeat(30);
const hostTimeZone = 'America/Argentina/ComodRivadavia';
const maximumUrl = 'https://example.com/' + 'a'.repeat(2_048 - 'https://example.com/'.length);
const escaped = (count: number) => '\u0001'.repeat(count);
const booker = {
  name: 'N'.repeat(120),
  email: `${'a'.repeat(64)}@${Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.')}`,
  notes: escaped(2_000),
};
const success = <T>(data: T) => ({ contractVersion: 1, requestId, data });
const maximumPublicFixtures = [
  ['booking page', getBookingPageResponseSchema, success({
    username,
    displayName: escaped(120),
    avatarUrl: maximumUrl,
    hostTimeZone,
    meetingTypes: Array.from({ length: 100 }, () => ({
      meetingTypeId,
      title: escaped(160),
      description: escaped(2_000),
      durationMinutes: 1_440,
      minNoticeMinutes: 525_600,
      maxAdvanceDays: 730,
    })),
  })],
  ['slots', listFreeSlotsResponseSchema, success({
    username,
    meetingTypeId,
    date: '2026-11-04',
    displayTimeZone: hostTimeZone,
    generatedAt: startAt,
    slots: Array.from({ length: 2_000 }, () => ({ startAt, endAt })),
  })],
  ['preparation', prepareBookingResponseSchema, success({
    preparationId,
    preparationToken: 'a'.repeat(4_096),
    expiresAt: startAt,
    notHeld: true,
    confirmationUrl: maximumUrl,
    summary: {
      username,
      hostDisplayName: escaped(120),
      meetingTypeId,
      meetingTypeTitle: escaped(160),
      startAt,
      endAt,
      hostTimeZone,
      guestTimeZone: hostTimeZone,
      booker,
    },
  })],
  ['booking', createBookingResponseSchema, success({
    confirmationCode: 'a'.repeat(128),
    status: 'confirmed',
    username,
    meetingTypeId,
    meetingTypeTitle: escaped(160),
    startAt,
    endAt,
    hostTimeZone,
    guestTimeZone: hostTimeZone,
    idempotencyKey,
  })],
  ['problem', projectSProblemEnvelopeSchema, {
    contractVersion: 1,
    requestId,
    error: {
      requestId,
      type: maximumUrl,
      title: escaped(200),
      detail: escaped(2_000),
      status: 599,
      code: 'PREPARATION_ALREADY_COMMITTED',
      alternatives: Array.from({ length: 3 }, () => ({ startAt, endAt })),
      fieldErrors: Array.from({ length: 32 }, () => ({
        code: 'A'.repeat(64), message: escaped(500), path: 'a'.repeat(256),
      })),
      retry: { action: 'choose_alternative', afterSeconds: 86_400 },
    },
  }],
] as const;

describe('schema-derived public response byte budget', () => {
  it('keeps the existing request byte cap and a finite response cap derived from the current schemas', () => {
    expect(PROJECT_S_PUBLIC_REQUEST_MAX_BYTES).toBe(16_384);
    expect(Number.isSafeInteger(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES)).toBe(true);
    expect(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES).toBeGreaterThan(1_000_000);
    expect(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES).toBeLessThan(2_000_000);
  });

  it.each(maximumPublicFixtures)('admits maximum-cardinality and maximally escaped canonical %s responses', async (_, schema, fixture) => {
    const normalized = schema.parse(fixture);
    const json = JSON.stringify(normalized);
    const bytes = encoder.encode(json);
    expect(bytes.byteLength).toBeLessThanOrEqual(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    const { body } = streamed(chunksOf(bytes, 4_093));
    await expect(readBoundedText(body, PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES)).resolves.toBe(json);
    expect(body.locked).toBe(false);
  });

  it('bounds extra JSON whitespace even when the unpadded DTO itself is valid', async () => {
    const small = JSON.stringify(maximumPublicFixtures[3][2]);
    const { body, cancel } = streamed([
      encoder.encode(small),
      new Uint8Array(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES).fill(32),
    ]);
    await expect(readBoundedText(body, PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});
