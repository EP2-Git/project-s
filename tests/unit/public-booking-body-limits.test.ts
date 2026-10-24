import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES,
  prepareBookingResponseSchema,
  type ProjectSProblem,
} from '@project-s/contracts';
import { ProjectSApiError, ProjectSProtocolError, ProjectSTransportError } from '@project-s/sdk';
import {
  PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE,
  PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE,
  messageForPublicBookingProblem,
} from '../../src/lib/publicBookingErrorMessage';
import {
  PublicBookingError,
  publicBookingService,
  type ConfirmationResult,
  type PreparationPreview,
} from '../../src/services/publicBookingService';

const preparationToken = 'prep_abcdefghijklmnopqrstuvwxyz0123456789';
const preparationId = '11111111-1111-4111-8111-111111111111';
const requestId = 'synthetic-body-limit';
const preview: PreparationPreview = {
  preparationId,
  expiresAt: '2026-10-24T12:10:00.000Z',
  notHeld: true,
  summary: {
    username: 'demo-host',
    hostDisplayName: 'Demo Host',
    meetingTypeId: '22222222-2222-4222-8222-222222222222',
    meetingTypeTitle: 'Introduction',
    startAt: '2026-10-24T13:00:00.000Z',
    endAt: '2026-10-24T13:30:00.000Z',
    hostTimeZone: 'UTC',
    guestTimeZone: 'UTC',
    booker: { name: 'Example Guest', email: 'guest@example.com', notes: 'An introduction.' },
  },
};
const confirmation: ConfirmationResult = {
  preparationId,
  grantId: '33333333-3333-4333-8333-333333333333',
  confirmedAt: '2026-10-24T12:00:00.000Z',
  method: 'human_browser',
};
const rateProblem: ProjectSProblem = {
  type: 'https://project-s.example/problems/rate-limited',
  title: 'Rate limited',
  status: 429,
  code: 'RATE_LIMITED',
  detail: 'private upstream diagnostic',
  requestId,
  retry: { action: 'retry_after', afterSeconds: 7 },
};
const envelope = (data: unknown, id = requestId) => ({ contractVersion: 1, requestId: id, data });
type Route = 'preview' | 'confirm';
const routes = ['preview', 'confirm'] as const;
const dataFor = (route: Route) => route === 'preview' ? preview : confirmation;
const payloadFor = (route: Route, status: number) => status === 200
  ? envelope(dataFor(route))
  : route === 'preview' ? rateProblem : { contractVersion: 1, requestId, error: rateProblem };

