import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBookingSetup } from '@/hooks/useBookingSetup';
import * as setupService from '@/services/bookingSetupService';

type Row = Record<string, unknown>;
type Query = {
  table: string;
  columns: string;
  filters: Array<[string, string, unknown]>;
  limit: number | null;
  signal?: AbortSignal;
  single: boolean;
};

const database = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  errors: new Set<string>(),
  queries: [] as Query[],
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const query: Query = {
        table, columns: '', filters: [], limit: null, single: false,
      };
      database.queries.push(query);
      const builder = {
        select: (columns: string) => { query.columns = columns; return builder; },
        eq: (column: string, value: unknown) => {
          query.filters.push(['eq', column, value]); return builder;
        },
        gte: (column: string, value: unknown) => {
          query.filters.push(['gte', column, value]); return builder;
        },
        limit: (count: number) => { query.limit = count; return builder; },
        maybeSingle: () => { query.single = true; return builder; },
        abortSignal: (signal: AbortSignal) => { query.signal = signal; return builder; },
        then: (resolve: (value: unknown) => unknown) => {
          const rows = (database.rows[table] ?? []).filter((row) =>
            query.filters.every(([op, column, value]) =>
              op === 'eq' ? row[column] === value : String(row[column]) >= String(value),
            ),
          );
          const limited = query.limit === null ? rows : rows.slice(0, query.limit);
          return Promise.resolve(resolve({
            data: query.single ? (limited[0] ?? null) : limited,
            error: database.errors.has(table) ? { message: 'private backend detail' } : null,
          }));
        },
      };
      return builder;
    },
  },
}));

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const now = () => new Date('2026-10-25T02:00:00.000Z');
const saved = {
  username: 'new-host', timezone: 'America/Halifax', profileComplete: true,
  meetingTypeComplete: true, availabilityComplete: true,
};

beforeEach(() => {
  database.rows = {
    profiles: [{ id: owner, username: 'new-host', timezone: 'America/Halifax' }],
    meeting_types: [{ id: 'meeting', user_id: owner, active: true }],
    availabilities: [{ id: 'weekly', user_id: owner }],
    specific_date_availabilities: [],
  };
  database.errors.clear();
  database.queries = [];
});

afterEach(() => vi.restoreAllMocks());

