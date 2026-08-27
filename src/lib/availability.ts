import type { SpecificDateAvailability } from '@/hooks/useSpecificDateAvailability';
import type { Availability } from '@/types/booking';

export const isValidTimeWindow = (startTime: string, endTime: string) =>
  /^\d{2}:\d{2}$/.test(startTime) && /^\d{2}:\d{2}$/.test(endTime) && startTime < endTime;

export const normalizeTimeForInput = (value: string | null | undefined) => {
  if (!value || !/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return null;
  return value.slice(0, 5);
};

export const createLatestRequestGate = () => {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isLatest: (token: number) => token === latest,
  };
};

export const buildSpecificDateWritePlan = (
  authUserId: string,
  data: Omit<SpecificDateAvailability, 'id'>,
) => {
  const date = data.date.split('T')[0];
  if (data.status === 'default') {
    return { operation: 'delete' as const, userId: authUserId, date };
  }

  return {
    operation: 'upsert' as const,
    row: {
      user_id: authUserId,
      date,
      start_time: data.status === 'available' ? (data.startTime ?? data.start_time) : null,
      end_time: data.status === 'available' ? (data.endTime ?? data.end_time) : null,
      buffer_minutes: data.status === 'available' ? (data.bufferMinutes ?? data.buffer_minutes ?? 0) : 0,
      status: data.status,
      note: data.note ?? null,
    },
  };
};

export type WeeklyScheduleDay = {
  weekday: number;
  enabled: boolean;
  startTime: string | null;
  endTime: string | null;
  bufferMinutes: number;
};

export type WeeklySchedule = WeeklyScheduleDay[];

export const buildWeeklySchedule = (availabilities: Availability[]): WeeklySchedule =>
  Array.from({ length: 7 }, (_, weekday) => {
    const availability = availabilities.find((item) => item.weekday === weekday);
    return availability
      ? {
          weekday,
          enabled: true,
          startTime: normalizeTimeForInput(availability.start_time),
          endTime: normalizeTimeForInput(availability.end_time),
          bufferMinutes: availability.buffer_minutes ?? 0,
        }
      : {
          weekday,
          enabled: false,
          startTime: null,
          endTime: null,
          bufferMinutes: 0,
        };
  });
