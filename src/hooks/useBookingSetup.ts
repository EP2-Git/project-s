import { useCallback, useEffect, useState } from 'react';
import { fetchBookingSetup, type BookingSetupSnapshot } from '@/services/bookingSetupService';

export interface BookingSetupState extends BookingSetupSnapshot {
  status: 'loading' | 'error' | 'loaded';
}

const pendingState = (): BookingSetupState => ({
  status: 'loading',
  username: null,
  timezone: null,
  profileComplete: false,
  meetingTypeComplete: false,
  availabilityComplete: false,
});

export function useBookingSetup(userId: string | undefined) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    owner: string | undefined;
    state: BookingSetupState;
  }>(() => ({ owner: userId, state: pendingState() }));

  const refresh = useCallback(() => {
    setResult({ owner: userId, state: pendingState() });
    setRevision((value) => value + 1);
  }, [userId]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setResult({ owner: userId, state: pendingState() });

    if (userId) {
      void fetchBookingSetup(userId, { signal: controller.signal }).then(
        (snapshot) => {
          if (active) {
            setResult({ owner: userId, state: { status: 'loaded', ...snapshot } });
          }
        },
        () => {
          if (active) {
            setResult({
              owner: userId,
              state: { ...pendingState(), status: 'error' },
            });
          }
        },
      );
    }

    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, revision]);

  // Rendering a new account must never expose the previous account's link,
  // including the render before this account's effect has started.
  return { ...(result.owner === userId ? result.state : pendingState()), refresh };
}
