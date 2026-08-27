import React from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSlotTime } from '@/lib/time';
import type { IanaTimeZone, PublicSlot } from '@/types/publicBooking';

interface TimeSlotPickerProps {
  timeSlots: PublicSlot[];
  displayTimeZone: IanaTimeZone;
  onSelectTimeSlot: (timeSlot: PublicSlot) => void;
}

const TimeSlotPicker: React.FC<TimeSlotPickerProps> = ({
  timeSlots,
  displayTimeZone,
  onSelectTimeSlot,
}) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
    {timeSlots.map((slot) => (
      <Button
        key={slot.startAt}
        type="button"
        variant="outline"
        className="h-12 justify-start px-3 py-2 shadow-sm transition-all hover:border-primary hover:shadow-md"
        onClick={() => onSelectTimeSlot(slot)}
        aria-label={`Select ${formatSlotTime(slot.startAt, displayTimeZone)}`}
      >
        <Clock className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate text-sm font-medium">
          {formatSlotTime(slot.startAt, displayTimeZone)}
        </span>
      </Button>
    ))}
  </div>
);

export default TimeSlotPicker;
