/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react';
import { Availability } from '@/types/booking';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { buildWeeklySchedule, isValidTimeWindow, normalizeTimeForInput } from '@/lib/availability';
import { saveWeeklySchedule } from '@/services/availabilityService';

interface AvailabilityContextProps {
  availabilities: Availability[];
  updateAvailability: (weekday: number, enabled: boolean, startTime?: string, endTime?: string, bufferMinutes?: number) => void;
  loading: boolean;
  saveChanges: () => Promise<void>;
  unsavedChanges: boolean;
}

const AvailabilityContext = createContext<AvailabilityContextProps | undefined>(undefined);

export const useAvailabilityContext = () => {
  const context = useContext(AvailabilityContext);
  if (!context) {
    throw new Error('useAvailabilityContext must be used within an AvailabilityProvider');
  }
  return context;
};

// Add an alias for useAvailabilityContext for backward compatibility
export const useAvailability = useAvailabilityContext;

interface AvailabilityProviderProps {
  children: ReactNode;
  initialAvailabilities?: Availability[];
}

export const AvailabilityProvider: React.FC<AvailabilityProviderProps> = ({ children, initialAvailabilities }) => {
  const { user } = useAuth();
  const [availabilities, setAvailabilities] = useState<Availability[]>(initialAvailabilities || []);
  const [loading, setLoading] = useState(!initialAvailabilities);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  const fetchAvailabilities = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('availabilities')
        .select('*')
        .eq('user_id', user.id);
      if (error) throw error;
      setAvailabilities((data as Availability[]).map((availability) => ({
        ...availability,
        start_time: normalizeTimeForInput(availability.start_time) ?? undefined,
        end_time: normalizeTimeForInput(availability.end_time) ?? undefined,
      })));
    } catch {
      toast.error('Failed to load availabilities');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!initialAvailabilities) void fetchAvailabilities();
  }, [fetchAvailabilities, initialAvailabilities]);

  // Update an availability for a specific weekday
  const updateAvailability = (weekday: number, enabled: boolean, startTime = '09:00', endTime = '17:00', bufferMinutes = 0) => {
    if (!user) return;

    setAvailabilities((current) => {
      const withoutDay = current.filter((availability) => availability.weekday !== weekday);
      if (!enabled) return withoutDay;

      const existing = current.find((availability) => availability.weekday === weekday);
      return [...withoutDay, {
        ...existing,
        id: existing?.id ?? crypto.randomUUID(),
        weekday,
        start_time: startTime,
        end_time: endTime,
        buffer_minutes: bufferMinutes,
      }];
    });

    setUnsavedChanges(true);
  };

  // Save all changes to Supabase
  const saveChanges = async () => {
    if (!user) return;

    const invalidDay = availabilities.find(
      (availability) => !isValidTimeWindow(availability.start_time ?? '', availability.end_time ?? ''),
    );
    if (invalidDay) {
      toast.error('Each available day must end after it starts.');
      return;
    }

    setLoading(true);
    try {
      await saveWeeklySchedule(buildWeeklySchedule(availabilities), fetchAvailabilities);

      setUnsavedChanges(false);
      toast.success('Availabilities saved successfully');
    } catch {
      toast.error('Failed to save availabilities');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AvailabilityContext.Provider
      value={{
        availabilities,
        updateAvailability,
        loading,
        saveChanges,
        unsavedChanges
      }}
    >
      {children}
    </AvailabilityContext.Provider>
  );
};
