export const enabledCalendarDaySelector = 'button[name="day"]:not([disabled]):not(.day-outside)';

// A strictly future Monday avoids reselecting an already-selected, elapsed
// Monday and keeps the synthetic booking proof to one new slot-search request.
export const nextMondayTarget = (todayKey: string) => {
  const today = new Date(`${todayKey}T12:00:00.000Z`);
  const target = new Date(today);
  target.setUTCDate(today.getUTCDate() + ((1 - today.getUTCDay() + 7) % 7 || 7));
  return {
    dateKey: target.toISOString().slice(0, 10),
    day: target.getUTCDate(),
    advanceMonth: target.getUTCMonth() !== today.getUTCMonth()
      || target.getUTCFullYear() !== today.getUTCFullYear(),
  };
};
