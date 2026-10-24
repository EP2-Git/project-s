import { z } from 'zod';
import { contractNumber, uuidSchema, withContractObjectInput } from '@project-s/contracts';
import { isoInstantSchema } from '@/types/publicBooking';

export const cancelBookingResponseSchema = withContractObjectInput(z
  .object({
    bookingId: uuidSchema,
    status: z.literal('cancelled'),
    version: contractNumber({ integer: true }).refine((value) => value > 0, {
      message: 'Number must be greater than 0',
    }),
    canceledAt: isoInstantSchema.nullable(),
  })
  .strict());

export type CancelBookingResponse = z.infer<typeof cancelBookingResponseSchema>;
