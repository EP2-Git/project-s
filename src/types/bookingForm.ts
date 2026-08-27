import { z } from 'zod';

export const bookingFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(320),
  notes: z.string().trim().max(2000, 'Notes cannot exceed 2,000 characters.'),
  terms: z.boolean().refine((value) => value, {
    message: 'You must accept the terms and privacy notice.',
  }),
});

export type BookingFormValues = z.infer<typeof bookingFormSchema>;
