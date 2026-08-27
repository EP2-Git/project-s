
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { useProfileData } from '@/hooks/useProfileData';
import { UserProfile } from '@/components/dashboard';
import ProfileHeader from '@/components/profile-settings/ProfileHeader';
import PersonalInfoForm from '@/components/profile-settings/PersonalInfoForm';
import BookingPageCard from '@/components/profile-settings/BookingPageCard';
import { getBrowserTimeZone } from '@/lib/time';

const ProfileSettingsPage = () => {
  const { user } = useAuth(); // user from useAuth is now the primary source
  const { profile, loading: profileLoading } = useProfileData();
  const [isFetchingProfile, setIsFetchingProfile] = useState(true);
  const [originalUsername, setOriginalUsername] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [formValues, setFormValues] = useState({
    username: '',
    fullName: '',
    timezone: getBrowserTimeZone(),
  });

  useEffect(() => {
    const fetchProfile = async () => {
      // user check is still important before fetching profile data
      if (!user) {
        setIsFetchingProfile(false); // Ensure loading state is updated
        return;
      }

      try {
        setIsFetchingProfile(true);
        const { data, error } = await supabase
          .from('profiles')
          .select('username, full_name, timezone')
          .eq('id', user.id)
          .single();

        if (error) throw error;

        setOriginalUsername(data.username || '');

        setFormValues({
          username: data.username || '',
          fullName: data.full_name || '',
          timezone: data.timezone || getBrowserTimeZone(),
        });

        if (typeof window !== 'undefined' && data.username) {
          setProfileUrl(`${window.location.origin}/book/${data.username}`);
        }
      } catch {
        toast.error('Failed to load profile information');
      } finally {
        setIsFetchingProfile(false);
      }
    };

    fetchProfile();
  }, [user]); // Depend on user from useAuth

  useEffect(() => {
    if (typeof window !== 'undefined' && originalUsername) {
      setProfileUrl(`${window.location.origin}/book/${originalUsername}`);
    }
  }, [originalUsername]);

  const handleProfileUpdate = (username: string) => {
    setOriginalUsername(username);
    if (typeof window !== 'undefined') {
      setProfileUrl(`${window.location.origin}/book/${username}`);
    }
  };

  // The direct navigation based on !user is removed.
  // PrivateRoute handles protecting this page.
  // If user becomes null while on this page (e.g., token expiry detected by useAuth),
  // PrivateRoute should handle the redirect.

  return (
    <div className="container max-w-4xl py-8">
      <ProfileHeader title="Profile Settings" backLink="/dashboard" />

      {/* Show UserProfile only if user and profile data are available and not loading */}
      {!isFetchingProfile && !profileLoading && user && profile && (
        <UserProfile user={user} profile={profile} loading={profileLoading || isFetchingProfile} />
      )}

      <div className="mt-8 grid gap-8">
        {isFetchingProfile || (profileLoading && !profile) ? ( // Adjusted loading condition
          <div className="flex justify-center p-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : user ? ( // Ensure user exists before rendering form
          <PersonalInfoForm
            userId={user.id}
            initialValues={formValues}
            originalUsername={originalUsername}
            onSuccess={handleProfileUpdate}
          />
        ) : null} {/* Render nothing or a placeholder if user is null and not loading */}

        {originalUsername && (
          <BookingPageCard
            profileUrl={profileUrl}
            username={originalUsername}
          />
        )}
      </div>
    </div>
  );
};

export default ProfileSettingsPage;
