
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import TimeZoneSelect from '@/components/common/TimeZoneSelect';
import { ianaTimeZoneSchema } from '@/types/publicBooking';
import { isUsernameAvailable } from '@/services/usernameService';

const formSchema = z.object({
  username: z.string()
    .min(3, { message: 'Username must be at least 3 characters.' })
    .max(30, { message: 'Username cannot exceed 30 characters.' })
    .regex(/^[a-z0-9][a-z0-9_-]{2,29}$/, {
      message: 'Use lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.',
    }),
  fullName: z.string().trim().min(2, { message: 'Full name must be at least 2 characters.' }).max(120, { message: 'Full name cannot exceed 120 characters.' }),
  timezone: ianaTimeZoneSchema,
});

export type PersonalInfoFormValues = z.infer<typeof formSchema>;

interface PersonalInfoFormProps {
  userId: string;
  initialValues: {
    username: string;
    fullName: string;
    timezone: string;
  };
  originalUsername: string;
  onSuccess: (username: string) => void;
}

const PersonalInfoForm: React.FC<PersonalInfoFormProps> = ({
  userId,
  initialValues,
  originalUsername,
  onSuccess
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);

  const form = useForm<PersonalInfoFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialValues,
  });

  const checkUsernameAvailability = async (username: string): Promise<boolean> => {
    if (username === originalUsername) {
      return true;
    }

    try {
      setIsCheckingUsername(true);
      return await isUsernameAvailable(username);
    } catch {
      return false;
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const handleUsernameBlur = async (username: string) => {
    if (username.length >= 3 && username !== originalUsername) {
      const isAvailable = await checkUsernameAvailability(username);
      if (!isAvailable) {
        form.setError('username', {
          type: 'manual',
          message: 'This username is already taken. Please choose another one.'
        });
      }
    }
  };

  const onSubmit = async (values: PersonalInfoFormValues) => {
    if (!userId) return;

    try {
      setIsLoading(true);

      const username = values.username.toLowerCase();

      if (username !== originalUsername) {
        const isAvailable = await checkUsernameAvailability(username);
        if (!isAvailable) {
          form.setError('username', {
            type: 'manual',
            message: 'This username is already taken. Please choose another one.'
          });
          setIsLoading(false);
          return;
        }
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          username,
          full_name: values.fullName.trim(),
          timezone: values.timezone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) throw error;

      onSuccess(username);
      toast.success('Profile updated successfully');
    } catch {
      toast.error('Failed to update profile. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
        <CardDescription>
          Update your profile information visible to others
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Example Person" className="bg-background" maxLength={120} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="johndoe"
                      className="bg-background"
                      {...field}
                      onBlur={() => handleUsernameBlur(field.value)}
                      onChange={(e) => {
                        field.onChange(e.target.value.toLowerCase());
                        if (form.formState.errors.username) {
                          form.clearErrors('username');
                        }
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <TimeZoneSelect
                    id="profile-time-zone"
                    value={field.value}
                    onChange={field.onChange}
                  />
                  <p className="text-sm text-muted-foreground">
                    Availability and booking windows use this time zone.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="pt-4">
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={isLoading || isCheckingUsername || !form.formState.isDirty}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default PersonalInfoForm;
