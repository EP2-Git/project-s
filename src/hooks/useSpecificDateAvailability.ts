import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { calendarDateToDateKey } from '@/lib/time';
import { buildSpecificDateWritePlan, normalizeTimeForInput } from '@/lib/availability';

const CACHE_DURATION = 5 * 60 * 1000;
const REQUEST_COOLDOWN = 5000;

export interface SpecificDateAvailability {
  id?: string;
  userId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  bufferMinutes: number | null;
  status: 'available' | 'unavailable' | 'default';
  note?: string | null;
  // Add backward compatibility fields
  start_time?: string | null;
  end_time?: string | null;
  buffer_minutes?: number | null;
}

export interface EditingDateType {
  date: string;
  status: 'available' | 'unavailable' | 'default';
  startTime?: string | null;
  endTime?: string | null;
  bufferMinutes?: number | null;
}

export const useSpecificDateAvailability = (userId: string | undefined) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const availabilityCacheRef = useRef<Map<string, {
    data: SpecificDateAvailability | null;
    timestamp: number;
  }>>(new Map());

  const clearCache = useCallback(() => {
    availabilityCacheRef.current.clear();
  }, []);

  const fetchDateAvailability = useCallback(async (date: Date): Promise<SpecificDateAvailability | null> => {
    if (!userId) {
      return null;
    }

    const formattedDate = calendarDateToDateKey(date);
    const now = Date.now();
    const cacheKey = `${userId}:${formattedDate}`;

    // Check cache
    const cached = availabilityCacheRef.current.get(cacheKey);
    if (cached) {
      if (now - cached.timestamp < REQUEST_COOLDOWN) {
        return cached.data;
      }
      if (now - cached.timestamp < CACHE_DURATION) {
        return cached.data;
      }
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('specific_date_availabilities')
        .select('id, user_id, date, start_time, end_time, buffer_minutes, status, note')
        .eq('user_id', userId)
        .eq('date', formattedDate)
        .maybeSingle();

      if (error) throw new Error('Unable to load this date setting.');

      const result = data ? {
        id: data.id,
        userId: data.user_id,
        date: data.date,
        startTime: normalizeTimeForInput(data.start_time),
        endTime: normalizeTimeForInput(data.end_time),
        bufferMinutes: data.buffer_minutes,
        status: data.status as 'available' | 'unavailable' | 'default',
        note: data.note,
        start_time: normalizeTimeForInput(data.start_time),
        end_time: normalizeTimeForInput(data.end_time),
        buffer_minutes: data.buffer_minutes
      } satisfies SpecificDateAvailability : null;

      availabilityCacheRef.current.set(cacheKey, { data: result, timestamp: now });
      return result;
    } catch {
      throw new Error('Unable to load this date setting.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const saveDateAvailability = useCallback(async (
    data: Omit<SpecificDateAvailability, 'id'>
  ): Promise<boolean> => {
    try {
      setSaving(true);

      // Get current authenticated user ID
      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (authError) {
        toast.error('Authentication error - please sign in again');
        return false;
      }

      const authUserId = authData?.user?.id;

      if (!authUserId) {
        toast.error('You must be signed in to save availability');
        return false;
      }

      // Validate we're only modifying our own data
      if (data.userId && data.userId !== authUserId) {
        toast.error('You can only modify your own availability');
        return false;
      }

      const writePlan = buildSpecificDateWritePlan(authUserId, data);

      // "Default" means true inheritance, so remove any override row.
      if (writePlan.operation === 'delete') {
        const { error } = await supabase
          .from('specific_date_availabilities')
          .delete()
          .eq('user_id', writePlan.userId)
          .eq('date', writePlan.date);

        if (error) throw error;
        availabilityCacheRef.current.delete(`${authUserId}:${writePlan.date}`);
        toast.success('Date now follows your weekly availability');
        return true;
      }

      const availabilityData = writePlan.row;

      // Guard clause for undefined user_id
      if (!availabilityData.user_id) {
        toast.error('Cannot save - missing user ID');
        return false;
      }

      const { error } = await supabase
        .from('specific_date_availabilities')
        .upsert(availabilityData, {
          onConflict: 'user_id,date'
        })
        .select('id, user_id, date, start_time, end_time, buffer_minutes, status, note');

      if (error) {
        // Handle specific error cases
        if (error.code === '42501' || error.message.includes('permission denied')) {
          toast.error('You do not have permission to save availability. Please contact support.');
          return false;
        }

        if (error.code === '23505' || error.message.includes('duplicate key')) {
          toast.error('This date already has availability set. Trying to update instead...');
          return false;
        }

        if (error.code === '403' || error.message.includes('forbidden')) {
          toast.error('You do not have permission to modify this availability.');
          return false;
        }

        if (error.code === '409' || error.message.includes('conflict')) {
          toast.error('Another update was in progress. Please try again.');
          return false;
        }

        throw error;
      }

      // Clear cache using authenticated user ID
      availabilityCacheRef.current.delete(`${authUserId}:${writePlan.row.date}`);
      toast.success('Availability saved successfully');

      return true;
    } catch {
      toast.error('Failed to save availability');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    loading,
    saving,
    fetchDateAvailability,
    saveDateAvailability,
    clearCache
  };
};
