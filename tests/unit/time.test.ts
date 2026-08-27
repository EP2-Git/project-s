import { describe, expect, it } from "vitest";

import {
  addDaysToDateKey,
  calendarDateToDateKey,
  dateKeyToCalendarDate,
  formatDateKey,
  formatInstant,
  formatSlotDateTime,
  formatSlotTime,
  getBrowserTimeZone,
  getDateKeyInTimeZone,
  listSupportedTimeZones,
} from "@/lib/time";
import type {
  IanaTimeZone,
  IsoInstant,
  LocalDate,
} from "@/types/publicBooking";

describe("timezone-safe display helpers", () => {
  it("derives date keys in the requested timezone", () => {
    const instant = "2026-01-01T02:30:00Z" as IsoInstant;

    expect(getDateKeyInTimeZone(instant, "UTC" as IanaTimeZone)).toBe(
      "2026-01-01",
    );
    expect(
      getDateKeyInTimeZone(instant, "America/Los_Angeles" as IanaTimeZone),
    ).toBe("2025-12-31");
    expect(
      getDateKeyInTimeZone(
        new Date("2026-01-01T02:30:00Z"),
        "UTC" as IanaTimeZone,
      ),
    ).toBe("2026-01-01");
  });

  it("round-trips calendar-only dates at local noon", () => {
    const key = "2026-03-08" as LocalDate;
    const calendarDate = dateKeyToCalendarDate(key);

    expect(calendarDate.getHours()).toBe(12);
    expect(calendarDateToDateKey(calendarDate)).toBe(key);
  });

  it("adds days in UTC across month, year, and leap-day boundaries", () => {
    expect(addDaysToDateKey("2024-02-28" as LocalDate, 1)).toBe("2024-02-29");
    expect(addDaysToDateKey("2024-02-28" as LocalDate, 2)).toBe("2024-03-01");
    expect(addDaysToDateKey("2025-01-01" as LocalDate, -1)).toBe("2024-12-31");
  });

  it("formats calendar dates and instants with explicit timezone behavior", () => {
    const dateOptions: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const instantOptions: Intl.DateTimeFormatOptions = {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    };

    expect(formatDateKey("2026-08-19" as LocalDate, dateOptions)).toBe(
      new Intl.DateTimeFormat(undefined, {
        ...dateOptions,
        timeZone: "UTC",
      }).format(new Date(Date.UTC(2026, 7, 19, 12))),
    );
    expect(
      formatInstant(
        "2026-08-19T14:30:00Z" as IsoInstant,
        "UTC" as IanaTimeZone,
        instantOptions,
      ),
    ).toBe(
      new Intl.DateTimeFormat(undefined, {
        ...instantOptions,
        timeZone: "UTC",
      }).format(new Date("2026-08-19T14:30:00Z")),
    );
  });

  it("produces human-readable slot labels", () => {
    const instant = "2026-08-19T14:30:00Z" as IsoInstant;
    const zone = "America/Halifax" as IanaTimeZone;

    expect(formatSlotTime(instant, zone)).toMatch(/11:30/);
    expect(formatSlotDateTime(instant, zone)).toContain("2026");
  });

  it("returns a sorted, unique timezone list including UTC and the browser zone", () => {
    const browserZone = getBrowserTimeZone();
    const zones = listSupportedTimeZones();

    expect(browserZone.length).toBeGreaterThan(0);
    expect(zones).toContain("UTC");
    expect(zones).toContain(browserZone);
    expect(zones).toEqual([...new Set(zones)].sort());
  });
});
