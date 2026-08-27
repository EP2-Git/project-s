
import React from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import TimeRangePicker from './TimeRangePicker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { BUFFER_OPTIONS } from '@/constants/availability';
import { Label } from '@/components/ui/label';
import { motion } from 'framer-motion';

interface DateAvailabilitySettingsProps {
  dateStatus: 'available' | 'unavailable' | 'default';
  onStatusChange: (status: 'available' | 'unavailable' | 'default') => void;
  startTime: string;
  endTime: string;
  onTimeChange: (field: 'start_time' | 'end_time', value: string) => void;
  bufferMinutes: number;
  onBufferChange: (buffer: number) => void;
  dateNote: string;
  onNoteChange: (note: string) => void;
}

const DateAvailabilitySettings: React.FC<DateAvailabilitySettingsProps> = ({
  dateStatus,
  onStatusChange,
  startTime,
  endTime,
  onTimeChange,
  bufferMinutes,
  onBufferChange,
  dateNote,
  onNoteChange
}) => {
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Label className="text-base font-medium">Availability Setting</Label>
        <RadioGroup
          value={dateStatus}
          onValueChange={(value) => onStatusChange(value as 'available' | 'unavailable' | 'default')}
          className="flex flex-col space-y-2"
        >
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="default" id="default" className="flex-shrink-0" />
            <Label htmlFor="default" className="text-sm leading-none cursor-pointer">Use weekly default</Label>
          </div>
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="available" id="available" className="flex-shrink-0" />
            <Label htmlFor="available" className="text-sm leading-none cursor-pointer">Available (Custom Hours)</Label>
          </div>
          <div className="flex items-center space-x-3">
            <RadioGroupItem value="unavailable" id="unavailable" className="flex-shrink-0" />
            <Label htmlFor="unavailable" className="text-sm leading-none cursor-pointer">Unavailable all day</Label>
          </div>
        </RadioGroup>
      </div>

      {dateStatus === 'available' && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          <div>
            <Label className="text-sm font-medium text-muted-foreground mb-2 block">Time Range</Label>
            <TimeRangePicker
              startTime={startTime}
              endTime={endTime}
              onStartTimeChange={(value) => onTimeChange('start_time', value)}
              onEndTimeChange={(value) => onTimeChange('end_time', value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-medium text-muted-foreground">
              Buffer Time
            </Label>
            <Select
              value={String(bufferMinutes)}
              onValueChange={(value) => onBufferChange(Number(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Buffer time between meetings" />
              </SelectTrigger>
              <SelectContent>
                {BUFFER_OPTIONS.map((buffer) => (
                  <SelectItem key={buffer} value={buffer.toString()}>
                    {buffer} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </motion.div>
      )}

      <div className="space-y-1">
        <Label className="text-sm font-medium text-muted-foreground">
          Note (Optional)
        </Label>
        <Textarea
          placeholder="Add a note about this date's availability"
          value={dateNote}
          onChange={(e) => onNoteChange(e.target.value)}
          className="resize-none"
          maxLength={500}
          aria-describedby="date-note-help"
        />
        <p id="date-note-help" className="text-xs text-muted-foreground">
          {dateNote.length}/500 characters
        </p>
      </div>
    </div>
  );
};

export default DateAvailabilitySettings;
