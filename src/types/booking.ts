export interface MeetingType {
  id: string;
  name?: string;
  duration?: number;
  description: string | null;
  location?: string | null;
  slug?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  timeZone?: string;
  availability?: Availability[];
  user?: UserProfile;

  // Additional properties used in other parts of the application
  title: string;
  duration_minutes: number;
  active?: boolean;
  created_at?: string;
  user_id: string;
}

export interface Availability {
  id: string;
  meetingTypeId?: string;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  bufferMinutes?: number;

  // Legacy snake_case support
  weekday?: number;
  start_time?: string;
  end_time?: string;
  buffer_minutes?: number;
  user_id?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  timeZone: string;
}

export interface Booking {
  id: string;
  meetingTypeId: string;
  bookerEmail: string;
  bookerName: string;
  startTime: string;
  endTime: string;
  timeZone?: string;
  createdAt: string;
  meetingType: MeetingType;
  status?: string;
  responses?: ResponsesData | string | null;

  // Additional properties for backwards compatibility
  start_time?: string;
  end_time?: string;
  meeting_type_id?: string;
  booker_name?: string;
  booker_email?: string;
  time_zone?: string;
  source?: 'project-s';
}

// Define a specific type for the responses data
export interface ResponsesData {
  summary?: string;
  notes?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date | string;
  end: Date | string;
  allDay?: boolean;
  description?: string;
  location?: string;
  status?: string;
  color?: string;
  bookerName?: string;
  bookerEmail?: string;
  source?: 'project-s';
  meeting_type_id?: string;
  responses?: ResponsesData | string | null;
  notes?: string;
  url?: string;
  raw?: unknown;
  booker?: {
    name: string;
    email: string;
  };
}

// Add missing types
export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  meeting_type_id: string;
}

export interface SpecificDateAvailability {
  id: string;
  userId: string;
  date: string;
  isAvailable: boolean;
  startTime?: string;
  endTime?: string;
  bufferMinutes?: number;
  status?: 'available' | 'unavailable' | 'default';
  note?: string | null;
  createdAt: string;
  updatedAt: string;

  // Legacy snake_case support
  start_time?: string;
  end_time?: string;
  buffer_minutes?: number;
}

// Modified SimpleCalendarEvent to include optional source field and notes/url
export interface SimpleCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  bookerName?: string;
  bookerEmail?: string;
  status: string;
  source?: 'project-s';
  responses?: ResponsesData | string | null;
  notes?: string;
  url?: string;
}
