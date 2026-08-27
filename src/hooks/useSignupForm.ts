import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { isUsernameAvailable } from '@/services/usernameService';
import { getPostSignupDestination } from '@/lib/auth';

const usernameSchema = z
  .string()
  .min(3, { message: 'Username must be at least 3 characters.' })
  .max(30, { message: 'Username cannot exceed 30 characters.' })
  .regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, {
    message: 'Use lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.',
  });

const formSchema = z.object({
  fullName: z.string().trim().min(2, { message: 'Full name must be at least 2 characters.' }).max(120, { message: 'Full name cannot exceed 120 characters.' }),
  email: z.string().trim().max(320, { message: 'Email cannot exceed 320 characters.' }).email({ message: 'Please enter a valid email address.' }),
  username: usernameSchema,
  password: z.string().min(6, { message: 'Password must be at least 6 characters.' }),
});

export type SignupFormValues = z.infer<typeof formSchema>;

export function useSignupForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isUsernameTaken, setIsUsernameTaken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const navigate = useNavigate();

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(formSchema),
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
    if (!usernameSchema.safeParse(usernameValue).success) {
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
