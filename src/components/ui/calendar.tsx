
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type ClassNameValue = string | ((date: Date, view?: string) => string);

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  classNames?: {
    months?: ClassNameValue;
    month?: ClassNameValue;
    caption?: ClassNameValue;
    caption_label?: ClassNameValue;
    nav?: ClassNameValue;
    nav_button?: ClassNameValue;
    nav_button_previous?: ClassNameValue;
    nav_button_next?: ClassNameValue;
    table?: ClassNameValue;
    head_row?: ClassNameValue;
    head_cell?: ClassNameValue;
    row?: ClassNameValue;
    cell?: ClassNameValue;
    day?: ClassNameValue;
    day_selected?: ClassNameValue;
    day_today?: ClassNameValue;
    day_outside?: ClassNameValue;
    day_disabled?: ClassNameValue;
    day_range_middle?: ClassNameValue;
    day_hidden?: ClassNameValue;
    day_range_end?: ClassNameValue;
    [key: string]: ClassNameValue | undefined;
  };
  onSelect?: (date: Date | undefined) => void;
};

type DayPickerProps = React.ComponentProps<typeof DayPicker>;
type DayClickModifiers = Parameters<NonNullable<DayPickerProps["onDayClick"]>>[1];

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  onSelect,
  selected,
  mode,
  modifiers,
  modifiersClassNames,
  ...props
}: CalendarProps) {
  // Handle compatibility between our API and DayPicker's API
  const handleDayClick = React.useCallback((day: Date, dayModifiers: DayClickModifiers) => {
    if (onSelect && !dayModifiers.disabled) {
      onSelect(day);
    }
  }, [onSelect]);

  // Map our mode prop to DayPicker props
  const dayPickerProps = {
    ...props,
    modifiers,
    modifiersClassNames
  } as DayPickerProps;

  if (mode === 'single') {
    dayPickerProps.mode = 'single';
    dayPickerProps.selected = selected as Date;
    dayPickerProps.onDayClick = handleDayClick;
  } else if (mode === 'multiple') {
    dayPickerProps.mode = 'multiple';
    dayPickerProps.selected = selected as Date[];
    dayPickerProps.onDayClick = handleDayClick;
  } else if (mode === 'range') {
    dayPickerProps.mode = 'range';
    dayPickerProps.selected = selected;
    dayPickerProps.onDayClick = handleDayClick;
  }

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 pointer-events-auto w-full", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0 w-full",
        month: "space-y-4 w-full",
        caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex w-full justify-between",
        head_cell:
          "text-muted-foreground rounded-md w-10 font-normal text-[0.8rem] flex-shrink-0",
        row: "flex w-full mt-2 justify-between",
        cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected])]:bg-accent",
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-10 w-10 p-0 font-normal aria-selected:opacity-100 rounded-full flex items-center justify-center"
        ),
        day_range_end: "day-range-end",
        day_selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        day_today: "bg-accent text-accent-foreground",
        day_outside:
          "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30",
        day_disabled: "text-muted-foreground opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ ..._props }) => <ChevronLeft className="h-4 w-4" />,
        IconRight: ({ ..._props }) => <ChevronRight className="h-4 w-4" />,
      }}
      {...dayPickerProps}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
