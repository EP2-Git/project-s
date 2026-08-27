import { useMutation, useQueryClient } from '@tanstack/react-query';
import { publicBookingService } from '@/services/publicBookingService';
import type { CreatePublicBookingRequest } from '@/types/publicBooking';

export const useCreatePublicBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreatePublicBookingRequest) =>
      publicBookingService.create(request),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['public-free-slots'] }),
  });
};
