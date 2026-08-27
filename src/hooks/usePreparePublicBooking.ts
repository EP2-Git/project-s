import { useMutation } from '@tanstack/react-query';
import { publicBookingService } from '@/services/publicBookingService';
import type { PreparePublicBookingRequest } from '@/types/publicBooking';

export const usePreparePublicBooking = () =>
  useMutation({
    mutationFn: (request: PreparePublicBookingRequest) =>
      publicBookingService.prepare(request),
  });
