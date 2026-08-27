
import React, { useState, useEffect, useRef } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TimeRangePickerProps {
  startTime: string;
  endTime: string;
  onStartTimeChange: (time: string) => void;
  onEndTimeChange: (time: string) => void;
  disabled?: boolean;
}

const TimeRangePicker: React.FC<TimeRangePickerProps> = ({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  disabled = false
}) => {
  // Local state to store selected times
  const [localStartTime, setLocalStartTime] = useState(startTime);
  const [localEndTime, setLocalEndTime] = useState(endTime);

  // Refs to track if we're currently interacting with the dropdowns
  const startTimeSelectRef = useRef<HTMLDivElement>(null);
  const endTimeSelectRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);

  // Track if this component has been mounted
  const isMountedRef = useRef(false);

  // Update local state when props change (e.g., on initial load or after saving)
  // But only if we're not currently interacting with the dropdown
  useEffect(() => {
    if (isMountedRef.current && !isSelectingRef.current) {
      setLocalStartTime(startTime);
    }
  }, [startTime]);

  useEffect(() => {
    if (isMountedRef.current && !isSelectingRef.current) {
      setLocalEndTime(endTime);
    }
  }, [endTime]);

  // Set the mounted flag after first render
  useEffect(() => {
    isMountedRef.current = true;

    // Event listeners to detect when select dropdowns are open
    const handlePointerDown = () => {
      isSelectingRef.current = true;
    };

    const handlePointerUp = () => {
      // Use a timeout to ensure this happens after value selection
      setTimeout(() => {
        isSelectingRef.current = false;
      }, 100);
    };

    const startTrigger = startTimeSelectRef.current;
    const endTrigger = endTimeSelectRef.current;

    if (startTrigger) {
      startTrigger.addEventListener('pointerdown', handlePointerDown);
      startTrigger.addEventListener('pointerup', handlePointerUp);
    }

    if (endTrigger) {
      endTrigger.addEventListener('pointerdown', handlePointerDown);
      endTrigger.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      if (startTrigger) {
        startTrigger.removeEventListener('pointerdown', handlePointerDown);
        startTrigger.removeEventListener('pointerup', handlePointerUp);
      }

      if (endTrigger) {
        endTrigger.removeEventListener('pointerdown', handlePointerDown);
        endTrigger.removeEventListener('pointerup', handlePointerUp);
      }
    };
  }, []);

  // Generate time options in 30-minute increments
  const timeOptions: string[] = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const formattedHour = hour.toString().padStart(2, '0');
      const formattedMinute = minute.toString().padStart(2, '0');
      timeOptions.push(`${formattedHour}:${formattedMinute}`);
    }
  }

  // Format time for display
  const formatTimeForDisplay = (time: string) => {
    if (!time) return '';

    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;

    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Handlers for local state change and parent notification
  const handleStartTimeChange = (value: string) => {
    setLocalStartTime(value);
    onStartTimeChange(value);
  };

  const handleEndTimeChange = (value: string) => {
    setLocalEndTime(value);
    onEndTimeChange(value);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          Start Time
        </label>
        <div ref={startTimeSelectRef}>
          <Select
            value={localStartTime}
            onValueChange={handleStartTimeChange}
            disabled={disabled}
            onOpenChange={(open) => { if (open) isSelectingRef.current = true; }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {formatTimeForDisplay(localStartTime)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {timeOptions.map((time) => (
                <SelectItem key={`start-${time}`} value={time}>
                  {formatTimeForDisplay(time)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">
          End Time
        </label>
        <div ref={endTimeSelectRef}>
          <Select
            value={localEndTime}
            onValueChange={handleEndTimeChange}
            disabled={disabled}
            onOpenChange={(open) => { if (open) isSelectingRef.current = true; }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {formatTimeForDisplay(localEndTime)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {timeOptions.map((time) => (
                <SelectItem key={`end-${time}`} value={time} disabled={time <= localStartTime}>
                  {formatTimeForDisplay(time)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default TimeRangePicker;
