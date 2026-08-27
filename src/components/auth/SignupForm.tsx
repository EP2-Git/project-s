
import React from 'react';
import { useSignupForm } from '@/hooks/useSignupForm';
import { Form } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import FullNameField from './FormFields/FullNameField';
import EmailField from './FormFields/EmailField';
import UsernameField from './FormFields/UsernameField';
import PasswordField from './FormFields/PasswordField';
import SubmitButton from './FormFields/SubmitButton';
import ErrorAlert from './FormFields/ErrorAlert';

const SignupForm = () => {
  const {
    form,
    isLoading,
    isCheckingUsername,
    formError,
    isSubmitDisabled,
    handleFormSubmit,
    clearUsernameError
  } = useSignupForm();

  return (
    <Card className="w-full max-w-md animate-scale-in">
      <CardHeader>
        <CardTitle className="text-2xl text-center">Create your account</CardTitle>
        <CardDescription className="text-center">
          Enter your information to get started with Project S
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ErrorAlert error={formError} />
        <Form {...form}>
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <FullNameField form={form} />
            <EmailField form={form} />
            <UsernameField
              form={form}
              isCheckingUsername={isCheckingUsername}
              clearUsernameError={clearUsernameError}
            />
            <PasswordField form={form} />
            <SubmitButton isLoading={isLoading} isDisabled={isSubmitDisabled} />
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-center text-muted-foreground">
          Already have an account?{' '}
          <a href="/login" className="text-indigo-300 hover:underline">
            Sign in
          </a>
        </p>
      </CardFooter>
    </Card>
  );
};

export default SignupForm;
