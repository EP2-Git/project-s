import { useQuery } from '@tanstack/react-query';
import { publicBookingService } from '@/services/publicBookingService';

export const usePublicBookingPage = (username: string | undefined) =>
  useQuery({
    queryKey: ['public-booking-page', username],
    queryFn: () => publicBookingService.getPage(username!),
    enabled: Boolean(username),
    staleTime: 60_000,
    retry: 1,
  });