describe('saved booking setup reads', () => {
  it('reads only minimal owner-scoped saved configuration, regardless of account age', async () => {
    expect(await setupService.fetchBookingSetup(owner, { now })).toEqual(saved);
    expect(database.queries).toEqual([
      { table: 'profiles', columns: 'username, timezone', filters: [['eq', 'id', owner]], limit: null, single: true },
      { table: 'meeting_types', columns: 'id', filters: [['eq', 'user_id', owner], ['eq', 'active', true]], limit: 1, single: false },
      { table: 'availabilities', columns: 'id', filters: [['eq', 'user_id', owner]], limit: 1, single: false },
    ]);
  });

  it('reports missing profile and setup without inventing defaults', async () => {
    database.rows = {};
    expect(await setupService.fetchBookingSetup(owner, { now })).toEqual({
      username: null, timezone: null, profileComplete: false,
      meetingTypeComplete: false, availabilityComplete: false,
    });
  });

  it('does not count inactive meeting types or another account’s saved configuration', async () => {
    database.rows.meeting_types = [
      { id: 'inactive', user_id: owner, active: false },
      { id: 'other', user_id: otherOwner, active: true },
    ];
    database.rows.availabilities = [{ id: 'other-weekly', user_id: otherOwner }];
    database.rows.specific_date_availabilities = [
      { id: 'other-date', user_id: otherOwner, status: 'available', date: '2026-10-25' },
    ];
    expect(await setupService.fetchBookingSetup(owner, { now })).toMatchObject({
      profileComplete: true, meetingTypeComplete: false, availabilityComplete: false,
    });
  });

  it.each([null, '', 'Not/AZone'])('does not replace missing or invalid timezone %s with UTC', async (timezone) => {
    database.rows.profiles[0].timezone = timezone;
    database.rows.availabilities = [];
    database.rows.specific_date_availabilities = [
      { id: 'future', user_id: owner, status: 'available', date: '2026-10-26' },
    ];
    expect(await setupService.fetchBookingSetup(owner, { now })).toMatchObject({
      username: 'new-host', timezone: null, profileComplete: false, availabilityComplete: false,
    });
    expect(database.queries.some(({ table }) => table === 'specific_date_availabilities')).toBe(false);
  });

  it.each([null, 'bad/name', 'ab', 'UPPER'])('does not expose an invalid booking-link username %s', async (username) => {
    database.rows.profiles[0].username = username;
    expect(await setupService.fetchBookingSetup(owner, { now })).toMatchObject({
      username: null, profileComplete: false,
    });
  });

  it('counts today in the saved host timezone, even when the UTC date has advanced', async () => {
    database.rows.availabilities = [];
    database.rows.specific_date_availabilities = [
      { id: 'today', user_id: owner, status: 'available', date: '2026-10-24' },
    ];
    expect(await setupService.fetchBookingSetup(owner, { now })).toEqual(saved);
    expect(database.queries.at(-1)).toEqual({
      table: 'specific_date_availabilities', columns: 'id',
      filters: [['eq', 'user_id', owner], ['eq', 'status', 'available'], ['gte', 'date', '2026-10-24']],
      limit: 1, single: false,
    });
  });

  it('does not count expired dates or unavailable/default overrides as saved available hours', async () => {
    database.rows.availabilities = [];
    database.rows.specific_date_availabilities = [
      { id: 'past', user_id: owner, status: 'available', date: '2026-10-23' },
      { id: 'closed', user_id: owner, status: 'unavailable', date: '2026-10-25' },
      { id: 'default', user_id: owner, status: 'default', date: '2026-10-26' },
    ];
    expect(await setupService.fetchBookingSetup(owner, { now })).toMatchObject({ availabilityComplete: false });
    database.rows.specific_date_availabilities.push(
      { id: 'future', user_id: owner, status: 'available', date: '2026-10-25' },
    );
    expect(await setupService.fetchBookingSetup(owner, { now })).toMatchObject({ availabilityComplete: true });
  });

  it.each(['profiles', 'meeting_types', 'availabilities', 'specific_date_availabilities'])(
    'treats a %s read error as unknown and redacts backend details', async (table) => {
      database.rows.availabilities = [];
      database.errors.add(table);
      await expect(setupService.fetchBookingSetup(owner, { now })).rejects.toThrow(
        'Could not check your saved setup.',
      );
    },
  );

  it('forwards one cancellation signal to every attempted read', async () => {
    database.rows.availabilities = [];
    const controller = new AbortController();
    await setupService.fetchBookingSetup(owner, { now, signal: controller.signal });
    expect(database.queries).toHaveLength(4);
    expect(database.queries.every((query) => query.signal === controller.signal)).toBe(true);
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('booking setup request ownership', () => {
  it('does not issue a request without an authenticated account id', () => {
    const fetch = vi.spyOn(setupService, 'fetchBookingSetup');
    const { result } = renderHook(() => useBookingSetup(undefined));
    expect(result.current).toMatchObject({ status: 'loading', username: null, profileComplete: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the old account link on account change and ignores its late result', async () => {
    const first = deferred<setupService.BookingSetupSnapshot>();
    const second = deferred<setupService.BookingSetupSnapshot>();
    const fetch = vi.spyOn(setupService, 'fetchBookingSetup')
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ userId }) => useBookingSetup(userId), {
      initialProps: { userId: owner },
    });
    expect(result.current.status).toBe('loading');
    const oldSignal = fetch.mock.calls[0][1]?.signal;
    rerender({ userId: otherOwner });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ status: 'loading', username: null, timezone: null });
    await act(async () => first.resolve(saved));
    expect(result.current).toMatchObject({ status: 'loading', username: null });
    await act(async () => second.resolve({ ...saved, username: 'other-host' }));
    expect(result.current).toMatchObject({ status: 'loaded', username: 'other-host' });
  });

  it('does not retain the previous account’s completed result while the new account loads', async () => {
    const pending = deferred<setupService.BookingSetupSnapshot>();
    vi.spyOn(setupService, 'fetchBookingSetup')
      .mockResolvedValueOnce(saved).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ userId }) => useBookingSetup(userId), {
      initialProps: { userId: owner },
    });
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    rerender({ userId: otherOwner });
    expect(result.current).toMatchObject({
      status: 'loading', username: null, timezone: null,
      profileComplete: false, meetingTypeComplete: false, availabilityComplete: false,
    });
  });

  it('refresh clears stale success, cancels the old request and ignores out-of-order completion', async () => {
    const oldRequest = deferred<setupService.BookingSetupSnapshot>();
    const freshRequest = deferred<setupService.BookingSetupSnapshot>();
    const fetch = vi.spyOn(setupService, 'fetchBookingSetup')
      .mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(freshRequest.promise);
    const { result } = renderHook(() => useBookingSetup(owner));
    const oldSignal = fetch.mock.calls[0][1]?.signal;
    act(() => result.current.refresh());
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => freshRequest.resolve({ ...saved, availabilityComplete: false }));
    expect(result.current).toMatchObject({ status: 'loaded', availabilityComplete: false });
    await act(async () => oldRequest.resolve(saved));
    expect(result.current).toMatchObject({ status: 'loaded', availabilityComplete: false });
  });

  it('drops completed setup while retrying and exposes a safe error state on failure', async () => {
    const failed = deferred<setupService.BookingSetupSnapshot>();
    vi.spyOn(setupService, 'fetchBookingSetup')
      .mockResolvedValueOnce(saved).mockReturnValueOnce(failed.promise);
    const { result } = renderHook(() => useBookingSetup(owner));
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    act(() => result.current.refresh());
    expect(result.current).toMatchObject({ status: 'loading', username: null, profileComplete: false });
    await act(async () => failed.reject(new Error('private service failure')));
    expect(result.current).toMatchObject({
      status: 'error', username: null, timezone: null,
      profileComplete: false, meetingTypeComplete: false, availabilityComplete: false,
    });
    expect(JSON.stringify(result.current)).not.toContain('private');
  });

  it('cancels outstanding reads on unmount', () => {
    const pending = deferred<setupService.BookingSetupSnapshot>();
    const fetch = vi.spyOn(setupService, 'fetchBookingSetup').mockReturnValue(pending.promise);
    const { unmount } = renderHook(() => useBookingSetup(owner));
    const signal = fetch.mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
