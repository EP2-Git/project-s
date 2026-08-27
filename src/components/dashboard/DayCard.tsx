
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TimeRangePicker from './TimeRangePicker';
import { useAvailabilityContext } from '@/contexts/AvailabilityContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { isValidTimeWindow } from '@/lib/availability';

interface DayCardProps {
  day: {
    name: string;
    value: number;
  };
  bufferOptions: number[];
}

const DayCard: React.FC<DayCardProps> = ({ day, bufferOptions }) => {
  const { availabilities, updateAvailability } = useAvailabilityContext();

  // Find the availability for this day
  const dayAvailability = availabilities.find(a => a.weekday === day.value);
  const enabled = Boolean(dayAvailability);

  // Store the time values in local state to prevent unwanted resets
  const [timeValues, setTimeValues] = useState({
    startTime: dayAvailability?.start_time || '09:00',
    endTime: dayAvailability?.end_time || '17:00',
    bufferMinutes: dayAvailability?.buffer_minutes || 0
  });
  const hasInvalidWindow = enabled && !isValidTimeWindow(timeValues.startTime, timeValues.endTime);

  // Update local state when availabilities change (initial load or after save)
  useEffect(() => {
    if (dayAvailability) {
      setTimeValues({
        startTime: dayAvailability.start_time || '09:00',
        endTime: dayAvailability.end_time || '17:00',
        bufferMinutes: dayAvailability.buffer_minutes || 0
      });
    }
  }, [dayAvailability]);

  // Handlers with debouncing to avoid excessive context updates
  const handleStartTimeChange = (time: string) => {
    setTimeValues(prev => ({ ...prev, startTime: time }));

    // Update the global state
    updateAvailability(day.value, true, time, timeValues.endTime, timeValues.bufferMinutes);
  };

  const handleEndTimeChange = (time: string) => {
    setTimeValues(prev => ({ ...prev, endTime: time }));

    // Update the global state
    updateAvailability(day.value, true, timeValues.startTime, time, timeValues.bufferMinutes);
  };

  const handleBufferChange = (value: string) => {
    const bufferMinutes = Number(value);
    setTimeValues(prev => ({ ...prev, bufferMinutes }));

    // Update the global state
    updateAvailability(day.value, true, timeValues.startTime, timeValues.endTime, bufferMinutes);
  };

  const handleEnabledChange = (checked: boolean) => {
    updateAvailability(
      day.value,
      checked,
      timeValues.startTime,
      timeValues.endTime,
      timeValues.bufferMinutes,
    );
  };

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">{day.name}</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor={`availability-${day.value}`} className="text-sm">
              {enabled ? 'Available' : 'Unavailable'}
            </Label>
            <Switch
              id={`availability-${day.value}`}
              checked={enabled}
              onCheckedChange={handleEnabledChange}
              aria-label={`Set ${day.name} availability`}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={!enabled} className="space-y-4 disabled:opacity-50">
          <legend className="sr-only">{day.name} hours</legend>
          <TimeRangePicker
            startTime={timeValues.startTime}
            endTime={timeValues.endTime}
            onStartTimeChange={handleStartTimeChange}
            onEndTimeChange={handleEndTimeChange}
          />

          <div className="space-y-1">
          <label className="text-sm font-medium text-muted-foreground">
            Buffer Time
          </label>
          <Select
            value={String(timeValues.bufferMinutes)}
            onValueChange={handleBufferChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Buffer time between meetings" />
            </SelectTrigger>
            <SelectContent>
              {bufferOptions.map((buffer) => (
                <SelectItem key={buffer} value={buffer.toString()}>
                  {buffer} minutes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
        </fieldset>
        {hasInvalidWindow && (
          <p className="text-sm text-destructive" role="alert">End time must be later than start time.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default DayCard;
