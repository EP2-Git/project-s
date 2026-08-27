
import React from 'react';
import DashboardGrid from './DashboardGrid';
import WidgetContainer from './WidgetContainer';
import DashboardBookingLinkCard from './DashboardBookingLinkCard';
import DashboardCalendar from './DashboardCalendar';
import BookingList from './BookingList';
import MeetingTypesList from './MeetingTypesList';
import AvailabilitySettings from './AvailabilitySettings';

import { Calendar, BookOpen, Clock } from 'lucide-react';
import type { BookingEvent } from '@/hooks/useBookingsData';
import type { MeetingType, Profile } from '@/types/profile';
import type { IanaTimeZone } from '@/types/publicBooking';

interface DashboardLayoutProps {
  username: string | null;
  profile?: Profile | null;
  calendarEvents: BookingEvent[];
  bookingsLoading: boolean;
  filter: 'all' | 'upcoming' | 'week';
  setFilter: (filter: 'all' | 'upcoming' | 'week') => void;
  userId: string | undefined;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  meetingTypes: MeetingType[];
  profileLoading: boolean;
  handleToggleActive: (meetingTypeId: string, currentStatus: boolean) => void;
  handleDeleteMeetingType: (meetingTypeId: string) => void;
  fetchMeetingTypes: (userId: string) => void;
  refreshBookings: () => void;
  hasCompletedFetch?: boolean;
  isRateLimited?: boolean;
  cancelBooking: (bookingId: string, expectedVersion: number) => Promise<void>;
  cancelingBookingId: string | null;
  hostTimeZone: IanaTimeZone;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  username,
  profile,
  calendarEvents,
  bookingsLoading,
  filter,
  setFilter,
  userId,
  activeTab,
  setActiveTab,
  meetingTypes,
  profileLoading,
  handleToggleActive,
  handleDeleteMeetingType,
  fetchMeetingTypes,
  refreshBookings,
  hasCompletedFetch = false,
  isRateLimited = false,
  cancelBooking,
  cancelingBookingId,
  hostTimeZone,
}) => {
  const isLoading = bookingsLoading && !hasCompletedFetch;

  const titles: Record<string, string> = {
    overview: 'Overview',
    bookings: 'Bookings',
    'meeting-types': 'Meeting types',
    availability: 'Availability',
  };

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{titles[activeTab] ?? 'Dashboard'}</h1>
      </div>

      {activeTab === 'overview' && (
        <DashboardGrid className="gap-x-6 gap-y-6">
          <div className="col-span-12 min-w-0">
            <DashboardBookingLinkCard username={username} profile={profile} />
          </div>

          <div className="col-span-12 md:col-span-8 min-w-0 overflow-hidden">
            <WidgetContainer
              title="Calendar"
              collapsible={true}
              headerRightContent={<Calendar className="h-4 w-4 text-muted-foreground" />}
              bodyClassName="p-0 sm:p-0"
            >
              <DashboardCalendar
                events={calendarEvents}
                loading={isLoading}
                filter={filter}
                setFilter={setFilter}
                hostTimeZone={hostTimeZone}
              />
            </WidgetContainer>
          </div>

          <div className="col-span-12 md:col-span-4 min-w-0">
            <div className="space-y-6">
              <WidgetContainer
                title="Upcoming Bookings"
                collapsible={true}
                headerRightContent={<BookOpen className="h-4 w-4 text-muted-foreground" />}
              >
                <BookingList
                  bookings={calendarEvents}
                  loading={isLoading}
                  filter="upcoming"
                  setFilter={setFilter}
                  refreshBookings={refreshBookings}
                  setActiveTab={setActiveTab}
                  compact={true}
                  isRateLimited={isRateLimited}
                  hostTimeZone={hostTimeZone}
                />
              </WidgetContainer>
            </div>
          </div>
        </DashboardGrid>
      )}

      {activeTab === 'bookings' && (
        <WidgetContainer title="All Bookings" headerRightContent={<BookOpen className="h-4 w-4 text-muted-foreground" />}>
          <BookingList
            bookings={calendarEvents}
            loading={isLoading}
            filter={filter}
            setFilter={setFilter}
            refreshBookings={refreshBookings}
            setActiveTab={setActiveTab}
            isRateLimited={isRateLimited}
            onCancelBooking={cancelBooking}
            cancelingBookingId={cancelingBookingId}
            hostTimeZone={hostTimeZone}
          />
        </WidgetContainer>
      )}

      {activeTab === 'meeting-types' && (
        <WidgetContainer title="Meeting Types" headerRightContent={<Clock className="h-4 w-4 text-muted-foreground" />}>
          <MeetingTypesList
            meetingTypes={meetingTypes}
            loading={profileLoading}
            userId={userId}
            onToggleActive={handleToggleActive}
            onDelete={handleDeleteMeetingType}
            onMeetingTypeCreated={() => userId && fetchMeetingTypes(userId)}
          />
        </WidgetContainer>
      )}

      {activeTab === 'availability' && (
        <WidgetContainer title="Availability" headerRightContent={<Calendar className="h-4 w-4 text-muted-foreground" />}>
          {userId && (
            <AvailabilitySettings userId={userId} hostTimeZone={hostTimeZone} />
          )}
        </WidgetContainer>
      )}
    </>
  );
};

export default DashboardLayout;
