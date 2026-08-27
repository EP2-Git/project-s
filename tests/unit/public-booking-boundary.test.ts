import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPublicBookingRequestSchema,
  prepareBookingInputSchema,
  publicBookingPageSchema,
} from '../../src/types/publicBooking';
import {
  formatSlotTime,
  getDateKeyInTimeZone,
  calendarDateToDateKey,
  dateKeyToCalendarDate,
} from '../../src/lib/time';
import { cancelBookingResponseSchema } from '../../src/types/hostBooking';
import {
  bookingMatchesFilter,
  bookingIsVisibleInFilter,
  canCancelBooking,
  getDashboardDateKey,
} from '../../src/lib/dashboardTime';
import { getPostSignupDestination } from '../../src/lib/auth';
import {
  buildSpecificDateWritePlan,
  buildWeeklySchedule,
  createLatestRequestGate,
  isValidTimeWindow,
  normalizeTimeForInput,
} from '../../src/lib/availability';
import { getSafeMailtoHref } from '../../src/lib/contact';
import { saveWeeklySchedule } from '../../src/services/availabilityService';
import { createRefreshLimiter } from '../../src/lib/refreshLimiter';

afterEach(() => {
  vi.useRealTimers();
});

const validPage = {
  username: 'host',
  displayName: 'Example Host',
  avatarUrl: null,
  hostTimeZone: 'America/Halifax',
  meetingTypes: [
    {
      meetingTypeId: '11111111-1111-4111-8111-111111111111',
      title: 'Introduction',
      description: null,
      durationMinutes: 30,
      minNoticeMinutes: 60,
      maxAdvanceDays: 60,
    },
  ],
} as const;

const validPrepareRequest = {
  username: 'host',
  meetingTypeId: '11111111-1111-4111-8111-111111111111',
  startAt: '2026-08-25T13:00:00.000Z',
  guestTimeZone: 'Asia/Tokyo',
  booker: {
    name: 'Example Guest',
    email: 'guest@example.com',
    notes: 'Looking forward to it.',
  },
} as const;

const validCreateRequest = {
  preparationToken: 'prep_abcdefghijklmnopqrstuvwxyz0123456789',
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
} as const;

