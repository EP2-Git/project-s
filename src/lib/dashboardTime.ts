import { endOfWeek, startOfWeek } from 'date-fns';
import {
  calendarDateToDateKey,
  dateKeyToCalendarDate,
  getDateKeyInTimeZone,
} from '@/lib/time';
import type { IanaTimeZone, LocalDate } from '@/types/publicBooking';

export type BookingFilter = 'all' | 'upcoming' | 'week';

export const getDashboardDateKey = (
  instant: Date,
  hostTimeZone: IanaTimeZone,
): LocalDate => getDateKeyInTimeZone(instant, hostTimeZone);

export const bookingMatchesFilter = (
  start: Date,
  filter: BookingFilter,
  hostTimeZone: IanaTimeZone,
  now = new Date(),
) => {
  if (filter === 'all') return true;

  // A meeting stops being upcoming at its start instant; in-progress meetings are historical.
  if (filter === 'upcoming') return start.getTime() > now.getTime();

  const bookingDate = getDashboardDateKey(start, hostTimeZone);
  const today = getDashboardDateKey(now, hostTimeZone);

  const todayProxy = dateKeyToCalendarDate(today);
  const weekStart = calendarDateToDateKey(startOfWeek(todayProxy));
  const weekEnd = calendarDateToDateKey(endOfWeek(todayProxy));
  return bookingDate >= weekStart && bookingDate <= weekEnd;
};

export const canCancelBooking = (
  status: string,
  start: Date,
  now = new Date(),
) => status === 'confirmed' && start.getTime() > now.getTime();

export const bookingIsVisibleInFilter = (
  status: string,
  start: Date,
  filter: BookingFilter,
  hostTimeZone: IanaTimeZone,
  now = new Date(),
) => {
  if (filter === 'all') return true;
  if (status !== 'confirmed') return false;
  return bookingMatchesFilter(start, filter, hostTimeZone, now);
};