// Fixed-size lazy chunks keep adverse fixtures finite without constructing a
// giant JSON object. Legal trailing whitespace isolates transport enforcement.
const probeResponse = (payload: unknown, options: {
  status?: number;
  totalBytes?: number;
  declaredLength?: string;
  chunkBytes?: number;
  readFailure?: Error;
} = {}) => {
  const prefix = new TextEncoder().encode(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const totalBytes = options.totalBytes ?? prefix.byteLength;
  if (totalBytes < prefix.byteLength) throw new Error('Fixture prefix exceeds its size.');
  let deliveredBytes = 0;
  let pulls = 0;
  const cancelled: unknown[] = [];
  const readerCancelled: unknown[] = [];
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
    },
    cancel(reason) { cancelled.push(reason); },
  }, { highWaterMark: 0 });
  const getReader = stream.getReader.bind(stream);
  Object.defineProperty(stream, 'getReader', {
    value: () => {
      const reader = getReader();
      const cancel = reader.cancel.bind(reader);
      reader.cancel = (reason?: unknown) => {
        readerCancelled.push(reason);
        return cancel(reason);
      };
      return reader;
    },
  });
  const headers = new Headers({ 'content-type': 'application/json', 'x-request-id': requestId });
  if (options.declaredLength !== undefined) headers.set('content-length', options.declaredLength);
  const response = new Response(stream, { status: options.status ?? 200, headers });
  const text = vi.spyOn(response, 'text');
  const json = vi.spyOn(response, 'json');
  return {
    response, stream, text, json, cancelled, readerCancelled,
    get deliveredBytes() { return deliveredBytes; },
  };
};
const invoke = (route: Route, response: Response) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  return route === 'preview'
    ? publicBookingService.getPreparation(preparationToken)
    : publicBookingService.confirmPreparation({ preparationToken, challengeToken: 'synthetic-challenge' });
};
const resultOf = async (route: Route, response: Response): Promise<unknown> => {
  try { return await invoke(route, response); } catch (error) { return error; }
};
const assertProtocolFailure = (value: unknown, status: number) => {
  expect(value).toBeInstanceOf(PublicBookingError);
  expect(value).toMatchObject({ code: 'INTERNAL_ERROR', message: PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE });
  const cause = (value as PublicBookingError).cause;
  expect(cause).toBeInstanceOf(ProjectSProtocolError);
  expect(cause).toMatchObject({ responseStatus: status, requestId });
  expect((cause as ProjectSProtocolError).payload).toBeUndefined();
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(routes)('bounded browser support %s', (route) => {
  it('reads the streamed success and preserves the approval request', async () => {
    const probe = probeResponse(envelope(dataFor(route)), { chunkBytes: 7 });
    await expect(invoke(route, probe.response)).resolves.toEqual(dataFor(route));
    const fetchMock = vi.mocked(fetch);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(new RegExp(`/api/v1/public/booking-preparations/${route}$`));
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(JSON.parse(String(init?.body))).toEqual(route === 'preview'
      ? { preparationToken }
      : { preparationToken, challengeToken: 'synthetic-challenge' });
    expect(probe.json).not.toHaveBeenCalled();
    expect(probe.text).not.toHaveBeenCalled();
    expect(probe.stream.locked).toBe(false);
  });

  it('preserves canonical problem and retry information without displaying diagnostics', async () => {
    const probe = probeResponse(payloadFor(route, 429), { status: 429, chunkBytes: 7 });
    const result = await resultOf(route, probe.response);
    expect(result).toMatchObject({
      code: 'RATE_LIMITED', retryAfterSeconds: 7,
      message: messageForPublicBookingProblem('RATE_LIMITED'),
    });
    const cause = (result as PublicBookingError).cause;
    expect(cause).toBeInstanceOf(ProjectSApiError);
    expect((cause as ProjectSApiError).problem).toEqual(rateProblem);
    expect((result as Error).message).not.toContain(rateProblem.detail);
    expect(probe.json).not.toHaveBeenCalled();
    expect(probe.text).not.toHaveBeenCalled();
  });

  it.each([200, 429])('accepts a valid status %i body exactly at the byte limit', async (status) => {
    const probe = probeResponse(payloadFor(route, status), { status, totalBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES });
    const result = await resultOf(route, probe.response);
    if (status === 200) expect(result).toEqual(dataFor(route));
    else expect(result).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 7 });
    expect(probe.deliveredBytes).toBe(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    expect(probe.cancelled).toHaveLength(0);
    expect(probe.json).not.toHaveBeenCalled();
    expect(probe.text).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, declaredLength: undefined }, { status: 429, declaredLength: undefined },
    { status: 200, declaredLength: '1' }, { status: 429, declaredLength: '1' },
  ])('enforces actual bytes for status $status with declared length $declaredLength', async ({ status, declaredLength }) => {
    const probe = probeResponse(payloadFor(route, status), {
      status, declaredLength, totalBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 4_096,
    });
    assertProtocolFailure(await resultOf(route, probe.response), status);
    expect(probe.deliveredBytes).toBeGreaterThan(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    expect(probe.deliveredBytes).toBeLessThanOrEqual(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 512);
    expect(probe.cancelled).toHaveLength(1);
    expect(probe.stream.locked).toBe(false);
    expect(probe.json).not.toHaveBeenCalled();
    expect(probe.text).not.toHaveBeenCalled();
  });

  it.each([200, 429])('rejects status %i one byte over the budget', async (status) => {
    const probe = probeResponse(payloadFor(route, status), { status, totalBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 1 });
    assertProtocolFailure(await resultOf(route, probe.response), status);
    expect(probe.cancelled).toHaveLength(1);
    expect(probe.stream.locked).toBe(false);
  });

  it.each([200, 429])('refuses a false-high length before reading status %i', async (status) => {
    const probe = probeResponse(payloadFor(route, status), {
      status, declaredLength: String(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 1),
    });
    assertProtocolFailure(await resultOf(route, probe.response), status);
    expect(probe.deliveredBytes).toBe(0);
    expect(probe.cancelled).toHaveLength(1);
    expect(probe.stream.locked).toBe(false);
  });

  it.each([200, 429])('maps status %i read failure safely and cancels the reader', async (status) => {
    const diagnostic = new Error('private upstream diagnostic');
    const probe = probeResponse(payloadFor(route, status), { status, chunkBytes: 7, readFailure: diagnostic });
    const result = await resultOf(route, probe.response);
    expect(result).toMatchObject({ code: 'INTERNAL_ERROR', message: PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE });
    expect((result as Error).message).not.toContain(diagnostic.message);
    const cause = (result as PublicBookingError).cause;
    expect(cause).toBeInstanceOf(ProjectSTransportError);
    expect((cause as ProjectSTransportError).cause).toBe(diagnostic);
    expect(probe.readerCancelled).toEqual([diagnostic]);
    expect(probe.stream.locked).toBe(false);
  });

  it('handles a null body without convenience-method fallback', async () => {
    const response = new Response(null, { status: 200 });
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const result = await resultOf(route, response);
    expect(result).toMatchObject({ code: 'INTERNAL_ERROR', message: PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE });
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it('does not revive full-body methods on a mock lacking a body', async () => {
    const json = vi.fn(async () => envelope(dataFor(route)));
    const text = vi.fn(async () => JSON.stringify(envelope(dataFor(route))));
    const response = { status: 200, ok: true, headers: new Headers(), json, text } as unknown as Response;
    expect(await resultOf(route, response)).toBeInstanceOf(PublicBookingError);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it.each([200, 503])('keeps non-JSON status %i diagnostics out of public messages', async (status) => {
    const probe = probeResponse('private upstream diagnostic', { status });
    const result = await resultOf(route, probe.response);
    expect(result).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: status === 200 ? PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE : messageForPublicBookingProblem('INTERNAL_ERROR'),
    });
    expect((result as Error).message).not.toContain('private upstream diagnostic');
    expect(probe.json).not.toHaveBeenCalled();
  });

  it('rejects extra authority fields at both envelope and data levels', async () => {
    for (const payload of [
      { ...envelope(dataFor(route)), approved: true },
      envelope({ ...dataFor(route), approved: true }),
    ]) {
      const probe = probeResponse(payload);
      const result = await resultOf(route, probe.response);
      expect(result).toMatchObject({ code: 'INTERNAL_ERROR', message: PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE });
      expect(probe.json).not.toHaveBeenCalled();
    }
  });
});

describe('browser support DTO bounds and normalization', () => {
  it('preserves split UTF-8 and reviewed booker normalization', async () => {
    const payload = {
      ...preview,
      summary: {
        ...preview.summary,
        hostDisplayName: 'Café 🧭',
        booker: { name: '  Example Guest  ', email: '  GUEST@example.com  ', notes: '  Intro 🧭  ' },
      },
    };
    const probe = probeResponse(envelope(payload), { chunkBytes: 1 });
    await expect(invoke('preview', probe.response)).resolves.toEqual({
      ...payload,
      summary: { ...payload.summary, booker: { name: 'Example Guest', email: 'guest@example.com', notes: 'Intro 🧭' } },
    });
    expect(probe.json).not.toHaveBeenCalled();
  });

  it('fits maximum preview fields inside the already-budgeted prepare response', async () => {
    const maximumPreview: PreparationPreview = {
      ...preview,
      expiresAt: '2026-10-24T12:10:00.123456+00:00',
      summary: {
        ...preview.summary,
        username: 'a'.repeat(30),
        hostDisplayName: '\u0000'.repeat(120),
        meetingTypeTitle: '\u0000'.repeat(160),
        startAt: '2026-10-24T13:00:00.123456+00:00',
        endAt: '2026-10-24T13:30:00.123456+00:00',
        booker: {
          name: '"'.repeat(120),
          email: `${'a'.repeat(64)}@${Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.')}`,
          notes: '\u0000'.repeat(2_000),
        },
      },
    };
    const payload = envelope(maximumPreview, 'r'.repeat(128));
    const confirmationPrefix = 'https://project-s.example/confirm#';
    const preparePayload = {
      ...payload,
      data: {
        ...maximumPreview,
        preparationToken: 'p'.repeat(4_096),
        confirmationUrl: confirmationPrefix + 'p'.repeat(2_048 - confirmationPrefix.length),
      },
    };
    expect(prepareBookingResponseSchema.safeParse(preparePayload).success).toBe(true);
    const encoder = new TextEncoder();
    const previewBytes = encoder.encode(JSON.stringify(payload)).byteLength;
    const prepareBytes = encoder.encode(JSON.stringify(preparePayload)).byteLength;
    expect(previewBytes).toBeLessThan(prepareBytes);
    expect(prepareBytes).toBeLessThanOrEqual(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    const probe = probeResponse(payload);
    await expect(invoke('preview', probe.response)).resolves.toEqual(maximumPreview);
    expect(probe.json).not.toHaveBeenCalled();
  });

  it('fits the fixed confirmation envelope at its longest allowed fields', async () => {
    const data: ConfirmationResult = {
      ...confirmation,
      method: 'verified_challenge',
      confirmedAt: '2026-10-24T12:00:00.123456+00:00',
    };
    const payload = envelope(data, 'r'.repeat(128));
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
    const probe = probeResponse(payload);
    await expect(invoke('confirm', probe.response)).resolves.toEqual(data);
    expect(probe.json).not.toHaveBeenCalled();
  });

  it('keeps nested unknown booker fields strictly rejected', async () => {
    const probe = probeResponse(envelope({
      ...preview,
      summary: { ...preview.summary, booker: { ...preview.summary.booker, approved: true } },
    }));
    expect(await resultOf('preview', probe.response)).toMatchObject({
      code: 'INTERNAL_ERROR', message: PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE,
    });
  });
});
