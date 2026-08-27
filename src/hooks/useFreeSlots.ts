import { useQuery } from '@tanstack/react-query';
import { publicBookingService } from '@/services/publicBookingService';
import type { IanaTimeZone, LocalDate } from '@/types/publicBooking';

interface UseFreeSlotsInput {
  username?: string;
  meetingTypeId?: string;
  date?: LocalDate;
  displayTimeZone: IanaTimeZone;
}

export const freeSlotsQueryKey = (input: UseFreeSlotsInput) => [
  'public-free-slots',
  input.username,
  input.meetingTypeId,
  input.date,
  input.displayTimeZone,
];

export const useFreeSlots = (input: UseFreeSlotsInput) =>
  useQuery({
    queryKey: freeSlotsQueryKey(input),
    queryFn: () =>
      publicBookingService.listFreeSlots({
        username: input.username!,
        meetingTypeId: input.meetingTypeId!,
        date: input.date!,
        displayTimeZone: input.displayTimeZone,
      }),
    enabled: Boolean(input.username && input.meetingTypeId && input.date),
    staleTime: 15_000,
    retry: 1,
  });
