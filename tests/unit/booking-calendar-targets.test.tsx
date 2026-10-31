import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DateSelection from '@/components/booking/DateSelection';
import { getDateKeyInTimeZone } from '@/lib/time';
import { enabledCalendarDaySelector, nextMondayTarget } from '../helpers/booking-calendar-target';

describe('booking proof calendar selection', () => {
  it.each([
    ['2026-10-25', '2026-10-26', false],
    ['2026-10-26', '2026-11-02', true],
    ['2026-10-30', '2026-11-02', true],
    ['2026-10-31', '2026-11-02', true],
    ['2026-11-01', '2026-11-02', false],
    ['2026-12-31', '2027-01-04', true],
    ['2028-02-29', '2028-03-06', true],
  ])('selects the next saved Monday after %s through the actual calendar', (today, monday, advanceMonth) => {
    const onSelect = vi.fn();
    const target = nextMondayTarget(today);
    expect(target).toEqual({ dateKey: monday, day: Number(monday.slice(-2)), advanceMonth });
    expect(target.dateKey > today).toBe(true);
    const { container } = render(
      <DateSelection
        selectedDate={today}
        minDate={today}
        maxDate={`${Number(today.slice(0, 4)) + 1}-12-31`}
        onSelectDate={onSelect}
      />,
    );
    if (target.advanceMonth) {
      fireEvent.click(screen.getByRole('button', { name: /go to next month/i }));
    }
    const candidates = [...container.querySelectorAll<HTMLButtonElement>(enabledCalendarDaySelector)]
      .filter((button) => button.textContent === String(target.day));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toBeEnabled();
    fireEvent.click(candidates[0]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(monday);
  });

  it.each([
    ['UTC', '2026-11-01', false],
    ['America/Halifax', '2026-10-31', true],
  ])('uses the displayed date at the same instant in %s', (displayTimeZone, today, advanceMonth) => {
    const displayedDate = getDateKeyInTimeZone('2026-11-01T02:00:00.000Z', displayTimeZone);
    expect(displayedDate).toBe(today);
    const target = nextMondayTarget(displayedDate);
    expect(target).toEqual({ dateKey: '2026-11-02', day: 2, advanceMonth });
    const onSelect = vi.fn();
    const { container } = render(
      <DateSelection
        selectedDate={displayedDate}
        minDate={displayedDate}
        maxDate="2026-12-31"
        onSelectDate={onSelect}
      />,
    );
    if (target.advanceMonth) {
      fireEvent.click(screen.getByRole('button', { name: /go to next month/i }));
    }
    const monday = [...container.querySelectorAll<HTMLButtonElement>(enabledCalendarDaySelector)]
      .filter((button) => button.textContent === '2');
    expect(monday).toHaveLength(1);
    fireEvent.click(monday[0]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('2026-11-02');
  });
});
