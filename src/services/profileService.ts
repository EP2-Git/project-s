
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Profile, MeetingType } from '@/types/profile';

export async function fetchUserProfile(userId: string): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      full_name: data.full_name,
      username: data.username,
      timezone: data.timezone || null,
      created_at: data.created_at
    };
  } catch {
    return null;
  }
}

export async function fetchMeetingTypes(userId: string): Promise<MeetingType[]> {
  try {
    const { data, error } = await supabase
      .from('meeting_types')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch {
    toast.error('Unable to load meeting types. Please try again.');
    return [];
  }
}

export async function toggleMeetingTypeActive(meetingTypeId: string, currentStatus: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('meeting_types')
      .update({ active: !currentStatus })
      .eq('id', meetingTypeId);

    if (error) throw error;

    toast.success(currentStatus ? 'Meeting type deactivated' : 'Meeting type activated');
    return true;
  } catch {
    toast.error('Unable to update the meeting type. Please try again.');
    return false;
  }
}

export async function deleteMeetingType(meetingTypeId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('meeting_types')
      .delete()
      .eq('id', meetingTypeId);

    if (error) throw error;

    toast.success('Meeting type deleted');
    return true;
  } catch {
    toast.error('Unable to delete the meeting type. Please try again.');
    return false;
  }
}

export async function signOut(): Promise<boolean> {
  try {
    await supabase.auth.signOut();
    return true;
  } catch {
    toast.error('Error signing out');
    return false;
  }
}
