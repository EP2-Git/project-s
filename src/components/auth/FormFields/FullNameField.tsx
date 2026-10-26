
import React from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { UseFormReturn } from 'react-hook-form';
import { SignupFormValues } from '@/hooks/useSignupForm';

interface FullNameFieldProps {
  form: UseFormReturn<SignupFormValues>;
}

const FullNameField: React.FC<FullNameFieldProps> = ({ form }) => {
  return (
    <FormField
      control={form.control}
      name="fullName"
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel className={fieldState.error ? 'text-red-700 dark:text-red-300' : undefined}>Full Name</FormLabel>
          <FormControl>
            <Input placeholder="Example Person" autoComplete="name" maxLength={120} {...field} />
          </FormControl>
          <FormMessage className="text-red-700 dark:text-red-300" />
        </FormItem>
      )}
    />
  );
};

export default FullNameField;
