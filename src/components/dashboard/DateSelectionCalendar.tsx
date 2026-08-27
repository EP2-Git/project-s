import React, { useMemo, useEffect, useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { SpecificDateAvailability } from '@/hooks/useSpecificDateAvailability';
import { supabase } from '@/lib/supabaseClient';
import {
  addDaysToDateKey,
  calendarDateToDateKey,
  dateKeyToCalendarDate,
  getDateKeyInTimeZone,
} from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';

interface DateSelectionCalendarProps {
  selectedDate: Date | undefined;
  onDateSelect: (date: Date | undefined) => void;
  specificDateAvailabilities?: SpecificDateAvailability[];
  hostTimeZone: IanaTimeZone;
}

const DateSelectionCalendar: React.FC<DateSelectionCalendarProps> = ({
  selectedDate,
  onDateSelect,
  specificDateAvailabilities = [],
  hostTimeZone,
}) => {
  const [dateOverrides, setDateOverrides] = useState<SpecificDateAvailability[]>([]);

  // Load date overrides from Supabase if not provided
  useEffect(() => {
    async function loadDateOverrides() {
      try {
        // Get current user
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user?.id) return;

        const userId = userData.user.id;

        // Fetch date overrides for next 3 months
        const startDate = getDateKeyInTimeZone(new Date(), hostTimeZone);
        const endDate = addDaysToDateKey(startDate, 92);

        const { data, error } = await supabase
          .from('specific_date_availabilities')
          .select('*')
          .eq('user_id', userId)
          .gte('date', startDate)
          .lte('date', endDate);

        if (error) return;

        // Transform data to match our interface
        const transformedData = data.map(item => ({
          id: item.id,
          userId: item.user_id,
          date: item.date,
          startTime: item.start_time,
          endTime: item.end_time,
          bufferMinutes: item.buffer_minutes,
          status: item.status as 'available' | 'unavailable' | 'default',
          note: item.note
        }));

        setDateOverrides(transformedData);
      } catch {
        setDateOverrides([]);
      }
    }

    if (specificDateAvailabilities.length === 0) {
      loadDateOverrides();
    } else {
      setDateOverrides(specificDateAvailabilities);
    }
  }, [hostTimeZone, specificDateAvailabilities]);

  // Memoize modifiers to prevent unnecessary recalculations
  const modifiers = useMemo(() => ({
    available: (date: Date) => {
      const dateStr = calendarDateToDateKey(date);
      return dateOverrides?.some(
        sda => sda.date === dateStr && sda.status === 'available'
      );
    },
    unavailable: (date: Date) => {
      const dateStr = calendarDateToDateKey(date);
      return dateOverrides?.some(
        sda => sda.date === dateStr && sda.status === 'unavailable'
      );
    },
    default: (date: Date) => {
      const dateStr = calendarDateToDateKey(date);
      return dateOverrides?.some(
        sda => sda.date === dateStr && sda.status === 'default'
      );
    }
  }), [dateOverrides]);

  // Memoize class names to prevent style recalculations
  const modifiersClassNames = useMemo(() => ({
    selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
    available: "bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-100 hover:bg-green-200 dark:hover:bg-green-800/40 transition-colors",
    unavailable: "bg-red-100 dark:bg-red-900/30 text-red-900 dark:text-red-100 hover:bg-red-200 dark:hover:bg-red-800/40 transition-colors",
    default: "bg-background hover:bg-accent/50 transition-colors",
    today: "bg-accent text-accent-foreground font-semibold",
    disabled: "text-muted-foreground opacity-50 cursor-not-allowed"
  }), []);

  return (
    <div className="w-full flex justify-center">
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={onDateSelect}
        className="rounded-md border w-full"
        disabled={(date) => calendarDateToDateKey(date) < getDateKeyInTimeZone(new Date(), hostTimeZone)}
        showOutsideDays={true}
        fixedWeeks
        modifiersClassNames={modifiersClassNames}
        modifiers={modifiers}
        fromDate={dateKeyToCalendarDate(getDateKeyInTimeZone(new Date(), hostTimeZone))}
      />
    </div>
  );
};

// Prevent unnecessary re-renders
export default React.memo(DateSelectionCalendar);
