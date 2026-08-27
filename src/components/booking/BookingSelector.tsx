import React from 'react';
import TimeZoneSelect from '@/components/common/TimeZoneSelect';
import type {
  IanaTimeZone,
  LocalDate,
  PublicMeetingType,
  PublicSlot,
} from '@/types/publicBooking';
import DateSelection from './DateSelection';
import MeetingTypeList from './MeetingTypeList';
import TimeSlotSelection from './TimeSlotSelection';

interface BookingSelectorProps {
  meetingTypes: PublicMeetingType[];
  selectedMeetingType: PublicMeetingType | null;
  onMeetingTypeSelect: (meetingType: PublicMeetingType) => void;
  selectedDate: LocalDate;
  onDateSelect: (date: LocalDate) => void;
  minDate: LocalDate;
  maxDate: LocalDate;
  availableTimeSlots: PublicSlot[];
  slotsLoading: boolean;
  slotsError: string | null;
  onRetrySlots: () => void;
  onTimeSlotSelect: (timeSlot: PublicSlot) => void;
  displayTimeZone: IanaTimeZone;
  onTimeZoneChange: (timeZone: IanaTimeZone) => void;
}

const BookingSelector: React.FC<BookingSelectorProps> = ({
  meetingTypes,
  selectedMeetingType,
  onMeetingTypeSelect,
  selectedDate,
  onDateSelect,
  minDate,
  maxDate,
  availableTimeSlots,
  slotsLoading,
  slotsError,
  onRetrySlots,
  onTimeSlotSelect,
  displayTimeZone,
  onTimeZoneChange,
}) => (
  <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
    <div className="space-y-6 md:col-span-1">
      <MeetingTypeList
        meetingTypes={meetingTypes}
        selectedMeetingType={selectedMeetingType}
        onSelect={onMeetingTypeSelect}
      />
      <DateSelection
        selectedDate={selectedDate}
        onSelectDate={onDateSelect}
        minDate={minDate}
        maxDate={maxDate}
      />
      <TimeZoneSelect value={displayTimeZone} onChange={onTimeZoneChange} />
    </div>
    <div className="min-w-0 md:col-span-2">
      {selectedMeetingType ? (
        <TimeSlotSelection
          selectedDate={selectedDate}
          availableTimeSlots={availableTimeSlots}
          displayTimeZone={displayTimeZone}
          loading={slotsLoading}
          error={slotsError}
          onRetry={onRetrySlots}
          onSelectTimeSlot={onTimeSlotSelect}
        />
      ) : (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
          Select a meeting type to see available times.
        </div>
      )}
    </div>
  </div>
);

export default BookingSelector;
