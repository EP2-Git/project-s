
import * as React from "react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";

export interface DatePickerProps {
  date?: Date;
  onChange?: (date: Date | undefined) => void;
  className?: string;
  disabled?: boolean;
  mode?: "single" | "range" | "multiple";
  selected?: Date | DateRange | Date[] | undefined;
  onSelect?: (date: Date | undefined) => void;
  initialFocus?: boolean;
}

export function DatePicker({
  date,
  onChange,
  className,
  disabled,
  mode = "single",
  selected,
  onSelect,
  initialFocus,
}: DatePickerProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(date);

  React.useEffect(() => {
    if (date !== selectedDate) {
      setSelectedDate(date);
    }
  }, [date, selectedDate]);

  const handleSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    onChange?.(date);
    onSelect?.(date);
  };

  // Pass correct props based on mode
  const calendarProps = {
    disabled,
    initialFocus,
  };

  if (mode === "single") {
    return (
      <div className={cn("grid gap-2", className)}>
        <Calendar
          mode="single"
          selected={selected as Date || selectedDate}
          onSelect={handleSelect}
          {...calendarProps}
        />
      </div>
    );
  } else if (mode === "range") {
    return (
      <div className={cn("grid gap-2", className)}>
        <Calendar
          mode="range"
          selected={selected as DateRange}
          onSelect={(range) => {
            if (range && !(range instanceof Date) && range.from) {
              handleSelect(range.from);
            }
          }}
          {...calendarProps}
        />
      </div>
    );
  } else if (mode === "multiple") {
    return (
      <div className={cn("grid gap-2", className)}>
        <Calendar
          mode="multiple"
          selected={selected as Date[] || []}
          onSelect={(dates) => {
            if (Array.isArray(dates) && dates.length > 0) {
              handleSelect(dates[dates.length - 1]);
            } else {
              handleSelect(undefined);
            }
          }}
          {...calendarProps}
        />
      </div>
    );
  }

  // Fallback for invalid mode
  return (
    <div className={cn("grid gap-2", className)}>
      <Calendar
        mode="single"
        selected={selected as Date || selectedDate}
        onSelect={handleSelect}
        {...calendarProps}
      />
    </div>
  );
}
