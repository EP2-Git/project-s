import React from 'react';
import { Clock, CalendarClock } from 'lucide-react';
import type { PublicMeetingType } from '@/types/publicBooking';

interface MeetingTypeInfoProps {
  meetingType: PublicMeetingType;
}

const MeetingTypeInfo: React.FC<MeetingTypeInfoProps> = ({ meetingType }) => (
  <div className="flex items-start gap-3 text-left">
    <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
      <CalendarClock className="h-5 w-5" aria-hidden="true" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="font-medium text-foreground">{meetingType.title}</div>
      <div className="mt-1 flex items-center text-sm text-muted-foreground">
        <Clock className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{meetingType.durationMinutes} minutes</span>
      </div>
      {meetingType.description && (
        <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">
          {meetingType.description}
        </p>
      )}
    </div>
  </div>
);

export default MeetingTypeInfo;
