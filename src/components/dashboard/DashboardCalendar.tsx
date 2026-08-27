
import React, { useState, useEffect, useRef } from 'react';
import {
  startOfWeek, addDays, addWeeks, subWeeks,
} from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { BookingEvent } from '@/hooks/useBookingsData';
import BookingDetailsDialog from './BookingDetailsDialog';

// Import smaller components
import CalendarHeader from './calendar/CalendarHeader';
import CalendarToolbar from './calendar/CalendarToolbar';
import CalendarWeekDays from './calendar/CalendarWeekDays';
import CalendarWeekGrid from './calendar/CalendarWeekGrid';
import CalendarEmptyState from './calendar/CalendarEmptyState';
import CalendarLoadingState from './calendar/CalendarLoadingState';
import {
  calendarDateToDateKey,
  dateKeyToCalendarDate,
  getDateKeyInTimeZone,
} from '@/lib/time';
import { bookingMatchesFilter } from '@/lib/dashboardTime';
import type { IanaTimeZone } from '@/types/publicBooking';
import { useCurrentTime } from '@/hooks/useCurrentTime';

interface DashboardCalendarProps {
  events: BookingEvent[];
  loading: boolean;
  filter: 'all' | 'upcoming' | 'week';
  setFilter: (filter: 'all' | 'upcoming' | 'week') => void;
  hostTimeZone: IanaTimeZone;
}

const DashboardCalendar: React.FC<DashboardCalendarProps> = ({
  events,
  loading,
  filter,
  setFilter,
  hostTimeZone,
}) => {
  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    dateKeyToCalendarDate(getDateKeyInTimeZone(new Date(), hostTimeZone)),
  );
  const [selectedEvent, setSelectedEvent] = useState<BookingEvent | null>(null);
  const [view, setView] = useState<'day' | 'week' | '2week'>('week');
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const now = useCurrentTime();

  // Get days to display based on the current view
  const getDaysInView = () => {
    if (view === 'day') {
      // Just show the selected day
      return [new Date(selectedDate)];
    } else if (view === 'week') {
      // Show a 7-day week
      const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        days.push(addDays(start, i));
      }
      return days;
    } else if (view === '2week') {
      // Show a 14-day period
      const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
      const days: Date[] = [];
      for (let i = 0; i < 14; i++) {
        days.push(addDays(start, i));
      }
      return days;
    }

    return [new Date(selectedDate)];
  };

  const weekDays = getDaysInView();

  // Filter events based on selected filter
  const filteredEvents = events.filter((event) =>
    event.status === 'confirmed' && bookingMatchesFilter(event.start, filter, hostTimeZone, now),
  );

  const getEventsForDay = (date: Date) => {
    return filteredEvents.filter(event => {
      const eventDate = getDateKeyInTimeZone(event.start, hostTimeZone);
      return eventDate === calendarDateToDateKey(date);
    }).sort((a, b) => {
      const aTime = new Date(a.start).getTime();
      const bTime = new Date(b.start).getTime();
      return aTime - bTime;
    });
  };

  const previousPeriod = () => {
    if (view === 'day') {
      setSelectedDate(prev => addDays(prev, -1));
    } else if (view === 'week') {
      setSelectedDate(prev => subWeeks(prev, 1));
    } else if (view === '2week') {
      setSelectedDate(prev => subWeeks(prev, 2));
    }
  };

  const nextPeriod = () => {
    if (view === 'day') {
      setSelectedDate(prev => addDays(prev, 1));
    } else if (view === 'week') {
      setSelectedDate(prev => addWeeks(prev, 1));
    } else if (view === '2week') {
      setSelectedDate(prev => addWeeks(prev, 2));
    }
  };

  const today = () => {
    setSelectedDate(
      dateKeyToCalendarDate(getDateKeyInTimeZone(new Date(), hostTimeZone)),
    );
  };

  const handleSlideDirection = (direction: 'left' | 'right') => {
    setSlideDirection(direction);
  };

  useEffect(() => {
    // Reset animation after a short delay
    if (slideDirection) {
      const timer = setTimeout(() => {
        setSlideDirection(null);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [slideDirection]);

  useEffect(() => {
    setSelectedDate(
      dateKeyToCalendarDate(getDateKeyInTimeZone(new Date(), hostTimeZone)),
    );
  }, [hostTimeZone]);

  return (
    <Card className="w-full mb-6 overflow-hidden">
      <CardHeader className="flex flex-col gap-2 pb-2">
        <CalendarHeader hostTimeZone={hostTimeZone} />
      </CardHeader>

      <CardContent className="p-2 sm:p-4">
        <div className="flex flex-col space-y-4">
          <CalendarToolbar
            weekDays={weekDays}
            currentDate={selectedDate}
            onPreviousWeek={previousPeriod}
            onNextWeek={nextPeriod}
            onToday={today}
            filter={filter}
            setFilter={setFilter}
            onDateChange={setSelectedDate}
            view={view}
            setView={setView}
            onSlideDirection={handleSlideDirection}
          />

          {loading ? (
            <CalendarLoadingState />
          ) : filteredEvents.length === 0 ? (
            <CalendarEmptyState />
          ) : (
            <>
              <div className="calendar-container">
                <div className="hidden sm:block mb-1 sync-scroll-container">
                  <CalendarWeekDays
                    ref={headerRef}
                    weekDays={weekDays}
                    view={view}
                    slideDirection={slideDirection}
                    hostTimeZone={hostTimeZone}
                  />
                </div>
                <CalendarWeekGrid
                  weekDays={weekDays}
                  getEventsForDay={getEventsForDay}
                  onEventClick={setSelectedEvent}
                  view={view}
                  slideDirection={slideDirection}
                  headerRef={headerRef}
                  hostTimeZone={hostTimeZone}
                />
              </div>
            </>
          )}

        </div>
      </CardContent>

      <BookingDetailsDialog
        event={selectedEvent}
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        hostTimeZone={hostTimeZone}
      />

    </Card>
  );
};

export default DashboardCalendar;
