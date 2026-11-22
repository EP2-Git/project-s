import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { V2StepUpReviewData, V2StepUpApprovedData } from '@project-s/contracts/v2';
import StepUpReview from '@/features/step-up-review/StepUpReview';
import { StepUpReviewClientError, type StepUpReviewClient } from '@/services/stepUpReviewClient';

const reviewId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherReviewId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const digest = 'a'.repeat(64);
const review: V2StepUpReviewData = {
  reviewId,
  revision: 1,
  state: 'pending',
  summaryDigest: digest,
  expiresAt: '2030-02-04T12:05:00.000000Z',
  exactSummary: {
    username: 'demo-host',
    hostDisplayName: 'Synthetic Host',
    meetingTypeId: '11111111-1111-4111-8111-111111111111',
    meetingTypeTitle: 'Planning session',
    startAt: '2030-02-04T13:00:00.000000Z',
    endAt: '2030-02-04T13:30:00.000000Z',
    hostTimeZone: 'America/Halifax',
    guestTimeZone: 'America/Halifax',
    name: 'Synthetic Guest',
    email: 'reviewer@example.invalid',
  },
  differences: [{
    field: 'meeting_window',
    proposed: '2030-02-04T13:00:00.000000Z / 2030-02-04T13:30:00.000000Z',
    reviewed: '2030-02-04T12:00:00.000000Z / 2030-02-04T12:30:00.000000Z',
  }],
};
const approved: V2StepUpApprovedData = {
  reviewId, state: 'approved', preparationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  expiresAt: '2030-02-04T12:05:00.000000Z',
};
const declined = { reviewId, state: 'revoked' as const, revision: 2, revokedAt: '2030-02-04T12:00:00.000000Z' };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture = () => ({
  getReview: vi.fn<StepUpReviewClient['getReview']>().mockResolvedValue(structuredClone(review)),
  approve: vi.fn<StepUpReviewClient['approve']>().mockResolvedValue(structuredClone(approved)),
  decline: vi.fn<StepUpReviewClient['decline']>().mockResolvedValue(structuredClone(declined)),
});
const ready = async () => screen.findByRole('button', { name: 'Approve this request', exact: true });
const mount = (client = fixture()) => ({
  client,
  ...render(<StepUpReview reviewId={reviewId} sessionKey="account-session-a" client={client} />),
});

