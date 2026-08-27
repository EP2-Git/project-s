
import React, { forwardRef } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { calendarDateToDateKey, getDateKeyInTimeZone } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';

interface CalendarWeekDaysProps {
  weekDays: Date[];
  view?: 'day' | 'week' | '2week';
  slideDirection?: 'left' | 'right' | null;
  hostTimeZone: IanaTimeZone;
}

const CalendarWeekDays = forwardRef<HTMLDivElement, CalendarWeekDaysProps>(({
  weekDays,
  view = 'week',
  slideDirection = null,
  hostTimeZone,
}, ref) => {
  const isMobile = useIsMobile();
  const isHostToday = (day: Date) =>
    calendarDateToDateKey(day) === getDateKeyInTimeZone(new Date(), hostTimeZone);

  // If in 2-week view and have enough days, split into 2 rows
  if (view === '2week' && weekDays.length >= 14) {
    const firstWeek = weekDays.slice(0, 7);
    const secondWeek = weekDays.slice(7, 14);

    return (
      <div className={cn(
        "two-week-grid calendar-view-transition",
        slideDirection ? `slide-${slideDirection}-enter-active` : "",
        "date-header-shadow"
      )}>
        <div className="grid grid-cols-7 gap-1.5">
          {firstWeek.map((day, i) => (
            <div key={i} className="text-center p-1">
              <div className="mb-1 text-xs sm:text-sm font-medium">
                {format(day, 'EEE')}
              </div>
              <div className={cn(
                "inline-flex h-7 w-7 rounded-full items-center justify-center text-xs",
                isHostToday(day) ? "bg-primary text-primary-foreground" : ""
              )}>
                {format(day, 'd')}
              </div>
              <div className="text-xs opacity-75 mt-0.5 hidden sm:block">
                {format(day, 'MMM')}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {secondWeek.map((day, i) => (
            <div key={i + 7} className="text-center p-1">
              <div className="mb-1 text-xs sm:text-sm font-medium">
                {format(day, 'EEE')}
              </div>
              <div className={cn(
                "inline-flex h-7 w-7 rounded-full items-center justify-center text-xs",
                isHostToday(day) ? "bg-primary text-primary-foreground" : ""
              )}>
                {format(day, 'd')}
              </div>
              <div className="text-xs opacity-75 mt-0.5 hidden sm:block">
                {format(day, 'MMM')}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // For single day view
  if (view === 'day') {
    const day = weekDays[0];
    return (
      <div className={cn(
        "flex justify-center calendar-view-transition date-header-shadow",
        slideDirection ? `slide-${slideDirection}-enter-active` : ""
      )}>
        <div className="text-center p-1.5">
          <div className="text-sm sm:text-base font-medium">
            {format(day, 'EEEE')}
          </div>
          <div className={cn(
            "inline-flex h-10 w-10 rounded-full items-center justify-center text-sm sm:text-base",
            isHostToday(day) ? "bg-primary text-primary-foreground" : ""
          )}>
            {format(day, 'd')}
          </div>
          <div className="text-sm opacity-75 mt-1">
            {format(day, 'MMMM yyyy')}
          </div>
        </div>
      </div>
    );
  }

  // Default week view
  return (
    <div
      ref={ref}
      className={cn(
        "grid grid-flow-col auto-cols-fr gap-2 overflow-hidden pb-2 calendar-view-transition date-header-shadow",
        slideDirection ? `slide-${slideDirection}-enter-active` : ""
      )}
      style={{
        gridAutoColumns: `minmax(${isMobile ? '140px' : '180px'}, 1fr)`,
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      {weekDays.map((day, i) => (
        <div key={i} className="text-center p-1.5">
          <div className="mb-1 text-xs sm:text-sm font-medium">
            {format(day, 'EEE')}
          </div>
          <div className={cn(
            "inline-flex h-7 w-7 sm:h-8 sm:w-8 rounded-full items-center justify-center text-xs sm:text-sm",
            isHostToday(day) ? "bg-primary text-primary-foreground" : ""
          )}>
            {format(day, 'd')}
          </div>
          <div className="text-xs opacity-75 mt-0.5">
            {format(day, 'MMM')}
          </div>
        </div>
      ))}
    </div>
  );
});

CalendarWeekDays.displayName = "CalendarWeekDays";

export default CalendarWeekDays;
