import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const LoadingState: React.FC = () => (
  <Card className="w-full max-w-4xl" aria-busy="true" aria-label="Loading booking page">
    <CardHeader>
      <span className="sr-only" role="status">Loading booking page…</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
    </CardHeader>
    <CardContent>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Skeleton className="h-64 w-full md:col-span-1" />
        <div className="md:col-span-2">
          <Skeleton className="mb-4 h-12 w-full" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
);

export default LoadingState;
