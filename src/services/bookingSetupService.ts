import { supabase } from '@/lib/supabaseClient';
import { getDateKeyInTimeZone } from '@/lib/time';
import { ianaTimeZoneSchema, publicUsernameSchema } from '@/types/publicBooking';

export interface BookingSetupSnapshot {
  username: string | null;
  timezone: string | null;
  profileComplete: boolean;
  meetingTypeComplete: boolean;
  availabilityComplete: boolean;
}

interface BookingSetupOptions {
  signal?: AbortSignal;
  now?: () => Date;
}

// This reads saved setup through the signed-in user's existing RLS policies.
// It does not establish that a slot is currently free or grant booking authority.
export async function fetchBookingSetup(
  userId: string,
  { signal, now = () => new Date() }: BookingSetupOptions = {},
): Promise<BookingSetupSnapshot> {
  try {
    if (!userId) throw new Error();
    const profileQuery = supabase
      .from('profiles')
      .select('username, timezone')
      .eq('id', userId);
    const meetingQuery = supabase
      .from('meeting_types')
      .select('id')
      .eq('user_id', userId)
      .eq('active', true)
      .limit(1);
    const weeklyQuery = supabase
      .from('availabilities')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    const [profile, meeting, weekly] = await Promise.all([
      (signal ? profileQuery.abortSignal(signal) : profileQuery).maybeSingle(),
      signal ? meetingQuery.abortSignal(signal) : meetingQuery,
      signal ? weeklyQuery.abortSignal(signal) : weeklyQuery,
    ]);
    if (profile.error || meeting.error || weekly.error) throw new Error();

    const parsedUsername = publicUsernameSchema.safeParse(profile.data?.username);
    const parsedZone = ianaTimeZoneSchema.safeParse(profile.data?.timezone);
    let availabilityComplete = Boolean(weekly.data?.length);

    // Existing database constraints require valid ordered windows. An available
    // date is useful setup evidence only on/after today in the saved host zone.
    if (!availabilityComplete && parsedZone.success) {
      const dateQuery = supabase
        .from('specific_date_availabilities')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'available')
        .gte('date', getDateKeyInTimeZone(now(), parsedZone.data))
        .limit(1);
      const dates = await (signal ? dateQuery.abortSignal(signal) : dateQuery);
      if (dates.error) throw new Error();
      availabilityComplete = Boolean(dates.data?.length);
    }

    return {
      username: parsedUsername.success ? parsedUsername.data : null,
      timezone: parsedZone.success ? parsedZone.data : null,
      profileComplete: parsedUsername.success && parsedZone.success,
      meetingTypeComplete: Boolean(meeting.data?.length),
      availabilityComplete,
    };
  } catch {
    throw new Error('Could not check your saved setup.');
  }
}
