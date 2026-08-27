import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