describe('pending-only step-up review', () => {
  it('loads and explains the exact meeting without silently approving or claiming a booking', async () => {
    const reading = deferred<V2StepUpReviewData>();
    const client = fixture();
    client.getReview.mockReturnValueOnce(reading.promise);
    mount(client);
    expect(screen.getByRole('status')).toHaveTextContent('Loading this request');
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    await act(async () => reading.resolve(review));
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Review this meeting' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Meeting details' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Why approval is needed' })).toBeVisible();
    expect(screen.getByText('Synthetic Host', { exact: true })).toBeVisible();
    expect(screen.getByText('Synthetic Guest', { exact: true })).toBeVisible();
    expect(screen.getByText('reviewer@example.invalid', { exact: true })).toBeVisible();
    expect(screen.getByText('Planning session', { exact: true })).toBeVisible();
    expect(screen.getByText(/30 minutes/)).toBeVisible();
    expect(screen.getAllByText(/America\/Halifax/).length).toBeGreaterThan(0);
    expect(client.approve).not.toHaveBeenCalled();
    expect(client.decline).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Booking confirmed$/i)).toBeNull();
  });

  it('uses an ordinary focused keyboard button to approve exactly the captured revision and digest', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    const approve = await ready();
    await user.keyboard('{Enter}');
    expect(client.approve).not.toHaveBeenCalled();
    approve.focus();
    await user.keyboard(' ');
    expect(client.approve).toHaveBeenCalledOnce();
    expect(client.approve).toHaveBeenCalledWith(reviewId, { expectedRevision: 1, summaryDigest: digest }, expect.any(AbortSignal));
    expect(await screen.findByRole('heading', { name: 'Approval recorded' })).toBeVisible();
    expect(screen.getByText(/not.*(confirm|booked|reservation)|does not.*(confirm|reserve)/i)).toBeVisible();
    expect(client.decline).not.toHaveBeenCalled();
    expect(client.getReview).toHaveBeenCalledOnce();
  });

  it('acknowledges pending decline only after the exact server action', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Decline this request', exact: true }));
    expect(client.decline).toHaveBeenCalledWith(reviewId, { expectedRevision: 1 }, expect.any(AbortSignal));
    expect(await screen.findByRole('heading', { name: 'Request declined' })).toBeVisible();
    expect(client.approve).not.toHaveBeenCalled();
  });

  for (const action of ['approve', 'decline'] as const) {
    it(`keeps a lost ${action} result uncertain and retries only the identical action without GET`, async () => {
      const user = userEvent.setup();
      const { client } = mount();
      client[action].mockRejectedValueOnce(new StepUpReviewClientError('uncertain'));
      await ready();
      await user.click(screen.getByRole('button', { name: action === 'approve' ? 'Approve this request' : 'Decline this request', exact: true }));
      const retry = await screen.findByRole('button', { name: action === 'approve' ? 'Retry the same approval' : 'Retry the same decline', exact: true });
      expect(screen.queryByRole('heading', { name: /Approval recorded|Request declined/ })).toBeNull();
      const other = screen.queryByRole('button', { name: action === 'approve' ? 'Decline this request' : 'Approve this request', exact: true });
      if (other) expect(other).toBeDisabled();
      await user.click(retry);
      expect(client[action]).toHaveBeenCalledTimes(2);
      const requests = client[action].mock.calls;
      expect(requests[0].slice(0, 2)).toEqual(requests[1].slice(0, 2));
      expect(client.getReview).toHaveBeenCalledOnce();
      expect(client[action === 'approve' ? 'decline' : 'approve']).not.toHaveBeenCalled();
      expect(await screen.findByRole('heading', { name: action === 'approve' ? 'Approval recorded' : 'Request declined' })).toBeVisible();
    });
  }

  it('locks an action before the next render so repeated clicks cannot dispatch twice', async () => {
    const pending = deferred<V2StepUpApprovedData>();
    const { client } = mount();
    client.approve.mockReturnValueOnce(pending.promise);
    const approve = await ready();
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(screen.getByRole('button', { name: 'Decline this request', exact: true }));
    expect(client.approve).toHaveBeenCalledOnce();
    expect(client.decline).not.toHaveBeenCalled();
    await act(async () => pending.resolve(approved));
    expect(await screen.findByRole('heading', { name: 'Approval recorded' })).toBeVisible();
  });

  it('requires explicit same-action retry after contention rather than silently resubmitting', async () => {
    const user = userEvent.setup();
    const { client } = mount();
    client.approve.mockRejectedValueOnce(new StepUpReviewClientError('busy', 1));
    await ready();
    await user.click(screen.getByRole('button', { name: 'Approve this request', exact: true }));
    const retry = await screen.findByRole('button', { name: 'Retry the same approval', exact: true });
    expect(retry).toBeDisabled();
    await waitFor(() => expect(retry).toBeEnabled(), { timeout: 2_000 });
    expect(client.approve).toHaveBeenCalledOnce();
    await user.click(retry);
    expect(client.approve).toHaveBeenCalledTimes(2);
    expect(client.getReview).toHaveBeenCalledOnce();
  });

  for (const kind of ['slot_unavailable', 'outside_booking_window', 'unavailable'] as const) {
    it(`does not invent terminal authority state after ${kind}`, async () => {
      const user = userEvent.setup();
      const { client } = mount();
      client.approve.mockRejectedValueOnce(new StepUpReviewClientError(kind));
      await ready();
      await user.click(screen.getByRole('button', { name: 'Approve this request', exact: true }));
      await waitFor(() => expect(screen.queryByText(review.exactSummary.email)).toBeNull());
      expect(screen.queryByRole('heading', { name: /Approval recorded|Request declined|Already handled|Expired/i })).toBeNull();
      expect(client.getReview).toHaveBeenCalledOnce();
      expect(client.decline).not.toHaveBeenCalled();
    });
  }

  it('gives missing and foreign reviews the same neutral unavailable recovery', async () => {
    const client = fixture();
    client.getReview.mockRejectedValue(new StepUpReviewClientError('unavailable'));
    mount(client);
    expect(await screen.findByRole('heading', { name: 'This request is no longer available' })).toBeVisible();
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve this request', exact: true })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Approval recorded|Request declined|Already handled|Expired/i })).toBeNull();
  });

  it('requires signed-in context without exposing a previously loaded snapshot', async () => {
    const onSignIn = vi.fn();
    const client = fixture();
    const { rerender } = render(<StepUpReview reviewId={reviewId} sessionKey="account-a" client={client} onSignIn={onSignIn} />);
    await ready();
    rerender(<StepUpReview reviewId={reviewId} sessionKey={null} client={client} onSignIn={onSignIn} />);
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sign in to review this request' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in', exact: true }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(client.getReview).toHaveBeenCalledOnce();
  });

  it('clears details and offers sign-in if fresh verification is refused during an action', async () => {
    const { client } = mount();
    client.approve.mockRejectedValueOnce(new StepUpReviewClientError('authentication'));
    fireEvent.click(await ready());
    expect(await screen.findByRole('heading', { name: 'Sign in to review this request' })).toBeVisible();
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(client.decline).not.toHaveBeenCalled();
  });

  it('clears private state synchronously on account changes and ignores late prior-account reads', async () => {
    const first = deferred<V2StepUpReviewData>();
    const next = deferred<V2StepUpReviewData>();
    const client = fixture();
    client.getReview.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const { rerender } = render(<StepUpReview reviewId={reviewId} sessionKey="account-a" client={client} />);
    const firstSignal = client.getReview.mock.calls[0][1]!;
    rerender(<StepUpReview reviewId={reviewId} sessionKey="account-b" client={client} />);
    expect(firstSignal.aborted).toBe(true);
    await act(async () => first.resolve(review));
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    await act(async () => next.resolve({ ...review, exactSummary: { ...review.exactSummary, email: 'new-account@example.invalid' } }));
    expect(await screen.findByText('new-account@example.invalid')).toBeVisible();
    expect(screen.queryByText('reviewer@example.invalid')).toBeNull();
  });

  it('hides an already loaded account snapshot before the replacement account read resolves', async () => {
    const { client, rerender } = mount();
    await ready();
    const reading = deferred<V2StepUpReviewData>();
    client.getReview.mockReturnValueOnce(reading.promise);
    rerender(<StepUpReview reviewId={reviewId} sessionKey="replacement-account-session" client={client} />);
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve this request', exact: true })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading this request');
    await act(async () => reading.reject(new StepUpReviewClientError('unavailable')));
    expect(await screen.findByRole('heading', { name: 'This request is no longer available' })).toBeVisible();
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
  });

  it('removes a loaded snapshot immediately when the request reference changes', async () => {
    const next = deferred<V2StepUpReviewData>();
    const { client, rerender } = mount();
    await ready();
    client.getReview.mockReturnValueOnce(next.promise);
    rerender(<StepUpReview reviewId={otherReviewId} sessionKey="account-session-a" client={client} />);
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading this request');
    await act(async () => next.resolve({ ...review, reviewId: otherReviewId, exactSummary: { ...review.exactSummary, name: 'Other Request Person' } }));
    expect(await screen.findByText('Other Request Person')).toBeVisible();
  });

  it('ignores a late approval acknowledgement after logout and aborts the action signal', async () => {
    const pending = deferred<V2StepUpApprovedData>();
    const { client, rerender } = mount();
    client.approve.mockReturnValueOnce(pending.promise);
    fireEvent.click(await ready());
    const signal = client.approve.mock.calls[0][2]!;
    rerender(<StepUpReview reviewId={reviewId} sessionKey={null} client={null} />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    await act(async () => pending.resolve(approved));
    expect(screen.queryByRole('heading', { name: 'Approval recorded' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sign in to review this request' })).toBeVisible();
  });

  it('resets on client replacement even when the session and request keys are unchanged', async () => {
    const { client, rerender } = mount();
    await ready();
    const replacement = fixture();
    const reading = deferred<V2StepUpReviewData>();
    replacement.getReview.mockReturnValueOnce(reading.promise);
    rerender(<StepUpReview reviewId={reviewId} sessionKey="account-session-a" client={replacement} />);
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(client.getReview.mock.calls[0][1]!.aborted).toBe(true);
    await act(async () => reading.resolve(review));
    await ready();
  });

  it('aborts an abandoned read and does not accept its later success', async () => {
    const reading = deferred<V2StepUpReviewData>();
    const client = fixture();
    client.getReview.mockReturnValueOnce(reading.promise);
    const { unmount } = mount(client);
    const signal = client.getReview.mock.calls[0][1]!;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => reading.resolve(review));
    expect(screen.queryByText(review.exactSummary.email)).toBeNull();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it('renders recorded meeting text as text without interpreting HTML or scripts', async () => {
    const client = fixture();
    const title = '<img src=x onerror="alert(1)">';
    client.getReview.mockResolvedValueOnce({ ...review, exactSummary: { ...review.exactSummary, meetingTypeTitle: title } });
    mount(client);
    await ready();
    expect(screen.getByText(title, { exact: true })).toBeVisible();
    expect(document.querySelector('img, script')).toBeNull();
    expect(client.approve).not.toHaveBeenCalled();
  });

  it('preserves a reviewed fixed offset when the browser supports formatting it', async () => {
    const client = fixture();
    client.getReview.mockResolvedValueOnce({ ...review, exactSummary: { ...review.exactSummary, guestTimeZone: '+05:45' } });
    mount(client);
    await ready();
    expect(screen.getAllByText(/\+05:45/).length).toBeGreaterThan(0);
    expect(document.querySelector('time[datetime="2030-02-04T13:00:00.000000Z"]')).toBeVisible();
  });

  it('labels its UTC fallback and retains the exact reviewed offset and instant if Intl rejects it', async () => {
    const original = Intl.DateTimeFormat;
    const format = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      locales?: Parameters<typeof Intl.DateTimeFormat>[0], options?: Intl.DateTimeFormatOptions,
    ) {
      if (options?.timeZone === '+05:45') throw new RangeError('Unsupported time zone');
      return new original(locales, options);
    } as typeof Intl.DateTimeFormat);
    try {
      const client = fixture();
      client.getReview.mockResolvedValueOnce({ ...review, exactSummary: { ...review.exactSummary, guestTimeZone: '+05:45' } });
      mount(client);
      await ready();
      expect(screen.getAllByText(/\+05:45/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/UTC/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/2030-02-04T13:00:00/).length).toBeGreaterThan(0);
    } finally {
      format.mockRestore();
    }
  });
});
