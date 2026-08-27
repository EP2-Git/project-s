
import React from 'react';
import DayCard from './DayCard';
import SaveButton from './SaveButton';
import { AvailabilityProvider, useAvailabilityContext } from '@/contexts/AvailabilityContext';
import { DAYS_OF_WEEK, BUFFER_OPTIONS } from '@/constants/availability';
import { Loader2 } from 'lucide-react';

interface WeeklyAvailabilityProps {
  userId: string;
}

// The inner component that uses the context
const WeeklyAvailabilityContent: React.FC<WeeklyAvailabilityProps> = ({ userId }) => {
  const { loading: isLoading } = useAvailabilityContext();

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="text-center py-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="mt-2 text-muted-foreground">Loading availability settings...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DAYS_OF_WEEK.map((day) => (
            <DayCard key={day.value} day={day} bufferOptions={BUFFER_OPTIONS} />
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <SaveButton userId={userId} />
      </div>
    </div>
  );
};

// The wrapper component that provides the context
const WeeklyAvailability: React.FC<WeeklyAvailabilityProps> = ({ userId }) => {
  return (
    <AvailabilityProvider>
      <WeeklyAvailabilityContent userId={userId} />
    </AvailabilityProvider>
  );
};

export default WeeklyAvailability;
