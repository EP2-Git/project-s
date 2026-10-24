import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { isUsernameAvailable } from '@/services/usernameService';
import { getPostSignupDestination } from '@/lib/auth';
import {
  signupFormSchema,
  signupUsernameSchema,
  type SignupFormValues,
} from '@/types/signupForm';
export type { SignupFormValues } from '@/types/signupForm';

export function useSignupForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isUsernameTaken, setIsUsernameTaken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      fullName: '',
      email: '',
      username: '',
      password: '',
    },
    mode: 'onChange',
  });

  const usernameValue = form.watch('username');

  useEffect(() => {
    if (!signupUsernameSchema.safeParse(usernameValue).success) {
      setIsCheckingUsername(false);
      setIsUsernameTaken(false);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setIsCheckingUsername(true);
      let available: boolean;
      try {
        available = await isUsernameAvailable(usernameValue);
      } catch {
        if (active) setIsCheckingUsername(false);
        return;
      }
      if (!active) return;

      setIsCheckingUsername(false);
      const taken = !available;
      setIsUsernameTaken(taken);
      if (taken) {
        form.setError('username', {
          type: 'manual',
          message: 'This username is already taken. Please choose another one.',
        });
      }
    }, 500);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form, usernameValue]);

  const onSubmit = async (values: SignupFormValues) => {
    setFormError(null);
    setIsLoading(true);

    try {
      const username = values.username.toLowerCase();
      const usernameAvailable = await isUsernameAvailable(username);
      if (!usernameAvailable) {
        setIsUsernameTaken(true);
        form.setError('username', {
          type: 'manual',
          message: 'This username is already taken. Please choose another one.',
        });
        return;
      }

      const normalizedEmail = values.email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: values.password,
        options: {
          data: {
            full_name: values.fullName.trim(),
            username,
          },
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;

      const destination = getPostSignupDestination(Boolean(data.session));
      if (destination === '/dashboard') {
        toast.success('Account created. You are signed in.');
        navigate(destination);
      } else {
        toast.success('Account created. Your deployment requires email verification.');
        navigate(destination, { state: { email: normalizedEmail } });
      }
    } catch {
      setFormError('Failed to create account. Check your details and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isSubmitDisabled =
    isLoading ||
    isCheckingUsername ||
    isUsernameTaken ||
    !form.formState.isValid ||
    Object.keys(form.formState.errors).length > 0;

  return {
    form,
    isLoading,
    isCheckingUsername,
    formError,
    isSubmitDisabled,
    handleFormSubmit: form.handleSubmit(onSubmit),
    clearUsernameError: () => {
      setIsUsernameTaken(false);
      form.clearErrors('username');
    },
  };
}
