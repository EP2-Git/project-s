import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { useMeetingTypes } from './useMeetingTypes';
import { fetchUserProfile } from '@/services/profileService';
import type { Profile } from '@/types/profile';

export function useProfileData() {
  const { user, loading: authLoading, handleSignOut } = useAuth();
  const {
    meetingTypes,
    loading: meetingTypesLoading,
    fetchMeetingTypes,
    handleToggleActive,
    handleDeleteMeetingType
  } = useMeetingTypes(user?.id);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasAttemptedFetch, setHasAttemptedFetch] = useState(false);

  useEffect(() => {
    const initializeProfile = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          setLoading(false);
          return;
        }

        // Attempt to fetch existing profile
        const profileData = await fetchUserProfile(user.id);

        // Profiles are created by the authoritative database signup trigger.
        if (!profileData) {
          toast.error('Your profile is not ready yet. Refresh and try again.');
          return;
        }

        // If we have profile data at this point (either fetched or created), use it
        if (profileData) {
          setProfile(profileData);

          if (profileData.username) {
            setUsername(profileData.username);
          } else {
            // Username is null or empty - handle with fallback but don't show error
            setUsername(null);
          }

          // Fetch meeting types if profile was loaded successfully
          if (user.id) {
            try {
              await fetchMeetingTypes(user.id);
            } catch {
              // The meeting-type hook provides its own non-sensitive error state.
            }
          }
        }
      } catch {
        toast.error('Error loading profile information');
      } finally {
        setHasAttemptedFetch(true);
        setLoading(false);
      }
    };

    if (user && !authLoading) {
      initializeProfile();
    } else if (!user && !authLoading) {
      setLoading(false);
    }
  }, [user, authLoading, fetchMeetingTypes]);

  return {
    user,
    profile,
    meetingTypes,
    loading: loading || authLoading || meetingTypesLoading,
    username,
    hasAttemptedFetch,
    handleToggleActive,
    handleDeleteMeetingType,
    handleSignOut,
    fetchMeetingTypes
  };
}
