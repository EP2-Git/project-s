
import React from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { UseFormReturn } from 'react-hook-form';
import { SignupFormValues } from '@/hooks/useSignupForm';

interface EmailFieldProps {
  form: UseFormReturn<SignupFormValues>;
}

const EmailField: React.FC<EmailFieldProps> = ({ form }) => {
  return (
    <FormField
      control={form.control}
      name="email"
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel className={fieldState.error ? 'text-red-700 dark:text-red-300' : undefined}>Email</FormLabel>
          <FormControl>
            <Input
              type="email"
              placeholder="you@example.invalid"
              autoComplete="email"
              maxLength={320}
              {...field}
            />
          </FormControl>
          <FormMessage className="text-red-700 dark:text-red-300" />
        </FormItem>
      )}
    />
  );
};

export default EmailField;
