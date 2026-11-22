import { describe, expect, it, vi } from 'vitest';
import {
  createStepUpReviewClient,
  STEP_UP_REVIEW_RESPONSE_MAX_BYTES,
  STEP_UP_REVIEW_TIMEOUT_MS,
  StepUpReviewClientError,
} from '@/services/stepUpReviewClient';
import type { V2StepUpApproveInput, V2StepUpRevokeInput } from '@project-s/contracts/v2';

const origin = 'https://approval.example.invalid';
const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const requestId = 'synthetic-http-response';
const accessToken = 'synthetic-account-bearer';
const approval = { expectedRevision: 1, summaryDigest: 'a'.repeat(64) };
const review = {
  reviewId, revision: 1, state: 'pending', summaryDigest: approval.summaryDigest,
  expiresAt: '2030-04-01T13:05:00.000000Z',
  exactSummary: {
    username: 'synthetic-host', hostDisplayName: 'Synthetic Host',
    meetingTypeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', meetingTypeTitle: 'Planning session',
    startAt: '2030-04-02T13:00:00.000000Z', endAt: '2030-04-02T13:30:00.000000Z',
    hostTimeZone: 'America/Halifax', guestTimeZone: 'UTC',
    name: 'Synthetic Guest', email: 'guest@example.invalid',
  },
  differences: [{ field: 'duration', proposed: '30', reviewed: '15' }],
};
const approved = { reviewId, state: 'approved', preparationId: otherId,
  expiresAt: '2030-04-01T13:05:00.000000Z' };
const declined = { reviewId, state: 'revoked', revision: 2,
  revokedAt: '2030-04-01T13:00:00.000000Z' };
const envelope = (data: unknown) => ({ contractVersion: 2, requestId, data });
const success = (data: unknown, options: ResponseInit = {}) => new Response(JSON.stringify(envelope(data)), {
  status: 200, headers: { 'content-type': 'application/vnd.project-s.v2+json' }, ...options,
});
const refusal = (code: string, status: number, overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  contractVersion: 2, requestId,
  error: { code, status, requestId, title: 'Private upstream title',
    detail: 'Do not reflect guest@example.invalid or synthetic-account-bearer',
    type: 'https://project-s.local/problems/refusal',
    ...(code === 'AUTHORITY_BUSY' ? { retry: { action: 'retry_after', afterSeconds: 1 } } : {}), ...overrides },
}), { status, headers: { 'content-type': 'application/problem+json' } });
const fixture = (response: Response | (() => Response | Promise<Response>)) => {
  const fetch = vi.fn(async () => typeof response === 'function' ? response() : response);
  return { fetch, client: createStepUpReviewClient({ baseUrl: origin, accessToken, fetch }) };
};
const rejectedKind = async (promise: Promise<unknown>, kind: string) => {
  const error = await promise.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(StepUpReviewClientError);
  expect(error).toMatchObject({ kind });
  expect((error as Error).message).not.toMatch(/guest@example|synthetic-account-bearer|upstream/);
};

