
import React, { useEffect, useRef } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ErrorAlertProps {
  error: string | null;
}

const ErrorAlert: React.FC<ErrorAlertProps> = ({ error }) => {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  if (!error) return null;

  return (
    <Alert ref={alertRef} tabIndex={-1} aria-label="Account creation failed" variant="destructive" className="mb-4 text-red-700 dark:text-red-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <AlertDescription>
        <p>{error}</p>
        <p>Your entries are still here. Review your details or connection, then try Create Account again.</p>
      </AlertDescription>
    </Alert>
  );
};

export default ErrorAlert;
