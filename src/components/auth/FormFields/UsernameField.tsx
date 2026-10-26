
import React from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { UseFormReturn } from 'react-hook-form';
import { SignupFormValues } from '@/hooks/useSignupForm';

interface UsernameFieldProps {
  form: UseFormReturn<SignupFormValues>;
  isCheckingUsername: boolean;
  clearUsernameError: () => void;
}

const UsernameField: React.FC<UsernameFieldProps> = ({
  form,
  isCheckingUsername,
  clearUsernameError
}) => {
  return (
    <FormField
      control={form.control}
      name="username"
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel className={fieldState.error ? 'text-red-700 dark:text-red-300' : undefined}>Username</FormLabel>
          <FormControl>
            <Input
              placeholder="johndoe"
              autoComplete="username"
              {...field}
              onChange={(e) => {
                field.onChange(e.target.value.toLowerCase());
                clearUsernameError();
              }}
            />
          </FormControl>
          {isCheckingUsername && <p role="status" className="text-xs text-muted-foreground mt-1">Checking username...</p>}
          <FormMessage className="text-red-700 dark:text-red-300" />
        </FormItem>
      )}
    />
  );
};

export default UsernameField;