describe('unwired principal step-up client', () => {
  it('uses only an explicit account bearer and private fetch policies', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => success(review));
    const client = createStepUpReviewClient({ baseUrl: origin, accessToken, fetch: send });
    const controller = new AbortController();
    expect(await client.getReview(reviewId.toUpperCase(), controller.signal)).toEqual(review);
    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0];
    expect(url).toBe(`${origin}/api/v2/authority/step-ups/${reviewId}`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', cache: 'no-store',
      redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { authorization: `Bearer ${accessToken}` } });
    expect(init?.signal?.aborted).toBe(false);
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty('apikey');
    expect(JSON.stringify(init?.headers)).not.toMatch(/principal|confirmed|context/);
  });

  it('submits exact approval and pending decline without a GET preflight or automatic retry', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(success(approved)).mockResolvedValueOnce(success(approved))
      .mockResolvedValueOnce(success(declined));
    const client = createStepUpReviewClient({ baseUrl: `${origin}/`, accessToken, fetch: send });
    expect(await client.approve(reviewId, approval)).toEqual(approved);
    expect(await client.approve(reviewId, approval)).toEqual(approved);
    expect(await client.decline(reviewId, { expectedRevision: 1 })).toEqual(declined);
    expect(send.mock.calls.map(([url]) => url)).toEqual([
      `${origin}/api/v2/authority/step-ups/${reviewId}/approve`,
      `${origin}/api/v2/authority/step-ups/${reviewId}/approve`,
      `${origin}/api/v2/authority/step-ups/${reviewId}/revoke`,
    ]);
    expect(send.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      approval, approval, { expectedRevision: 1 },
    ]);
    expect(send.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
  });

  it('rejects unsafe configuration, extra authority fields and invalid references before fetch', async () => {
    for (const baseUrl of ['http://remote.invalid', `${origin}/api/v2`, `${origin}?`, `${origin}#fragment`,
      'https://user:password@example.invalid']) {
      expect(() => createStepUpReviewClient({ baseUrl, accessToken })).toThrow(StepUpReviewClientError);
    }
    expect(() => createStepUpReviewClient({ baseUrl: origin, accessToken: '' })).toThrow(StepUpReviewClientError);
    const { client, fetch } = fixture(success(review));
    await rejectedKind(client.getReview(`${reviewId}?principalId=${otherId}`), 'unavailable');
    await rejectedKind(client.approve(reviewId, { ...approval, confirmed: true } as V2StepUpApproveInput), 'unavailable');
    await rejectedKind(client.decline(reviewId, { expectedRevision: 1, principalId: otherId } as V2StepUpRevokeInput), 'unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('supports the explicit loopback origin without any environment singleton', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(success(review));
    const client = createStepUpReviewClient({ baseUrl: 'http://127.0.0.1:4173', accessToken, fetch: send });
    await client.getReview(reviewId);
    expect(send.mock.calls[0][0]).toBe(`http://127.0.0.1:4173/api/v2/authority/step-ups/${reviewId}`);
  });

  it('binds strict success acknowledgements to the request and exact decline revision', async () => {
    for (const data of [{ ...review, reviewId: otherId }, { ...review, state: 'approved' },
      { ...review, requesterLabel: 'unreviewed disclosure' }, { ...review, summaryDigest: 'invalid' }]) {
      await rejectedKind(fixture(success(data)).client.getReview(reviewId), 'uncertain');
    }
    for (const data of [{ ...approved, reviewId: otherId }, { ...approved, privateCredential: 'secret' }]) {
      await rejectedKind(fixture(success(data)).client.approve(reviewId, approval), 'uncertain');
    }
    for (const data of [{ ...declined, reviewId: otherId }, { ...declined, revision: 3 }]) {
      await rejectedKind(fixture(success(data)).client.decline(reviewId, { expectedRevision: 1 }), 'uncertain');
    }
  });

  it('treats malformed media, status, envelopes and diagnostic failures as uncertain', async () => {
    for (const response of [success(review, { headers: { 'content-type': 'application/json' } }),
      success(review, { status: 201 }),
      new Response('private upstream diagnostic', { status: 500 }),
      new Response(JSON.stringify({ ...envelope(review), contractVersion: 1 }),
        { headers: { 'content-type': 'application/vnd.project-s.v2+json' } }),
      refusal('INTERNAL_ERROR', 500),
      refusal('FORBIDDEN', 403, { status: 409 }),
      refusal('VERSION_CONFLICT', 409, { requestId: 'different-correlation' }),
      refusal('VERSION_CONFLICT', 500),
      refusal('VALIDATION_ERROR', 500),
      refusal('OUTSIDE_BOOKING_WINDOW', 500),
    ]) {
      const { client, fetch } = fixture(response);
      await rejectedKind(client.approve(reviewId, approval), 'uncertain');
      expect(fetch).toHaveBeenCalledOnce();
    }
    const { client, fetch } = fixture(async () => { throw new Error('private upstream guest@example.invalid'); });
    await rejectedKind(client.approve(reviewId, approval), 'uncertain');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['AUTHENTICATION_REQUIRED', 401, 'authentication'], ['FORBIDDEN', 403, 'unavailable'],
    ['NOT_FOUND', 404, 'unavailable'], ['VERSION_CONFLICT', 409, 'unavailable'],
    ['VALIDATION_ERROR', 400, 'unavailable'], ['SLOT_UNAVAILABLE', 409, 'slot_unavailable'],
    ['OUTSIDE_BOOKING_WINDOW', 409, 'outside_booking_window'], ['AUTHORITY_BUSY', 503, 'busy'],
  ])('maps only %s to fixed local recovery copy', async (code, status, kind) => {
    const { client, fetch } = fixture(refusal(String(code), Number(status)));
    await rejectedKind(client.approve(reviewId, approval), String(kind));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('cancels an unexpected redirect/foreign URL before reading private data', async () => {
    for (const property of [{ redirected: true }, { url: 'https://foreign.example.invalid/redirect' }]) {
      let cancelled = false;
      let pulls = 0;
      const body = new ReadableStream({ pull() { pulls++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
      const response = new Response(body, { headers: { 'content-type': 'application/vnd.project-s.v2+json' } });
      for (const [name, value] of Object.entries(property)) Object.defineProperty(response, name, { value });
      await rejectedKind(fixture(response).client.approve(reviewId, approval), 'uncertain');
      expect(pulls).toBe(0);
      expect(cancelled).toBe(true);
    }
  });

  it('bounds streamed success and error bodies even without a trustworthy length', async () => {
    for (const status of [200, 500]) {
      for (const length of [null, '1', 'invalid']) {
        let pulled = 0;
        let cancelled = false;
        const body = new ReadableStream({
          pull(controller) { pulled++; controller.enqueue(new Uint8Array(1_024).fill(32)); },
          cancel() { cancelled = true; },
        }, { highWaterMark: 0 });
        const headers = new Headers({ 'content-type': status === 200 ? 'application/vnd.project-s.v2+json' : 'application/problem+json' });
        if (length) headers.set('content-length', length);
        await rejectedKind(fixture(new Response(body, { status, headers })).client.getReview(reviewId), 'uncertain');
        expect(pulled).toBe(Math.floor(STEP_UP_REVIEW_RESPONSE_MAX_BYTES / 1_024) + 1);
        expect(cancelled).toBe(true);
        expect(body.locked).toBe(false);
      }
    }
  });

  it('rejects declared oversize before a body read and accepts an exact-limit response', async () => {
    let cancelled = false;
    let pulled = false;
    const body = new ReadableStream({ pull() { pulled = true; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    await rejectedKind(fixture(new Response(body, { headers: {
      'content-length': String(STEP_UP_REVIEW_RESPONSE_MAX_BYTES + 1),
    } })).client.getReview(reviewId), 'uncertain');
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
    const json = JSON.stringify(envelope(review));
    const padded = json + ' '.repeat(STEP_UP_REVIEW_RESPONSE_MAX_BYTES - new TextEncoder().encode(json).length);
    const response = new Response(padded, { headers: { 'content-type': 'application/vnd.project-s.v2+json' } });
    expect(await fixture(response).client.getReview(reviewId)).toEqual(review);
  });

  it('cancels and releases a response stream when its owner disposes the request', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const controller = new AbortController();
    const promise = fixture(new Response(body)).client.getReview(reviewId, controller.signal);
    controller.abort(new Error('private upstream guest@example.invalid'));
    await rejectedKind(promise, 'uncertain');
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('times out an unresponsive native fetch without retrying or claiming the action failed', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const client = createStepUpReviewClient({ baseUrl: origin, accessToken, fetch: send });
      const result = rejectedKind(client.approve(reviewId, approval), 'uncertain');
      await vi.advanceTimersByTimeAsync(STEP_UP_REVIEW_TIMEOUT_MS);
      await result;
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('times out and releases a stalled response body as an uncertain result', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
      const result = rejectedKind(fixture(new Response(body)).client.approve(reviewId, approval), 'uncertain');
      await vi.advanceTimersByTimeAsync(STEP_UP_REVIEW_TIMEOUT_MS);
      await result;
      expect(cancelled).toBe(true);
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
