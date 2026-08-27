import React from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TimeSlotPicker from '@/components/TimeSlotPicker';
import { formatDateKey } from '@/lib/time';
import type { IanaTimeZone, LocalDate, PublicSlot } from '@/types/publicBooking';

interface TimeSlotSelectionProps {
  selectedDate: LocalDate;
  availableTimeSlots: PublicSlot[];
  displayTimeZone: IanaTimeZone;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectTimeSlot: (timeSlot: PublicSlot) => void;
}

const TimeSlotSelection: React.FC<TimeSlotSelectionProps> = ({
  selectedDate,
  availableTimeSlots,
  displayTimeZone,
  loading,
  error,
  onRetry,
  onSelectTimeSlot,
}) => (
  <section className="h-full rounded-lg border bg-card p-4 shadow-sm" aria-labelledby="available-times-title">
    <div className="mb-3 flex items-center gap-2">
      <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
      <h3 id="available-times-title" className="break-words text-base font-medium">
        Available times for {formatDateKey(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}
      </h3>
    </div>

    <div aria-live="polite" aria-busy={loading}>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading available times…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4" role="alert">
          <p>{error}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : availableTimeSlots.length > 0 ? (
        <TimeSlotPicker
          timeSlots={availableTimeSlots}
          displayTimeZone={displayTimeZone}
          onSelectTimeSlot={onSelectTimeSlot}
        />
      ) : (
        <div className="mt-4 rounded-lg border border-border/50 bg-background/50 py-8 text-center text-muted-foreground">
          <p>No available time slots for this date.</p>
          <p className="mt-1 text-sm">Please select another date.</p>
        </div>
      )}
    </div>
  </section>
);

export default TimeSlotSelection;
