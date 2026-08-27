import { z } from 'zod';
import { isoInstantSchema } from '@/types/publicBooking';

export const cancelBookingResponseSchema = z
  .object({
    bookingId: z.string().uuid(),
    status: z.literal('cancelled'),
    version: z.number().int().positive(),
    canceledAt: isoInstantSchema.nullable(),
  })
  .strict();

export type CancelBookingResponse = z.infer<typeof cancelBookingResponseSchema>;
