import { describe, expect, it, vi } from 'vitest';

import type {
  CreateBookingResponse,
  GetBookingPageResponse,
  ListFreeSlotsResponse,
  PrepareBookingResponse,
  ProjectSProblemEnvelope,
} from '@project-s/contracts';

import {
  ProjectSApiError,
  ProjectSProtocolError,
  ProjectSTransportError,
  createProjectSClient,
  parseProjectSProblem,
} from '../src/index.js';

const meetingTypeId = '11111111-1111-4111-8111-111111111111';
const preparationId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const preparationToken = 'token_abcdefghijklmnopqrstuvwxyz0123456789';
const requestId = 'req_12345678';

const pageResponse: GetBookingPageResponse = {
  contractVersion: 1,
  requestId,
  data: {
    username: 'demo-host',
    displayName: 'Demo Host',
    avatarUrl: null,
    hostTimeZone: 'America/Halifax',
    meetingTypes: [
      {
        meetingTypeId,
        title: 'Introduction',
        description: null,
        durationMinutes: 30,
        minNoticeMinutes: 60,
        maxAdvanceDays: 60,
      },
    ],
  },
};
const slotsResponse: ListFreeSlotsResponse = {
  contractVersion: 1,
  requestId,
  data: {
    username: 'demo-host',
    meetingTypeId,
    date: '2026-08-25',
    displayTimeZone: 'America/Halifax',
    generatedAt: '2026-08-19T12:00:00.000Z',
    slots: [
      {
        startAt: '2026-08-25T13:00:00.000Z',
        endAt: '2026-08-25T13:30:00.000Z',
      },
    ],
  },
};
const prepareResponse: PrepareBookingResponse = {
  contractVersion: 1,
  requestId,
  data: {
    preparationId,
    preparationToken,
    expiresAt: '2026-08-19T12:10:00.000Z',
    notHeld: true,
    confirmationUrl: `https://project-s.example/confirm#${preparationToken}`,
    summary: {
      username: 'demo-host',
      hostDisplayName: 'Demo Host',
      meetingTypeId,
      meetingTypeTitle: 'Introduction',
      startAt: '2026-08-25T13:00:00.000Z',
      endAt: '2026-08-25T13:30:00.000Z',
      hostTimeZone: 'America/Halifax',
      guestTimeZone: 'Asia/Tokyo',
      booker: {
        name: 'Example Guest',
        email: 'guest@example.com',
        notes: 'An introduction.',
      },
    },
  },
};
const createResponse: CreateBookingResponse = {
  contractVersion: 1,
  requestId,
  data: {
    confirmationCode: 'PROJECT-S-TEST',
    status: 'confirmed',
    username: 'demo-host',
    meetingTypeId,
    meetingTypeTitle: 'Introduction',
    startAt: '2026-08-25T13:00:00.000Z',
    endAt: '2026-08-25T13:30:00.000Z',
    hostTimeZone: 'America/Halifax',
    guestTimeZone: 'Asia/Tokyo',
    idempotencyKey,
  },
};

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
  });

const makeClient = (fetchImplementation: typeof fetch) =>
  createProjectSClient({
    baseUrl: 'https://project-s.example/',
    fetch: fetchImplementation,
    requestId: () => requestId,
  });

