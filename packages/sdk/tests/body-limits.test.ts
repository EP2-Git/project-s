import { describe, expect, it, vi } from 'vitest';

import {
  PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES,
  type GetBookingPageResponse,
  type ListFreeSlotsResponse,
  type ProjectSProblem,
} from '@project-s/contracts';

import {
  ProjectSApiError,
  ProjectSProtocolError,
  ProjectSTransportError,
  createProjectSClient,
} from '../src/index.js';

const meetingTypeId = '11111111-1111-4111-8111-111111111111';
const requestId = 'req_response_limit';
const fallbackRequestId = 'req_local_fallback';
const encoder = new TextEncoder();
const page: GetBookingPageResponse = {
  contractVersion: 1,
  requestId,
  data: {
    username: 'demo-host',
    displayName: 'Demo Host',
    avatarUrl: null,
    hostTimeZone: 'UTC',
    meetingTypes: [{
      meetingTypeId,
      title: 'Introduction',
      description: null,
      durationMinutes: 30,
      minNoticeMinutes: 60,
      maxAdvanceDays: 60,
    }],
  },
};
const problem: ProjectSProblem = {
  type: 'https://project-s.example/problems/validation-error',
  title: 'Validation error',
  status: 400,
  code: 'VALIDATION_ERROR',
  detail: 'The supplied request is invalid.',
  requestId,
};

// Bounded, lazy fixture: even an oversized body is emitted in 512-byte chunks.
// Padding is legal JSON whitespace, so acceptance cannot fail merely on syntax.
const streamedResponse = (
  payload: unknown,
  options: {
    status?: number;
    declaredLength?: string;
    totalBytes?: number;
    chunkBytes?: number;
    onFirstChunk?: () => void;
    readFailure?: Error;
    serverRequestId?: string | null;
  } = {},
) => {
  const prefix = encoder.encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const totalBytes = options.totalBytes ?? prefix.byteLength;
  if (totalBytes < prefix.byteLength) throw new Error('The fixture must fit its JSON prefix.');
  let deliveredBytes = 0;
  let pulls = 0;
  const cancelReasons: unknown[] = [];
  const readerCancelReasons: unknown[] = [];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (options.readFailure && pulls > 1) {
        controller.error(options.readFailure);
        return;
      }
      if (deliveredBytes === totalBytes) {
        controller.close();
        return;
      }
      const length = Math.min(options.chunkBytes ?? 512, totalBytes - deliveredBytes);
      const chunk = new Uint8Array(length).fill(32);
      if (deliveredBytes < prefix.byteLength) {
        chunk.set(prefix.subarray(deliveredBytes, Math.min(prefix.byteLength, deliveredBytes + length)));
      }
      deliveredBytes += length;
      controller.enqueue(chunk);
      if (pulls === 1) options.onFirstChunk?.();
    },
    cancel(reason) {
      cancelReasons.push(reason);
    },
  }, { highWaterMark: 0 });
  const getReader = stream.getReader.bind(stream);
  Object.defineProperty(stream, 'getReader', {
    value: () => {
      const reader = getReader();
      const cancel = reader.cancel.bind(reader);
      reader.cancel = (reason?: unknown) => {
        readerCancelReasons.push(reason);
        return cancel(reason);
      };
      return reader;
    },
  });
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.serverRequestId !== null) {
    headers.set('x-request-id', options.serverRequestId ?? requestId);
  }
  if (options.declaredLength !== undefined) headers.set('content-length', options.declaredLength);
  const response = new Response(stream, { status: options.status ?? 200, headers });
  const text = vi.spyOn(response, 'text');
  const json = vi.spyOn(response, 'json');
  return {
    response,
    stream,
    text,
    json,
    cancelReasons,
    readerCancelReasons,
    get deliveredBytes() { return deliveredBytes; },
    get pulls() { return pulls; },
  };
};

const clientFor = (response: Response) => createProjectSClient({
  baseUrl: 'https://project-s.example',
  fetch: vi.fn(async () => response) as typeof fetch,
  requestId: () => fallbackRequestId,
});
const requestPage = (response: Response, signal?: AbortSignal) =>
  clientFor(response).public.getBookingPage({ username: 'demo-host' }, { signal });
