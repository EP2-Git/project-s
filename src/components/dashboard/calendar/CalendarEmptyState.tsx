
import React from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';

const CalendarEmptyState: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-64 bg-card/50 rounded-lg border border-border">
      <CalendarIcon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium mb-1">No meetings yet</h3>
      <p className="text-sm text-muted-foreground">
        Your scheduled meetings will appear here once you have bookings.
      </p>
    </div>
  );
};

export default CalendarEmptyState;
