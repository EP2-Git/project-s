import React from 'react';
import type { IanaTimeZone } from '@/types/publicBooking';

const CalendarHeader: React.FC<{ hostTimeZone: IanaTimeZone }> = ({ hostTimeZone }) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="text-xl">Calendar</h3>
    <p className="text-xs text-muted-foreground">Times in {hostTimeZone}</p>
  </div>
);

export default CalendarHeader;
