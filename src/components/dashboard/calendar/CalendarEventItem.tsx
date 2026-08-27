
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { BookingEvent } from '@/hooks/useBookingsData';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatSlotTime } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';

interface CalendarEventItemProps {
  event: BookingEvent;
  onClick: () => void;
  hostTimeZone: IanaTimeZone;
}

const CalendarEventItem: React.FC<CalendarEventItemProps> = ({
  event,
  onClick,
  hostTimeZone,
}) => {
  const isMobile = useIsMobile();

  const formatEventTime = (date: Date) => {
    return formatSlotTime(date.toISOString(), hostTimeZone);
  };

  const displayName = event.bookerName || 'Unknown';
  const displayEmail = event.bookerEmail || '';

  // Truncate title for display
  const truncatedTitle = event.title && event.title.length > 30
    ? `${event.title.substring(0, 30)}...`
    : event.title || 'No Title';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`View ${event.title || 'booking'} at ${formatEventTime(event.start)}`}
            className={cn(
              "w-full text-left text-xs p-1.5 md:p-2 rounded cursor-pointer",
              "hover:brightness-110 transition-all",
              "border-l-2 min-h-[48px] md:min-h-[60px]",
              "flex flex-col justify-between",
              "border-lavender bg-lavender/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
            onClick={onClick}
          >
            <div className="font-medium truncate w-full">
              {formatEventTime(event.start instanceof Date ? event.start : new Date(event.start))}
            </div>
            <div className="font-medium truncate max-w-full text-[10px] md:text-xs">{truncatedTitle}</div>
            {!isMobile && (
              <div className="truncate max-w-full text-[10px]">{displayName}</div>
            )}
            <div className="mt-1">
              <Badge
                variant="outline"
                className={cn(
                  "text-[8px] md:text-[10px] whitespace-nowrap px-1 py-0 md:py-0.5",
                  "border-lavender/60 text-foreground"
                )}
              >
                Project S
              </Badge>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-medium">{event.title || 'No Title'}</p>
            <p>{formatEventTime(event.start instanceof Date ? event.start : new Date(event.start))} - {formatEventTime(event.end instanceof Date ? event.end : new Date(event.end))}</p>
            <p>{displayName}</p>
            {displayEmail && <p className="text-xs">{displayEmail}</p>}
            <p className="text-xs font-medium">Project S booking</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default CalendarEventItem;
