import React from 'react';
import { CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import {
  calendarDateToDateKey,
  dateKeyToCalendarDate,
  formatDateKey,
} from '@/lib/time';
import type { LocalDate } from '@/types/publicBooking';

interface DateSelectionProps {
  selectedDate: LocalDate;
  onSelectDate: (date: LocalDate) => void;
  minDate: LocalDate;
  maxDate: LocalDate;
}

const DateSelection: React.FC<DateSelectionProps> = ({
  selectedDate,
  onSelectDate,
  minDate,
  maxDate,
}) => {
  const minimum = dateKeyToCalendarDate(minDate);
  const maximum = dateKeyToCalendarDate(maxDate);

  return (
    <section className="relative rounded-lg border bg-card p-3 shadow-sm" aria-labelledby="select-date-title">
      <div className="mb-2 flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
        <h3 id="select-date-title" className="text-base font-medium">
          Select date
        </h3>
      </div>
      <Calendar
        mode="single"
        selected={dateKeyToCalendarDate(selectedDate)}
        onSelect={(date) => date && onSelectDate(calendarDateToDateKey(date))}
        disabled={(date) => date < minimum || date > maximum}
        fromDate={minimum}
        toDate={maximum}
        className="w-full rounded-md"
      />
      <p className="mt-1 text-center text-xs text-muted-foreground">
        Selected: {formatDateKey(selectedDate)}
      </p>
    </section>
  );
};

export default DateSelection;
