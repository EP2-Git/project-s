
import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePicker } from '@/components/ui/date-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface CalendarToolbarProps {
  weekDays: Date[];
  currentDate: Date;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  filter: 'all' | 'upcoming' | 'week';
  setFilter: (filter: 'all' | 'upcoming' | 'week') => void;
  onDateChange?: (date: Date) => void;
  view: 'day' | 'week' | '2week';
  setView: (view: 'day' | 'week' | '2week') => void;
  onSlideDirection: (direction: 'left' | 'right') => void;
}

const CalendarToolbar: React.FC<CalendarToolbarProps> = ({
  weekDays,
  currentDate,
  onPreviousWeek,
  onNextWeek,
  onToday,
  filter,
  setFilter,
  onDateChange,
  view,
  setView,
  onSlideDirection
}) => {
  // Format date range based on current view and screen size
  const getDateRangeText = () => {
    const start = weekDays[0];
    const end = weekDays[weekDays.length - 1];

    if (view === 'day') {
      return format(currentDate, 'MMM d, yyyy');
    }

    // If same month
    if (format(start, 'MMM yyyy') === format(end, 'MMM yyyy')) {
      return `${format(start, 'MMM d')} - ${format(end, 'd, yyyy')}`;
    }

    // If same year but different months
    if (format(start, 'yyyy') === format(end, 'yyyy')) {
      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
    }

    // Different years
    return `${format(start, 'MMM d, yyyy')} - ${format(end, 'MMM d, yyyy')}`;
  };

  // Handle view changes with animation direction
  const handleViewChange = (newView: 'day' | 'week' | '2week') => {
    // Determine slide direction based on "width" of view
    const viewWeight = { 'day': 1, 'week': 2, '2week': 3 };
    const direction = viewWeight[newView] > viewWeight[view] ? 'left' : 'right';

    onSlideDirection(direction);
    setView(newView);
  };

  const handlePrevious = () => {
    onSlideDirection('right');
    onPreviousWeek();
  };

  const handleNext = () => {
    onSlideDirection('left');
    onNextWeek();
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
      <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto min-w-0">
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={handlePrevious} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-xs whitespace-nowrap" onClick={onToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleNext} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-9 px-2 text-sm font-medium truncate min-w-0">
              {getDateRangeText()}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <DatePicker
              mode="single"
              selected={currentDate}
              onSelect={(date) => date && onDateChange && onDateChange(date)}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 w-full sm:w-auto">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => value && handleViewChange(value as 'day' | 'week' | '2week')}
          aria-label="Calendar range"
          className="grid h-9 w-full grid-cols-3 gap-1 sm:w-auto"
        >
          <ToggleGroupItem value="day" aria-label="Show one day" className="h-9 px-3 text-xs">
            Day
          </ToggleGroupItem>
          <ToggleGroupItem value="week" aria-label="Show one week" className="h-9 px-3 text-xs">
            Week
          </ToggleGroupItem>
          <ToggleGroupItem value="2week" aria-label="Show two weeks" className="h-9 whitespace-nowrap px-3 text-xs">
            2 Wk
          </ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => v && setFilter(v as 'all' | 'upcoming' | 'week')}
          className="grid grid-cols-3 sm:flex w-full sm:w-auto gap-1"
        >
          <ToggleGroupItem value="all" aria-label="Show all events" className="h-9 px-3 text-xs">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="upcoming" aria-label="Show upcoming events" className="h-9 px-3 text-xs">
            Upcoming
          </ToggleGroupItem>
          <ToggleGroupItem value="week" aria-label="Show this week's events" className="h-9 px-3 text-xs">
            Week
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
};


export default CalendarToolbar;
