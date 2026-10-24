import { z } from 'zod';
import { projectSValidationError, withContractObjectInput } from '@project-s/contracts';
import { formEmailPattern, formString } from './formValidation';

export const bookingFormSchema = withContractObjectInput(z.object({
  name: formString({
    trim: true, minLength: 2, maxLength: 120,
    minMessage: 'Name must be at least 2 characters.',
  }),
  email: formString({ trim: true })
    .regex(formEmailPattern, 'Enter a valid email address.')
    .check((context) => {
      if (context.value.length > 320) {
        context.issues.push({
          code: 'too_big', origin: 'string', maximum: 320, inclusive: true, input: context.value,
          message: 'String must contain at most 320 character(s)',
        });
      }
    }),
  notes: formString({
    trim: true, maxLength: 2000, maxMessage: 'Notes cannot exceed 2,000 characters.',
  }),
  terms: z.boolean({ error: projectSValidationError }).refine((value) => value, {
    message: 'You must accept the terms and privacy notice.',
  }),
}));

export type BookingFormValues = z.infer<typeof bookingFormSchema>;
