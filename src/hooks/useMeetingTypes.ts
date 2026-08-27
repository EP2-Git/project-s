
import { useState, useCallback, useEffect } from 'react';
import { MeetingType } from '@/types/profile';
import {
  fetchMeetingTypes as fetchMeetingTypesService,
  toggleMeetingTypeActive,
  deleteMeetingType
} from '@/services/profileService';
import { toast } from 'sonner';

export function useMeetingTypes(userId: string | undefined) {
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMeetingTypes = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const data = await fetchMeetingTypesService(id);
      setMeetingTypes(data);
    } catch {
      toast.error('Failed to load meeting types');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userId) {
      fetchMeetingTypes(userId);
    } else {
      setLoading(false);
    }
  }, [userId, fetchMeetingTypes]);

  const handleToggleActive = async (meetingTypeId: string, currentStatus: boolean) => {
    const success = await toggleMeetingTypeActive(meetingTypeId, currentStatus);

    if (success) {
      // Update the local state
      setMeetingTypes(meetingTypes.map(type =>
        type.id === meetingTypeId ? { ...type, active: !currentStatus } : type
      ));
    }
  };

  const handleDeleteMeetingType = async (meetingTypeId: string) => {
    if (!confirm('Are you sure you want to delete this meeting type?')) return;

    const success = await deleteMeetingType(meetingTypeId);

    if (success) {
      // Update the local state
      setMeetingTypes(meetingTypes.filter(type => type.id !== meetingTypeId));
    }
  };

  return {
    meetingTypes,
    loading,
    fetchMeetingTypes,
    handleToggleActive,
    handleDeleteMeetingType
  };
}
