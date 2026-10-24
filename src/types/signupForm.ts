import { z } from 'zod';
import { withContractObjectInput } from '@project-s/contracts';
import { formEmailPattern, formString } from './formValidation';

export const signupUsernameSchema = formString({
  minLength: 3, maxLength: 30,
  minMessage: 'Username must be at least 3 characters.',
  maxMessage: 'Username cannot exceed 30 characters.',
})
  .regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, {
    message: 'Use lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.',
  });

export const signupFormSchema = withContractObjectInput(z.object({
  fullName: formString({
    trim: true, minLength: 2, maxLength: 120,
    minMessage: 'Full name must be at least 2 characters.',
    maxMessage: 'Full name cannot exceed 120 characters.',
  }),
  email: formString({
    trim: true, maxLength: 320, maxMessage: 'Email cannot exceed 320 characters.',
  }).regex(formEmailPattern, 'Please enter a valid email address.'),
  username: signupUsernameSchema,
  password: formString({
    minLength: 6, minMessage: 'Password must be at least 6 characters.',
  }),
}));

export type SignupFormValues = z.infer<typeof signupFormSchema>;
