
export interface Profile {
  id: string;
  full_name: string | null;
  username: string | null;
  timezone: string | null;
  created_at: string | null;
}

export interface MeetingType {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  created_at: string;
  active: boolean;
  user_id: string; // Add this to match booking.ts
}
