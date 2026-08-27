import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingConfirmationPage from '@/pages/BookingConfirmationPage';

const serviceMocks = vi.hoisted(() => ({
  getPreparation: vi.fn(),
  confirmPreparation: vi.fn(),
}));

vi.mock('@/services/publicBookingService', () => {
  class PublicBookingError extends Error {}
  return {
    PublicBookingError,
    publicBookingService: serviceMocks,
  };
});

vi.mock('@/components/booking/HumanConfirmationChallenge', () => ({
  default: ({
    value,
    disabled,
    onTokenChange,
  }: {
    value: string | null;
    disabled?: boolean;
    onTokenChange(token: string | null): void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={value === 'test-human-confirmation'}
        disabled={disabled}
        onChange={(event) =>
          onTokenChange(event.target.checked ? 'test-human-confirmation' : null)
        }
      />
      I reviewed these details and am confirming this local development booking.
    </label>
  ),
}));

const preview = {
  preparationId: '22222222-2222-4222-8222-222222222222',
  expiresAt: '2099-08-25T13:00:00.000Z',
  notHeld: true,
  summary: {
    username: 'demo-host',
    hostDisplayName: 'Demo Host',
    meetingTypeId: '11111111-1111-4111-8111-111111111111',
    meetingTypeTitle: 'Intro call',
    startAt: '2099-08-25T13:00:00.000Z',
    endAt: '2099-08-25T13:30:00.000Z',
    hostTimeZone: 'America/Halifax',
    guestTimeZone: 'America/Halifax',
    booker: {
      name: 'Authority Demo Guest',
      email: 'authority-demo@example.invalid',
      notes: 'Synthetic authority-boundary fixture.',
    },
  },
} as const;

describe('prepared booking browser confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getPreparation.mockResolvedValue(preview);
    serviceMocks.confirmPreparation.mockResolvedValue({
      preparationId: preview.preparationId,
      grantId: '33333333-3333-4333-8333-333333333333',
      confirmedAt: '2099-08-25T12:00:00.000Z',
      method: 'human_browser',
    });
    window.history.replaceState(
      null,
      '',
      '/booking/confirm#preparation=prep_abcdefghijklmnopqrstuvwxyz0123456789',
    );
  });

  it('removes the private fragment and keeps create visibly blocked until both human gates pass', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <BookingConfirmationPage />
      </MemoryRouter>,
    );

    expect(window.location.hash).toBe('');
    expect(
      await screen.findByRole('heading', { name: 'Review a prepared booking' }),
    ).toBeVisible();
    expect(await screen.findByText('Agent create is blocked')).toBeVisible();
    expect(screen.getByText('Authority Demo Guest')).toBeVisible();
    expect(screen.getByText(/No booking exists yet/i)).toBeVisible();

    const approve = screen.getByRole('button', { name: 'Approve booking' });
    expect(approve).toBeDisabled();

    await user.click(
      screen.getByRole('checkbox', {
        name: /confirming this local development booking/i,
      }),
    );
    expect(approve).toBeDisabled();

    await user.click(
      screen.getByRole('checkbox', {
        name: /accept terms and privacy notice/i,
      }),
    );
    expect(approve).toBeEnabled();
    await user.click(approve);

    const recorded = await screen.findByRole('heading', {
      name: 'Human authority recorded',
    });
    expect(recorded).toHaveFocus();
    expect(
      screen.getByText(/It did not create or reserve a booking/i),
    ).toBeVisible();
    expect(serviceMocks.confirmPreparation).toHaveBeenCalledWith({
      preparationToken: 'prep_abcdefghijklmnopqrstuvwxyz0123456789',
      challengeToken: 'test-human-confirmation',
    });
  });

  it('fails closed when the private preparation token is missing', async () => {
    window.history.replaceState(null, '', '/booking/confirm');

    render(
      <MemoryRouter>
        <BookingConfirmationPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('alert'),
      ).toHaveTextContent('missing its private preparation token'),
    );
    expect(serviceMocks.getPreparation).not.toHaveBeenCalled();
  });
});
