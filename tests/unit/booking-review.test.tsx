import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BookingReview from '@/components/booking/BookingReview';

const summary = {
  username: 'demo-host',
  hostDisplayName: 'Demo Host',
  meetingTypeId: '11111111-1111-4111-8111-111111111111',
  meetingTypeTitle: 'Planning session',
  startAt: '2026-08-25T13:00:00.000Z',
  endAt: '2026-08-25T13:30:00.000Z',
  hostTimeZone: 'America/Halifax',
  guestTimeZone: 'America/Halifax',
  booker: {
    name: 'Synthetic Guest',
    email: 'review-retry@example.invalid',
  },
} as const;

describe('BookingReview retry safety', () => {
  it('allows only an exact create retry after approval, even past preparation expiry', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(async () => undefined);

    render(
      <BookingReview
        preparationId="22222222-2222-4222-8222-222222222222"
        expiresAt="2000-01-01T00:00:00.000Z"
        summary={summary}
        error={null}
        busy={false}
        challengeToken={null}
        approvalRecorded
        onChallengeTokenChange={vi.fn()}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/Human approval is recorded/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
    const retry = screen.getByRole('button', { name: 'Create booking' });
    expect(retry).toBeEnabled();

    await user.click(retry);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('BookingReview expiry', () => {
  const initialTime = Date.parse('2026-08-25T12:00:00.000Z');
  const reviewProps = {
    preparationId: '22222222-2222-4222-8222-222222222222',
    expiresAt: new Date(initialTime + 1_000).toISOString(),
    summary,
    error: null,
    busy: false,
    challengeToken: 'project-s-local-confirmation',
  };

  afterEach(() => vi.useRealTimers());

  it('expires an open review without a click and removes its challenge', () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
    render(
      <BookingReview
        {...reviewProps}
        expiryMessage="This request expired. Ask the app or agent for a new approval link."
        onChallengeTokenChange={vi.fn()}
        onConfirm={vi.fn(async () => undefined)}
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Confirm and book' });
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('checkbox')).toBeVisible();

    act(() => vi.advanceTimersByTime(1_000));

    expect(screen.getByRole('alert')).toHaveTextContent('Ask the app or agent for a new approval link.');
    expect(confirm).toBeDisabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('checks the deadline before submitting even when the expiry timer has not fired', () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
    const onConfirm = vi.fn(async () => undefined);
    render(
      <BookingReview {...reviewProps} onChallengeTokenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    const confirm = screen.getByRole('button', { name: 'Confirm and book' });
    expect(confirm).toBeEnabled();
    vi.setSystemTime(initialTime + 1_000);
    fireEvent.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('This review expired.');
  });

  it('uses the replacement preparation deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialTime);
    const callbacks = { onChallengeTokenChange: vi.fn(), onConfirm: vi.fn(async () => undefined) };
    const { rerender } = render(<BookingReview {...reviewProps} {...callbacks} />);

    rerender(
      <BookingReview
        {...reviewProps}
        {...callbacks}
        preparationId="33333333-3333-4333-8333-333333333333"
        expiresAt={new Date(initialTime + 2_000).toISOString()}
      />,
    );

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm and book' })).toBeEnabled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('alert')).toHaveTextContent('This review expired.');
  });
});