describe('public booking DTO boundary', () => {
  it('accepts the frozen public envelope and rejects leaked raw fields', () => {
    expect(publicBookingPageSchema.safeParse(validPage).success).toBe(true);
    expect(
      publicBookingPageSchema.safeParse({
        ...validPage,
        userId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(false);
    expect(
      publicBookingPageSchema.safeParse({
        ...validPage,
        rawAvailabilityRules: [],
        bookings: [],
      }).success,
    ).toBe(false);
  });

  it('rejects client authority over owner and booking end time', () => {
    expect(prepareBookingInputSchema.safeParse(validPrepareRequest).success).toBe(true);
    expect(
      prepareBookingInputSchema.safeParse({
        ...validPrepareRequest,
        userId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(false);
    expect(
      prepareBookingInputSchema.safeParse({
        ...validPrepareRequest,
        endAt: '2026-08-25T13:30:00.000Z',
      }).success,
    ).toBe(false);

    expect(createPublicBookingRequestSchema.safeParse(validCreateRequest).success).toBe(true);
    expect(
      createPublicBookingRequestSchema.safeParse({
        ...validCreateRequest,
        username: validPrepareRequest.username,
      }).success,
    ).toBe(false);
    expect(
      createPublicBookingRequestSchema.safeParse({
        ...validCreateRequest,
        endAt: '2026-08-25T13:30:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('authenticated booking mutation boundary', () => {
  const cancellation = {
    bookingId: '11111111-1111-4111-8111-111111111111',
    status: 'cancelled',
    version: 2,
    canceledAt: '2026-08-25T12:00:00.000Z',
  } as const;

  it('strictly validates versioned cancellation responses', () => {
    expect(cancelBookingResponseSchema.safeParse(cancellation).success).toBe(true);
    expect(
      cancelBookingResponseSchema.safeParse({
        ...cancellation,
        userId: '33333333-3333-4333-8333-333333333333',
      }).success,
    ).toBe(false);
  });

  it('builds a defensive mailto target and rejects URI parameter injection', () => {
    expect(getSafeMailtoHref('guest@example.com')).toBe('mailto:guest%40example.com');
    expect(getSafeMailtoHref('guest@example.com?subject=injected')).toBeNull();
    expect(getSafeMailtoHref('guest@example.com&bcc=other@example.com')).toBeNull();
  });

  it('automatically unlocks the refresh throttle after its sliding window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    const states: boolean[] = [];
    const limiter = createRefreshLimiter({
      maxCalls: 5,
      windowMs: 60_000,
      onLimitedChange: (limited) => states.push(limited),
    });

    for (let index = 0; index < 5; index += 1) expect(limiter.attempt()).toBe(true);
    expect(limiter.attempt()).toBe(false);
    expect(states.at(-1)).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(states.at(-1)).toBe(false);
    expect(limiter.attempt()).toBe(true);
    limiter.dispose();
  });

  it('keeps cancelled bookings in all history but removes them from live views', () => {
    const start = new Date('2026-08-25T13:00:00.000Z');
    const now = new Date('2026-08-20T12:00:00.000Z');
    expect(bookingIsVisibleInFilter('cancelled', start, 'all', 'America/Halifax', now)).toBe(true);
    expect(bookingIsVisibleInFilter('cancelled', start, 'upcoming', 'America/Halifax', now)).toBe(false);
    expect(bookingIsVisibleInFilter('confirmed', start, 'upcoming', 'America/Halifax', now)).toBe(true);
  });
});

describe('authenticated availability writes', () => {
  const base = {
    userId: '11111111-1111-4111-8111-111111111111',
    date: '2026-08-25',
    startTime: '09:00',
    endTime: '17:00',
    bufferMinutes: 15,
    note: null,
  } as const;

  it('writes available values, a zero buffer for unavailable, and deletes default inheritance', () => {
    expect(buildSpecificDateWritePlan(base.userId, { ...base, status: 'available' }).operation).toBe('upsert');
    const unavailable = buildSpecificDateWritePlan(base.userId, { ...base, status: 'unavailable' });
    expect(unavailable).toMatchObject({ operation: 'upsert', row: { start_time: null, end_time: null, buffer_minutes: 0 } });
    expect(buildSpecificDateWritePlan(base.userId, { ...base, status: 'default' })).toEqual({
      operation: 'delete',
      userId: base.userId,
      date: base.date,
    });
  });

  it('rejects equal and reversed time windows before a write', () => {
    expect(isValidTimeWindow('09:00', '17:00')).toBe(true);
    expect(isValidTimeWindow('09:00', '09:00')).toBe(false);
    expect(isValidTimeWindow('17:00', '09:00')).toBe(false);
    expect(normalizeTimeForInput('09:30:00')).toBe('09:30');
    expect(normalizeTimeForInput('invalid')).toBeNull();
  });

  it('builds one exact seven-day payload and refetches after an atomic RPC error', async () => {
    const schedule = buildWeeklySchedule([
      { id: 'monday', weekday: 1, start_time: '09:00', end_time: '17:00', buffer_minutes: 15 },
    ]);
    expect(schedule).toHaveLength(7);
    expect(schedule[0]).toEqual({ weekday: 0, enabled: false, startTime: null, endTime: null, bufferMinutes: 0 });
    expect(schedule[1]).toEqual({ weekday: 1, enabled: true, startTime: '09:00', endTime: '17:00', bufferMinutes: 15 });

    let calls = 0;
    let refetches = 0;
    await saveWeeklySchedule(
      schedule,
      async () => { refetches += 1; },
      async () => { calls += 1; return { error: null }; },
    );
    expect(calls).toBe(1);
    expect(refetches).toBe(0);

    calls = 0;
    await expect(saveWeeklySchedule(
      schedule,
      async () => { refetches += 1; },
      async () => { calls += 1; return { error: new Error('provider detail') }; },
    )).rejects.toThrow('Unable to save the weekly schedule.');
    expect(calls).toBe(1);
    expect(refetches).toBe(1);
  });

  it('lets only the latest selected-date response update state', async () => {
    const gate = createLatestRequestGate();
    let resolveFirst!: (value: string) => void;
    const first = new Promise<string>((resolvePromise) => { resolveFirst = resolvePromise; });
    const firstToken = gate.begin();
    const secondToken = gate.begin();
    const applied: string[] = [];
    const firstApply = first.then((value) => gate.isLatest(firstToken) && applied.push(value));
    if (gate.isLatest(secondToken)) applied.push('second');
    resolveFirst('first');
    await firstApply;
    expect(applied).toEqual(['second']);
  });
});

describe('signup confirmation branch', () => {
  it('routes an immediate session to the dashboard and a pending confirmation to verification', () => {
    expect(getPostSignupDestination(true)).toBe('/dashboard');
    expect(getPostSignupDestination(false)).toBe('/email-verification');
  });
});

describe('time-zone date handling', () => {
  it('keeps date keys explicit across Halifax and Tokyo', () => {
    const instant = new Date('2026-08-20T01:30:00.000Z');
    expect(getDateKeyInTimeZone(instant, 'America/Halifax')).toBe('2026-08-19');
    expect(getDateKeyInTimeZone(instant, 'Asia/Tokyo')).toBe('2026-08-20');
  });

  it('handles UTC+14 and UTC-10 crossing the international date line', () => {
    const instant = new Date('2026-01-01T08:30:00.000Z');
    expect(getDateKeyInTimeZone(instant, 'Pacific/Kiritimati')).toBe('2026-01-01');
    expect(getDateKeyInTimeZone(instant, 'Pacific/Honolulu')).toBe('2025-12-31');
  });

  it('round-trips host date keys through a noon calendar proxy', () => {
    const proxy = dateKeyToCalendarDate('2026-03-08');
    expect(proxy.getHours()).toBe(12);
    expect(calendarDateToDateKey(proxy)).toBe('2026-03-08');
  });

  it('shows the Halifax daylight-saving offset in slot labels', () => {
    const winter = formatSlotTime('2026-01-15T16:00:00.000Z', 'America/Halifax');
    const summer = formatSlotTime('2026-07-15T15:00:00.000Z', 'America/Halifax');
    expect(winter).toMatch(/AST|GMT-4|UTC-4/);
    expect(summer).toMatch(/ADT|GMT-3|UTC-3/);
  });
});

describe('host dashboard time-zone grouping', () => {
  it('groups one instant under the host profile date rather than the browser date', () => {
    const booking = new Date('2026-08-20T01:00:00.000Z');
    expect(getDashboardDateKey(booking, 'America/Halifax')).toBe('2026-08-19');
    expect(getDashboardDateKey(booking, 'Asia/Tokyo')).toBe('2026-08-20');
  });

  it('defines upcoming by the actual start instant on the same host date', () => {
    const past = new Date('2026-08-20T11:00:00.000Z');
    const future = new Date('2026-08-20T13:00:00.000Z');
    const now = new Date('2026-08-20T12:00:00.000Z');
    expect(bookingMatchesFilter(past, 'upcoming', 'America/Halifax', now)).toBe(false);
    expect(bookingMatchesFilter(future, 'upcoming', 'America/Halifax', now)).toBe(true);
    expect(canCancelBooking('confirmed', past, now)).toBe(false);
    expect(canCancelBooking('confirmed', future, now)).toBe(true);
    expect(canCancelBooking('cancelled', future, now)).toBe(false);
  });
});

describe('booking UI contract', () => {
  const srcRoot = resolve(process.cwd(), 'src');
  const source = (relativePath: string) =>
    readFileSync(resolve(srcRoot, relativePath), 'utf8');

  it('does not promise that a booking email was sent', () => {
    const successSource = source('components/booking/BookingSuccess.tsx');
    expect(successSource).toContain('Booking confirmed');
    expect(successSource).not.toMatch(/email|inbox|sent/i);
  });

  it('uses button controls for meeting types and time slots', () => {
    const meetingTypes = source('components/booking/MeetingTypeList.tsx');
    const timeSlots = source('components/TimeSlotPicker.tsx');
    expect(meetingTypes).toMatch(/<button[\s\S]*type="button"/);
    expect(timeSlots).toMatch(/<Button[\s\S]*type="button"/);
  });

  it('uses the immutable meeting-title snapshot and shows owner-only guest notes', () => {
    const bookingsSource = source('hooks/useBookingsData.tsx');
    const detailsSource = source('components/dashboard/BookingDetailsDialog.tsx');
    expect(bookingsSource).toContain('meeting_type_title');
    expect(bookingsSource).not.toContain('meeting_type:meeting_types');
    expect(detailsSource).toContain('Guest notes');
    expect(detailsSource).toContain('whitespace-pre-wrap');
  });
});
