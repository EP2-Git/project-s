
import React, { useState } from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage, useFormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { SignupFormValues } from '@/hooks/useSignupForm';

interface PasswordFieldProps {
  form: UseFormReturn<SignupFormValues>;
}

const PasswordToggle = ({ shown, onToggle }: { shown: boolean; onToggle: () => void }) => {
  const { formItemId } = useFormField();

  return (
    <button
      type="button"
      className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      aria-controls={formItemId}
      onClick={onToggle}
    >
      {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
    </button>
  );
};

const PasswordField: React.FC<PasswordFieldProps> = ({ form }) => {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <FormField
      control={form.control}
      name="password"
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel className={fieldState.error ? 'text-red-700 dark:text-red-300' : undefined}>Password</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="••••••••"
                autoComplete="new-password"
                className="h-11 pr-12"
                {...field}
              />
            </FormControl>
            <PasswordToggle shown={showPassword} onToggle={() => setShowPassword((shown) => !shown)} />
          </div>
          <FormDescription>Use at least 6 characters.</FormDescription>
          <FormMessage className="text-red-700 dark:text-red-300" />
        </FormItem>
      )}
    />
  );
};

export default PasswordField;
