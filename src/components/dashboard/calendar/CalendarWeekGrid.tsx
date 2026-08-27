
import React, { useCallback, useRef, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { BookingEvent } from '@/hooks/useBookingsData';
import CalendarEventItem from './CalendarEventItem';
import { useIsMobile } from '@/hooks/use-mobile';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { calendarDateToDateKey, getDateKeyInTimeZone } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';

interface CalendarWeekGridProps {
  weekDays: Date[];
  getEventsForDay: (date: Date) => BookingEvent[];
  onEventClick: (event: BookingEvent) => void;
  view: 'day' | 'week' | '2week';
  slideDirection: 'left' | 'right' | null;
  headerRef?: React.RefObject<HTMLDivElement>;
  hostTimeZone: IanaTimeZone;
}

const CalendarWeekGrid: React.FC<CalendarWeekGridProps> = ({
  weekDays,
  getEventsForDay,
  onEventClick,
  view,
  slideDirection,
  headerRef,
  hostTimeZone,
}) => {
  const isMobile = useIsMobile();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(true);
  const [animationClass, setAnimationClass] = useState('');

  // Apply animation when sliding direction changes
  useEffect(() => {
    if (!slideDirection) return;

    setAnimationClass(`slide-${slideDirection}-enter`);
    const timer = setTimeout(() => {
      setAnimationClass(`slide-${slideDirection}-enter-active`);
    }, 50);

    const resetTimer = setTimeout(() => {
      setAnimationClass('');
    }, 350);

    return () => {
      clearTimeout(timer);
      clearTimeout(resetTimer);
    };
  }, [slideDirection, weekDays]);

  // Handle horizontal scrolling and sync with header
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setShowLeftScroll(scrollLeft > 0);
      setShowRightScroll(scrollLeft < scrollWidth - clientWidth - 10);

      // Sync header scroll position
      if (headerRef?.current) {
        headerRef.current.scrollLeft = scrollLeft;
      }
    }
  }, [headerRef]);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -250, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 250, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll(); // Initial check

      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Render a single calendar day cell
  const renderDayCell = (day: Date, index: number) => (
    <div
      key={`day-${index}`}
      className={cn(
        "border border-border rounded-md overflow-y-auto scrollbar-thin",
        calendarDateToDateKey(day) === getDateKeyInTimeZone(new Date(), hostTimeZone)
          ? "border-primary/30"
          : ""
      )}
      style={{
        minHeight: isMobile ? '170px' : '200px',
        maxHeight: isMobile ? '300px' : '500px'
      }}
    >
      <div className="h-full">
        {getEventsForDay(day).length > 0 ? (
          <div className="space-y-1 p-1.5">
            {getEventsForDay(day).map(event => (
              <CalendarEventItem
                key={event.id}
                event={event}
                onClick={() => onEventClick(event)}
                hostTimeZone={hostTimeZone}
              />
            ))}
          </div>
        ) : (
          <div className="flex justify-center items-center h-full">
            <span className="text-xs text-muted-foreground">No events</span>
          </div>
        )}
      </div>
    </div>
  );

  // Render the 2-week view with stacked weeks
  if (view === '2week' && weekDays.length >= 14) {
    const firstWeek = weekDays.slice(0, 7);
    const secondWeek = weekDays.slice(7, 14);

    return (
      <div className={cn("two-week-grid calendar-view-transition", animationClass)}>
        <div className="w-full overflow-hidden">
          <div className="grid grid-cols-7 gap-1.5">
            {firstWeek.map((day, i) => renderDayCell(day, i))}
          </div>
        </div>
        <div className="w-full overflow-hidden">
          <div className="grid grid-cols-7 gap-1.5">
            {secondWeek.map((day, i) => renderDayCell(day, i + 7))}
          </div>
        </div>
      </div>
    );
  }

  // Single day view
  if (view === 'day') {
    return (
      <div className={cn("w-full calendar-view-transition", animationClass)}>
        {renderDayCell(weekDays[0], 0)}
      </div>
    );
  }

  // Week view (or fallback)
  return (
    <div className={cn("relative w-full calendar-view-transition", animationClass)}>
      {showLeftScroll && (
        <button
          type="button"
          onClick={scrollLeft}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background p-1 rounded-full shadow-md"
          aria-label="Scroll left"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      <div
        ref={scrollContainerRef}
        role="region"
        aria-label="Calendar events"
        tabIndex={0}
        className="grid grid-flow-col auto-cols-fr gap-2 overflow-x-auto pb-2 scrollbar-thin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          gridAutoColumns: `minmax(${isMobile ? '140px' : '180px'}, 1fr)`,
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          maxWidth: '100%'
        }}
      >
        {weekDays.map((day, i) => renderDayCell(day, i))}
      </div>

      {showRightScroll && (
      <button
        type="button"
          onClick={scrollRight}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-background/80 hover:bg-background p-1 rounded-full shadow-md"
          aria-label="Scroll right"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
};

export default CalendarWeekGrid;
