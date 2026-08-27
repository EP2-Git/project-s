
import React, { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { Profile } from '@/types/profile';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { BadgeCheck, Link as LinkIcon } from 'lucide-react';

interface UserProfileProps {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
}

const UserProfile: React.FC<UserProfileProps> = ({ user, profile, loading }) => {
  const [profileUrl, setProfileUrl] = useState<string | null>(null);

  useEffect(() => {
    // Ensure this runs client-side after component mounts
    if (typeof window !== 'undefined' && profile?.username) {
      setProfileUrl(`${window.location.origin}/book/${profile.username}`);
    } else {
      setProfileUrl(null);
    }
  }, [profile?.username]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="p-6 flex items-center space-x-4">
          <div className="h-12 w-12 rounded-full bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
            <div className="h-3 w-32 bg-muted animate-pulse rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!user || !profile) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <p className="text-center text-muted-foreground">No profile information available</p>
        </CardContent>
      </Card>
    );
  }

  const userInitial = (profile.full_name || user.email || '?').charAt(0).toUpperCase();
  const displayName = profile.full_name || user.email?.split('@')[0] || 'User';

  return (
    <Card className="w-full">
      <CardContent className="p-6">
        <div className="flex items-center space-x-4">
          <Avatar className="h-16 w-16 bg-lavender text-white">
            <AvatarFallback className="text-xl font-medium">{userInitial}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-semibold">{displayName}</h2>
              {profile.username && (
                <BadgeCheck className="h-5 w-5 text-lavender" />
              )}
            </div>
            {profileUrl && (
              <div className="flex items-center text-sm text-muted-foreground mt-1">
                <LinkIcon className="h-3.5 w-3.5 mr-1" />
                <span className="truncate">{profileUrl}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default UserProfile;
