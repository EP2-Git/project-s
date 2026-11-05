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
    expect(await screen.findByRole('heading', { name: 'What you’re approving' })).toBeVisible();
    expect(screen.getByText('Authority Demo Guest')).toBeVisible();
    expect(screen.getByText(/one booking with the exact details below/i)).toBeVisible();
    expect(screen.getByText(/the host will receive the name, email, and notes/i)).toBeVisible();
    expect(screen.getByText(/does not hold the time/i)).toBeVisible();

    const approve = screen.getByRole('button', { name: 'Approve this booking' });
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
      name: 'Approval recorded',
    });
    expect(recorded).toHaveFocus();
    expect(
      screen.getByText(/the app or agent still needs to book the meeting/i),
    ).toBeVisible();
    expect(serviceMocks.confirmPreparation).toHaveBeenCalledWith({
      preparationToken: 'prep_abcdefghijklmnopqrstuvwxyz0123456789',
      challengeToken: 'test-human-confirmation',
    });
  });

  it('describes only the fields the host receives when there are no notes', async () => {
    serviceMocks.getPreparation.mockResolvedValue({
      ...preview,
      summary: {
        ...preview.summary,
        booker: { name: preview.summary.booker.name, email: preview.summary.booker.email },
      },
    });

    render(
      <MemoryRouter>
        <BookingConfirmationPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/the host will receive the name and email/i)).toBeVisible();
    expect(screen.queryByText(/the host will receive the name, email, and notes/i)).not.toBeInTheDocument();
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
