import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

const ErrorState: React.FC<ErrorStateProps> = ({
  message = 'This booking page could not be found.',
  onRetry,
}) => (
  <Card className="w-full max-w-md" role="alert">
    <CardHeader>
      <CardTitle>Booking page unavailable</CardTitle>
      <CardDescription>{message}</CardDescription>
    </CardHeader>
    {onRetry && (
      <CardContent>
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
      </CardContent>
    )}
  </Card>
);

export default ErrorState;
