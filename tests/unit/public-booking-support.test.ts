import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicBookingService } from '../../src/services/publicBookingService';

const preparationToken = 'prep_abcdefghijklmnopqrstuvwxyz0123456789';
const preparationId = '11111111-1111-4111-8111-111111111111';
const grant = {
  preparationId,
  grantId: '22222222-2222-4222-8222-222222222222',
  confirmedAt: '2026-10-14T19:00:00.000Z',
  method: 'human_browser',
};
const respond = (data: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    contractVersion: 1, requestId: 'synthetic-request', data,
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => vi.unstubAllGlobals());

describe('browser confirmation support boundary', () => {
  it('accepts a server-recorded grant and omits browser credentials', async () => {
    const fetchMock = respond(grant);
    await expect(publicBookingService.confirmPreparation({ preparationToken }))
      .resolves.toEqual(grant);
    const request = fetchMock.mock.calls[0][1];
    expect(request.credentials).toBe('omit');
    expect(JSON.parse(request.body)).toEqual({ preparationToken });
  });

  it.each([
    { ...grant, method: 'model_assertion' },
    { ...grant, confirmed: true },
    { preparationId, confirmed: true },
    { ...grant, grantId: 'not-a-server-grant' },
  ])('rejects an invalid or authority-extended grant response %#', async (data) => {
    respond(data);
    await expect(publicBookingService.confirmPreparation({ preparationToken }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'The scheduling service returned an invalid response.' });
  });

  it('does not disclose transport exception details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private transport diagnostic')));
    await expect(publicBookingService.confirmPreparation({ preparationToken }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'The scheduling service is temporarily unavailable. Please try again.' });
  });

  it('refuses malformed preparation tokens before making a request', () => {
    const fetchMock = respond(grant);
    expect(() => publicBookingService.confirmPreparation({ preparationToken: 'invalid' })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-JSON success responses without exposing their contents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream diagnostic', { status: 200 })));
    await expect(publicBookingService.confirmPreparation({ preparationToken }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'The scheduling service returned an invalid response.' });
  });

  it('keeps malformed upstream failure details out of the public message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: 'private upstream diagnostic' }), { status: 503 })));
    await expect(publicBookingService.confirmPreparation({ preparationToken }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR', message: 'The scheduling service is temporarily unavailable. Please try again.' });
  });
});
