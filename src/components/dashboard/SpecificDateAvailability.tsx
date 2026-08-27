
import React, { useState, useCallback, memo, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import DateSelectionCalendar from './DateSelectionCalendar';
import DateAvailabilitySettings from './DateAvailabilitySettings';
import { formatDateForDisplay } from '@/utils/dateUtils';
import {
  useSpecificDateAvailability,
  SpecificDateAvailability as SpecificDateAvailabilityType
} from '@/hooks/useSpecificDateAvailability';
import { toast } from 'sonner';
import { calendarDateToDateKey } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';
import { createLatestRequestGate, isValidTimeWindow } from '@/lib/availability';

interface SpecificDateAvailabilityProps {
  userId: string;
  hostTimeZone: IanaTimeZone;
}

const SpecificDateAvailability: React.FC<SpecificDateAvailabilityProps> = ({
  userId,
  hostTimeZone,
}) => {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dateStatus, setDateStatus] = useState<'available' | 'unavailable' | 'default'>('default');
  const [dateNote, setDateNote] = useState('');
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [refreshKey, setRefreshKey] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDateLoading, setIsDateLoading] = useState(false);
  const [loadSucceeded, setLoadSucceeded] = useState(false);
  const requestGateRef = useRef(createLatestRequestGate());

  const {
    loading: isLoading,
    saving: isSaving,
    fetchDateAvailability,
    saveDateAvailability,
    clearCache
  } = useSpecificDateAvailability(userId);

  const handleDateSelect = useCallback(async (date: Date | undefined) => {
    const requestToken = requestGateRef.current.begin();
    setSelectedDate(date);
    setLoadSucceeded(false);
    setValidationError(null);

    if (!date) {
      setIsDateLoading(false);
      return;
    }

    setIsDateLoading(true);

    try {
      const existingData = await fetchDateAvailability(date);
      if (!requestGateRef.current.isLatest(requestToken)) return;

      if (existingData) {
        setDateStatus(existingData.status);

        setDateNote(existingData.note || '');
        setBufferMinutes(existingData.bufferMinutes || 0);
        setStartTime(existingData.startTime || '09:00');
        setEndTime(existingData.endTime || '17:00');
      } else {
        setDateStatus('default');

        setDateNote('');
        setBufferMinutes(0);
        setStartTime('09:00');
        setEndTime('17:00');
      }
      setLoadSucceeded(true);
    } catch {
      if (!requestGateRef.current.isLatest(requestToken)) return;
      toast.error('Failed to load availability for this date', {
        description: 'Please try selecting the date again.',
        icon: <AlertTriangle className="h-5 w-5 text-destructive" />
      });
    } finally {
      if (requestGateRef.current.isLatest(requestToken)) setIsDateLoading(false);
    }
  }, [fetchDateAvailability]);

  const handleStatusChange = useCallback((status: 'available' | 'unavailable' | 'default') => {
    setDateStatus(status);
    setValidationError(null);

  }, []);

  const handleTimeChange = useCallback((field: 'start_time' | 'end_time', value: string) => {
    setValidationError(null);
    if (field === 'start_time') {
      setStartTime(value);
    } else {
      setEndTime(value);
    }
  }, []);

  const handleBufferChange = useCallback((buffer: number) => {
    setBufferMinutes(buffer);
  }, []);

  const handleNoteChange = useCallback((note: string) => {
    setDateNote(note);
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedDate || !userId || !loadSucceeded || isDateLoading) return;

    try {
      if (dateStatus === 'available' && !isValidTimeWindow(startTime, endTime)) {
        setValidationError('End time must be later than start time.');
        return;
      }
      setValidationError(null);

      const formattedDate = calendarDateToDateKey(selectedDate);

      const specificDateData: Omit<SpecificDateAvailabilityType, 'id'> = {
        userId,
        date: formattedDate,
        status: dateStatus,
        startTime: dateStatus === 'available' ? startTime : null,
        endTime: dateStatus === 'available' ? endTime : null,
        bufferMinutes: dateStatus === 'available' ? bufferMinutes : 0,
        note: dateNote || null,
        start_time: dateStatus === 'available' ? startTime : null,
        end_time: dateStatus === 'available' ? endTime : null,
        buffer_minutes: dateStatus === 'available' ? bufferMinutes : 0
      };

      const success = await saveDateAvailability(specificDateData);

      if (success) {
        toast.success(`Availability for ${formatDateForDisplay(selectedDate)} saved successfully`);
        clearCache();
        setRefreshKey(prev => prev + 1);
      }
    } catch {
      toast.error('Failed to save availability', {
        description: 'Please retry. Your previous settings remain unchanged.',
        icon: <AlertTriangle className="h-5 w-5 text-destructive" />
      });
    }
  }, [selectedDate, userId, loadSucceeded, isDateLoading, dateStatus, startTime, endTime, bufferMinutes, dateNote, saveDateAvailability, clearCache]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <DateSelectionCalendar
        key={refreshKey}
        selectedDate={selectedDate}
        onDateSelect={handleDateSelect}
        hostTimeZone={hostTimeZone}
      />

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">
            {selectedDate ? (
              `Availability for ${formatDateForDisplay(selectedDate)}`
            ) : (
              'Select a date to set availability'
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedDate && (
            <DateAvailabilitySettings
              dateStatus={dateStatus}
              onStatusChange={handleStatusChange}
              startTime={startTime}
              endTime={endTime}
              onTimeChange={handleTimeChange}
              bufferMinutes={bufferMinutes}
              onBufferChange={handleBufferChange}
              dateNote={dateNote}
              onNoteChange={handleNoteChange}
            />
          )}
          {validationError && (
            <p className="mt-4 text-sm text-destructive" role="alert">{validationError}</p>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={isSaving || !selectedDate || isLoading || isDateLoading || !loadSucceeded || Boolean(validationError)}
            className="min-w-[120px]"
          >
            {isSaving ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Saving...
              </>
            ) : (
              'Save Date Setting'
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};

export default memo(SpecificDateAvailability);
