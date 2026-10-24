import { z } from 'zod';
import { withContractObjectInput } from '@project-s/contracts';
import { ianaTimeZoneSchema } from './publicBooking';
import { formString } from './formValidation';
import { signupUsernameSchema } from './signupForm';

export const personalInfoFormSchema = withContractObjectInput(z.object({
  username: signupUsernameSchema,
  fullName: formString({
    trim: true, minLength: 2, maxLength: 120,
    minMessage: 'Full name must be at least 2 characters.',
    maxMessage: 'Full name cannot exceed 120 characters.',
  }),
  timezone: ianaTimeZoneSchema,
}));

export type PersonalInfoFormValues = z.infer<typeof personalInfoFormSchema>;
