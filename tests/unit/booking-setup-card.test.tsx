import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardBookingLinkCard from '@/components/dashboard/DashboardBookingLinkCard';

const fixtures = vi.hoisted(() => ({
  setup: {
    status: 'loaded' as 'loading' | 'loaded' | 'error', username: 'new-host' as string | null,
    timezone: 'America/Halifax' as string | null, profileComplete: true,
    meetingTypeComplete: false, availabilityComplete: false, refresh: vi.fn(),
  },
  toast: vi.fn(),
}));
vi.mock('@/hooks/useBookingSetup', () => ({ useBookingSetup: () => fixtures.setup }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: fixtures.toast }) }));

const draw = () => {
  const onNavigate = vi.fn();
  render(<MemoryRouter><DashboardBookingLinkCard userId="synthetic-owner" onNavigate={onNavigate} /></MemoryRouter>);
  return onNavigate;
};

describe('booking setup and link recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(fixtures.setup, {
      status: 'loaded', username: 'new-host', timezone: 'America/Halifax',
      profileComplete: true, meetingTypeComplete: false, availabilityComplete: false,
    });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });

  it('keeps a new host link usable while guiding missing saved settings', async () => {
    const navigate = draw();
    expect(screen.getByRole('heading', { name: 'Finish your booking setup' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 setup steps saved');
    expect(screen.getByRole('link', { name: 'Profile and timezone' })).toHaveAttribute('href', '/profile-settings');
    fireEvent.click(screen.getByRole('button', { name: 'Meeting types' }));
    expect(navigate).toHaveBeenLastCalledWith('meeting-types');
    fireEvent.click(screen.getByRole('button', { name: 'Availability' }));
    expect(navigate).toHaveBeenLastCalledWith('availability');
    expect(screen.getByRole('link', { name: 'Open link' })).toHaveAttribute('href', `${window.location.origin}/book/new-host`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/book/new-host`);
    expect(await screen.findByRole('button', { name: 'Share link' })).toBeVisible();
  });

  it('calls completed setup saved without promising available slots or booking authority', () => {
    Object.assign(fixtures.setup, { meetingTypeComplete: true, availabilityComplete: true });
    draw();
    expect(screen.getByRole('heading', { name: 'Your setup is saved' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Availability is checked again when a guest books');
    expect(screen.getAllByText('Saved', { exact: true })).toHaveLength(3);
  });

  it('keeps unknown loading/error state out of completion and offers a safe retry', () => {
    Object.assign(fixtures.setup, { status: 'error', username: null, timezone: null, profileComplete: false });
    draw();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not check your saved setup.');
    expect(screen.queryByRole('link', { name: 'Open link' })).not.toBeInTheDocument();
    expect(screen.queryByText(/steps saved/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check setup again' }));
    expect(fixtures.setup.refresh).toHaveBeenCalledOnce();
  });

  it('waits accessibly for a snapshot and prevents retry storms', () => {
    Object.assign(fixtures.setup, { status: 'loading', username: null });
    draw();
    expect(screen.getByRole('status')).toHaveTextContent('Checking saved setup…');
    expect(screen.getByRole('button', { name: 'Check setup again' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });

  it('provides manual recovery when clipboard permission is denied', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('permission denied'));
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Select and copy the link above.');
    expect(fixtures.toast).not.toHaveBeenCalled();
  });

  it('falls back to copy when native sharing fails, but respects user cancellation', async () => {
    const share = vi.fn().mockRejectedValueOnce(new DOMException('cancelled', 'AbortError')).mockRejectedValueOnce(new Error('not allowed'));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    await vi.waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledOnce());
  });

  it('offers labelled selectable embed code and recovers from a blocked clipboard', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('permission denied'));
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Embed code' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByRole('textbox', { name: 'Booking embed code' }) as HTMLTextAreaElement).value).toContain('/embed/new-host');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy snippet' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Select and copy the code above.');
  });
});