const catchRequest = (response: Response, signal?: AbortSignal): Promise<unknown> =>
  requestPage(response, signal).catch((error: unknown) => error);
const payloadFor = (status: number) => status === 200 ? page : problem;

describe('SDK bounded response consumption', () => {
  it.each([200, 400])('streams a normal %i response without full-body convenience methods', async (status) => {
    const probe = streamedResponse(payloadFor(status), { status, chunkBytes: 7 });
    const result = await catchRequest(probe.response);
    if (status === 200) expect(result).toEqual(page);
    else {
      expect(result).toBeInstanceOf(ProjectSApiError);
      expect((result as ProjectSApiError).problem).toEqual(problem);
      expect((result as ProjectSApiError).responseStatus).toBe(status);
    }
    expect(probe.text).not.toHaveBeenCalled();
    expect(probe.json).not.toHaveBeenCalled();
    expect(probe.stream.locked).toBe(false);
  });

  it.each([200, 400])('accepts a valid %i JSON body exactly at the byte limit', async (status) => {
    const probe = streamedResponse(payloadFor(status), { status, totalBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES });
    const result = await catchRequest(probe.response);
    if (status === 200) expect(result).toEqual(page);
    else expect(result).toBeInstanceOf(ProjectSApiError);
    expect(probe.deliveredBytes).toBe(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    expect(probe.cancelReasons).toHaveLength(0);
    expect(probe.text).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, declaredLength: undefined },
    { status: 400, declaredLength: undefined },
    { status: 200, declaredLength: '1' },
    { status: 400, declaredLength: '1' },
  ])('caps actual streamed bytes for status $status / declared $declaredLength', async ({ status, declaredLength }) => {
    const probe = streamedResponse(payloadFor(status), {
      status,
      declaredLength,
      totalBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 4_096,
    });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSProtocolError);
    expect(result).toMatchObject({ responseStatus: status, requestId });
    expect((result as ProjectSProtocolError).payload).toBeUndefined();
    expect(probe.deliveredBytes).toBeGreaterThan(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    expect(probe.deliveredBytes).toBeLessThanOrEqual(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 512);
    expect(probe.cancelReasons).toHaveLength(1);
    expect(probe.stream.locked).toBe(false);
    expect(probe.text).not.toHaveBeenCalled();
  });

  it.each([200, 400])('rejects one byte over the limit for status %i', async (status) => {
    const probe = streamedResponse(payloadFor(status), {
      status,
      totalBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 1,
      serverRequestId: null,
    });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSProtocolError);
    expect(result).toMatchObject({ responseStatus: status, requestId: fallbackRequestId });
    expect((result as ProjectSProtocolError).payload).toBeUndefined();
    expect(probe.cancelReasons).toHaveLength(1);
    expect(probe.stream.locked).toBe(false);
  });

  it.each([200, 400])('refuses an excessive declared length before reading status %i', async (status) => {
    const probe = streamedResponse(payloadFor(status), {
      status,
      declaredLength: String(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 1),
    });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSProtocolError);
    expect(probe.deliveredBytes).toBe(0);
    expect(probe.cancelReasons).toHaveLength(1);
    expect(probe.stream.locked).toBe(false);
    expect(probe.text).not.toHaveBeenCalled();
  });

  it('decodes UTF-8 code points split across chunks without replacement characters', async () => {
    const payload = { ...page, data: { ...page.data, displayName: 'Café 🧭' } };
    const probe = streamedResponse(payload, { chunkBytes: 1 });
    await expect(requestPage(probe.response)).resolves.toEqual(payload);
    expect(probe.text).not.toHaveBeenCalled();
    expect(probe.stream.locked).toBe(false);
  });

  it.each([200, 400])('maps a body read failure to transport failure and cancels status %i', async (status) => {
    const cause = new Error('synthetic body read failure');
    const probe = streamedResponse(payloadFor(status), { status, chunkBytes: 7, readFailure: cause });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSTransportError);
    expect((result as ProjectSTransportError).cause).toBe(cause);
    expect(probe.readerCancelReasons).toEqual([cause]);
    expect(probe.stream.locked).toBe(false);
  });

  it.each([200, 400])('honors abort while consuming status %i even when a custom fetch ignores it', async (status) => {
    const controller = new AbortController();
    const cause = new Error('synthetic caller abort');
    const probe = streamedResponse(payloadFor(status), {
      status,
      chunkBytes: 7,
      onFirstChunk: () => controller.abort(cause),
    });
    const result = await catchRequest(probe.response, controller.signal);
    expect(result).toBeInstanceOf(ProjectSTransportError);
    expect((result as ProjectSTransportError).cause).toBe(cause);
    expect(probe.cancelReasons).toEqual([cause]);
    expect(probe.stream.locked).toBe(false);
  });

  it('treats a null response body as empty without falling back to text/json', async () => {
    const response = new Response(null, { status: 200 });
    const text = vi.spyOn(response, 'text');
    const json = vi.spyOn(response, 'json');
    expect(await catchRequest(response)).toBeInstanceOf(ProjectSProtocolError);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('does not use a full-body fallback for an incomplete mocked fetch response', async () => {
    const text = vi.fn(async () => JSON.stringify(page));
    const json = vi.fn(async () => page);
    const response = { ok: true, status: 200, headers: new Headers(), text, json } as unknown as Response;
    expect(await catchRequest(response)).toBeInstanceOf(Error);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('retains non-JSON protocol status and header-only correlation behavior', async () => {
    const probe = streamedResponse('not JSON', { status: 502, serverRequestId: null });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSProtocolError);
    expect(result).toMatchObject({ responseStatus: 502, requestId: null });
    expect((result as Error).message).toMatch(/non-JSON/);
  });
});

describe('SDK legitimate maximum containers and strict rejection', () => {
  it('accepts 100 meeting types with maximum-length escaped descriptions', async () => {
    const payload: GetBookingPageResponse = {
      ...page,
      data: {
        ...page.data,
        meetingTypes: Array.from({ length: 100 }, () => ({
          ...page.data.meetingTypes[0],
          title: '"'.repeat(160),
          description: '\u0000'.repeat(2_000),
        })),
      },
    };
    const probe = streamedResponse(payload);
    await expect(requestPage(probe.response)).resolves.toEqual(payload);
    expect(probe.deliveredBytes).toBeLessThanOrEqual(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    expect(probe.text).not.toHaveBeenCalled();
  });

  it('accepts the existing maximum of 2,000 slots', async () => {
    const payload: ListFreeSlotsResponse = {
      contractVersion: 1,
      requestId,
      data: {
        username: 'demo-host',
        meetingTypeId,
        date: '2026-10-24',
        displayTimeZone: 'UTC',
        generatedAt: '2026-10-24T00:00:00.000Z',
        slots: Array.from({ length: 2_000 }, () => ({
          startAt: '2026-10-24T13:00:00.000Z',
          endAt: '2026-10-24T13:30:00.000Z',
        })),
      },
    };
    const probe = streamedResponse(payload);
    await expect(clientFor(probe.response).public.listFreeSlots({
      username: 'demo-host', meetingTypeId, date: '2026-10-24', displayTimeZone: 'UTC',
    })).resolves.toEqual(payload);
    expect(probe.text).not.toHaveBeenCalled();
  });

  it('preserves a canonical problem containing 32 maximum-length field errors', async () => {
    const payload: ProjectSProblem = {
      ...problem,
      fieldErrors: Array.from({ length: 32 }, () => ({
        path: 'a'.repeat(256),
        code: 'A'.repeat(64),
        message: '\u0000'.repeat(500),
      })),
    };
    const probe = streamedResponse(payload, { status: 400 });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSApiError);
    expect((result as ProjectSApiError).problem).toEqual(payload);
    expect(probe.text).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, payload: { ...page, data: { ...page.data, meetingTypes: Array.from({ length: 101 }, () => [page.data.meetingTypes[0]]) } } },
    { status: 400, payload: { ...problem, fieldErrors: Array.from({ length: 33 }, () => [{ path: 'booker.name', message: 'Invalid.' }]) } },
  ])('rejects nested oversized containers in status $status', async ({ status, payload }) => {
    const probe = streamedResponse(payload, { status });
    const result = await catchRequest(probe.response);
    expect(result).toBeInstanceOf(ProjectSProtocolError);
    expect(result).toMatchObject({ responseStatus: status, requestId });
    expect(probe.text).not.toHaveBeenCalled();
  });
});