describe('ProjectSClient public parity surface', () => {
  it('requires a credential-free HTTPS base URL outside loopback development', () => {
    expect(() => createProjectSClient({ baseUrl: 'http://project-s.example' })).toThrow(
      /HTTPS/,
    );
    expect(() =>
      createProjectSClient({ baseUrl: 'https://user:secret@example.invalid' }),
    ).toThrow(/credentials/);
    expect(() => createProjectSClient({ baseUrl: 'http://127.0.0.1:54321' })).not.toThrow();
  });

  it('gets a booking page through the canonical path and preserves the envelope', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pageResponse));
    const client = makeClient(fetchMock as typeof fetch);

    await expect(client.public.getBookingPage({ username: 'demo-host' })).resolves.toEqual(pageResponse);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://project-s.example/api/v1/public/booking-pages/demo-host');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get('x-request-id')).toBeNull();
  });

  it('posts strict free-slot, prepare, and create inputs', async () => {
    const responses = [slotsResponse, prepareResponse, createResponse];
    const fetchMock = vi.fn(async () => jsonResponse(responses.shift()));
    const client = makeClient(fetchMock as typeof fetch);

    await expect(
      client.public.listFreeSlots({
        username: 'demo-host',
        meetingTypeId,
        date: '2026-08-25',
        displayTimeZone: 'America/Halifax',
      }),
    ).resolves.toEqual(slotsResponse);
    await expect(
      client.public.prepareBooking({
        username: 'demo-host',
        meetingTypeId,
        startAt: '2026-08-25T13:00:00.000Z',
        guestTimeZone: 'Asia/Tokyo',
        booker: {
          name: '  Example Guest  ',
          email: '  GUEST@example.com  ',
          notes: '  An introduction.  ',
        },
      }),
    ).resolves.toEqual(prepareResponse);
    await expect(
      client.public.createBooking({ preparationToken, idempotencyKey }),
    ).resolves.toEqual(createResponse);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => url)).toEqual([
      'https://project-s.example/api/v1/public/free-slots/search',
      'https://project-s.example/api/v1/public/bookings/prepare',
      'https://project-s.example/api/v1/public/bookings',
    ]);
    expect(JSON.parse(String(calls[1][1].body))).toMatchObject({
      booker: {
        name: 'Example Guest',
        email: 'guest@example.com',
        notes: 'An introduction.',
      },
    });
    expect(new Headers(calls[2][1].headers).get('content-type')).toBe(
      'application/vnd.project-s.v1+json',
    );
  });

  it('rejects unknown authority fields before making a request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(createResponse));
    const client = makeClient(fetchMock as typeof fetch);

    await expect(
      client.public.createBooking({
        preparationToken,
        idempotencyKey,
        confirmed: true,
      } as never),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe caller-supplied request identifiers before fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pageResponse));
    const client = createProjectSClient({
      baseUrl: 'https://project-s.example',
      fetch: fetchMock as typeof fetch,
      requestId: () => 'unsafe request\r\nheader',
    });
    await expect(
      client.public.getBookingPage({ username: 'demo-host' }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('canonical problem parsing', () => {
  const problemEnvelope: ProjectSProblemEnvelope = {
    contractVersion: 1,
    requestId,
    error: {
      type: 'https://project-s.example/problems/confirmation-required',
      title: 'Confirmation required',
      status: 428,
      code: 'CONFIRMATION_REQUIRED',
      detail: 'Review and confirm this booking in the browser before creating it.',
      requestId,
      retry: { action: 'confirm_in_browser' },
    },
  };

  it('throws ProjectSApiError with the canonical problem and status', async () => {
    const client = makeClient(
      vi.fn(async () => jsonResponse(problemEnvelope, 428)) as unknown as typeof fetch,
    );
    const caught = await client.public.createBooking({ preparationToken, idempotencyKey }).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ProjectSApiError);
    expect((caught as ProjectSApiError).problem.code).toBe('CONFIRMATION_REQUIRED');
    expect((caught as ProjectSApiError).responseStatus).toBe(428);
    expect(parseProjectSProblem(problemEnvelope)).toEqual(problemEnvelope.error);
  });

  it('does not leak or guess around invalid error and success bodies', async () => {
    const invalidErrorClient = makeClient(
      vi.fn(async () => jsonResponse({ error: 'database exploded' }, 500)) as unknown as typeof fetch,
    );
    await expect(
      invalidErrorClient.public.createBooking({ preparationToken, idempotencyKey }),
    ).rejects.toBeInstanceOf(ProjectSProtocolError);

    const invalidSuccessClient = makeClient(
      vi.fn(async () => jsonResponse({ confirmationCode: 'missing-envelope' })) as unknown as typeof fetch,
    );
    await expect(
      invalidSuccessClient.public.createBooking({ preparationToken, idempotencyKey }),
    ).rejects.toBeInstanceOf(ProjectSProtocolError);
  });

  it('distinguishes network failure from API and protocol failures', async () => {
    const client = makeClient(
      vi.fn(async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    );
    await expect(
      client.public.getBookingPage({ username: 'demo-host' }),
    ).rejects.toBeInstanceOf(ProjectSTransportError);
  });
});
