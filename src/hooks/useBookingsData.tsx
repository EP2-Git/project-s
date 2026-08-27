import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './useAuth';
import { cancelHostBooking, HostBookingError } from '@/services/hostBookingService';
import type { BookingFilter } from '@/lib/dashboardTime';
import { createRefreshLimiter } from '@/lib/refreshLimiter';

const RATE_LIMIT_MAX_CALLS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface BookingEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  bookerName?: string;
  bookerEmail?: string;
  status: string;
  source: 'project-s';
  version: number;
  canceledAt?: Date;
  notes?: string;
}

export function useBookingsData() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [filter, setFilter] = useState<BookingFilter>('all');
  const [hasCompletedFetch, setHasCompletedFetch] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [cancelingBookingId, setCancelingBookingId] = useState<string | null>(null);
  const refreshLimiterRef = useRef<ReturnType<typeof createRefreshLimiter> | null>(null);
  if (!refreshLimiterRef.current) {
    refreshLimiterRef.current = createRefreshLimiter({
      maxCalls: RATE_LIMIT_MAX_CALLS,
      windowMs: RATE_LIMIT_WINDOW_MS,
      onLimitedChange: setIsRateLimited,
    });
  }

  const checkRateLimit = useCallback(() => {
    return refreshLimiterRef.current?.attempt() ?? false;
  }, []);

  useEffect(() => () => refreshLimiterRef.current?.dispose(), []);

  const fetchBookings = useCallback(
    async (force = false) => {
      if (!user) {
        setBookings([]);
        setLoading(false);
        setHasCompletedFetch(true);
        return;
      }
      if (force && !checkRateLimit()) {
        toast.warning('Please wait a moment before refreshing again');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const { data, error: queryError } = await supabase
          .from('bookings')
          .select('id,start_time,end_time,booker_name,booker_email,notes,status,version,canceled_at,meeting_type_title')
          .eq('user_id', user.id)
          .order('start_time', { ascending: true });
        if (queryError) throw queryError;

        setBookings(
          (data ?? []).flatMap((booking) => {
            if (!booking.end_time) return [];
            return {
              id: booking.id,
              title: booking.meeting_type_title || 'Untitled meeting',
              start: new Date(booking.start_time),
              end: new Date(booking.end_time),
              bookerName: booking.booker_name ?? undefined,
              bookerEmail: booking.booker_email ?? undefined,
              status: booking.status || 'confirmed',
              source: 'project-s' as const,
              version: booking.version,
              canceledAt: booking.canceled_at
                ? new Date(booking.canceled_at)
                : undefined,
              notes: booking.notes ?? undefined,
            } satisfies BookingEvent;
          }),
        );
        if (force) toast.success('Booking data refreshed');
      } catch (caught) {
        const nextError = caught instanceof Error ? caught : new Error(String(caught));
        setError(nextError);
        if (force) toast.error('Failed to refresh booking data');
      } finally {
        setLoading(false);
        setHasCompletedFetch(true);
      }
    },
    [checkRateLimit, user],
  );

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  const refreshData = useCallback(() => {
    void fetchBookings(true);
  }, [fetchBookings]);

  const cancelBooking = useCallback(
    async (bookingId: string, expectedVersion: number) => {
      setCancelingBookingId(bookingId);
      try {
        const canceled = await cancelHostBooking(bookingId, expectedVersion);
        setBookings((current) =>
          current.map((booking) =>
            booking.id === canceled.bookingId
              ? {
                  ...booking,
                  status: canceled.status,
                  version: canceled.version,
                  canceledAt: canceled.canceledAt
                    ? new Date(canceled.canceledAt)
                    : undefined,
                }
              : booking,
          ),
        );
        toast.success('Booking cancelled. Core pre-alpha does not send a cancellation email.');
      } catch (caught) {
        if (caught instanceof HostBookingError) {
          toast.error(caught.message);
          if (caught.code === 'VERSION_CONFLICT') await fetchBookings();
        } else {
          toast.error('Failed to cancel booking');
        }
      } finally {
        setCancelingBookingId(null);
      }
    },
    [fetchBookings],
  );

  return {
    bookings,
    loading,
    error,
    filter,
    setFilter,
    refreshData,
    hasCompletedFetch,
    isRateLimited,
    cancelBooking,
    cancelingBookingId,
  };
}
