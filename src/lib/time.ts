import {
  ianaTimeZoneSchema,
  type IanaTimeZone,
  type IsoInstant,
  type LocalDate,
} from '@/types/publicBooking';

export const resolveIanaTimeZone = (value: string | null | undefined): IanaTimeZone => {
  const parsed = ianaTimeZoneSchema.safeParse(value);
  return parsed.success ? parsed.data : 'UTC';
};

export const getBrowserTimeZone = (): IanaTimeZone =>
  resolveIanaTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

export const getDateKeyInTimeZone = (
  value: Date | IsoInstant,
  timeZone: IanaTimeZone,
): LocalDate => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;

  return `${part('year')}-${part('month')}-${part('day')}` as LocalDate;
};

export const dateKeyToCalendarDate = (dateKey: LocalDate): Date => {
  const [year, month, day] = dateKey.split('-').map(Number);
  // Noon avoids browser/DST transitions while the Date acts only as a calendar UI proxy.
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

export const calendarDateToDateKey = (date: Date): LocalDate => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as LocalDate;
};

export const addDaysToDateKey = (dateKey: LocalDate, days: number): LocalDate => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10) as LocalDate;
};

export const formatDateKey = (
  dateKey: LocalDate,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  },
) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
};

export const formatInstant = (
  instant: IsoInstant,
  timeZone: IanaTimeZone,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone,
  }).format(new Date(instant));

export const formatSlotTime = (instant: IsoInstant, timeZone: IanaTimeZone) =>
  formatInstant(instant, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

export const formatSlotDateTime = (
  instant: IsoInstant,
  timeZone: IanaTimeZone,
) =>
  formatInstant(instant, timeZone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

export const listSupportedTimeZones = (): IanaTimeZone[] => {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  const browserZone = getBrowserTimeZone();
  const zones = intl.supportedValuesOf?.('timeZone') ?? ['UTC'];
  return Array.from(new Set([browserZone, 'UTC', ...zones])).sort();
};
