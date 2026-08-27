import React from 'react';
import { cn } from '@/lib/utils';
import type { PublicMeetingType } from '@/types/publicBooking';
import MeetingTypeInfo from './MeetingTypeInfo';

interface MeetingTypeListProps {
  meetingTypes: PublicMeetingType[];
  selectedMeetingType: PublicMeetingType | null;
  onSelect: (meetingType: PublicMeetingType) => void;
}

const MeetingTypeList: React.FC<MeetingTypeListProps> = ({
  meetingTypes,
  selectedMeetingType,
  onSelect,
}) => (
  <fieldset className="mb-6">
    <legend className="mb-3 text-base font-semibold sm:text-lg">
      Select meeting type
    </legend>
    {meetingTypes.length === 0 ? (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        This host has no active meeting types.
      </p>
    ) : (
      <div className="space-y-3">
        {meetingTypes.map((type) => {
          const selected =
            selectedMeetingType?.meetingTypeId === type.meetingTypeId;
          return (
            <button
              key={type.meetingTypeId}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(type)}
              className={cn(
                'w-full rounded-lg border p-4 shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                selected && 'border-primary/60 bg-primary/5 shadow-md',
              )}
            >
              <MeetingTypeInfo meetingType={type} />
            </button>
          );
        })}
      </div>
    )}
  </fieldset>
);

export default MeetingTypeList;
