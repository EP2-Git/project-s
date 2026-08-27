
import React, { useEffect, useCallback } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import AppSidebar from '@/components/dashboard/AppSidebar';
import { useProfileData } from '@/hooks/useProfileData';
import { useBookingsData } from '@/hooks/useBookingsData';
import DashboardLayout from '@/components/dashboard/DashboardLayout';
import { resolveIanaTimeZone } from '@/lib/time';

const DashboardPage = () => {
  const [activeTab, setActiveTab] = React.useState("overview");

  const {
    user,
    username,
    profile,
    meetingTypes,
    loading: profileLoading,
    handleToggleActive,
    handleDeleteMeetingType,
    handleSignOut,
    fetchMeetingTypes
  } = useProfileData();

  const hostTimeZone = resolveIanaTimeZone(profile?.timezone);

  const {
    bookings,
    loading: bookingsLoading,
    filter,
    setFilter,
    refreshData,
    hasCompletedFetch,
    isRateLimited,
    cancelBooking,
    cancelingBookingId,
  } = useBookingsData();

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const eventsLoading = (bookingsLoading && !hasCompletedFetch);

  const handleRefreshAllData = useCallback(() => {
    refreshData();
    if (user?.id) {
      fetchMeetingTypes(user.id);
    }
  }, [refreshData, fetchMeetingTypes, user?.id]);

  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'U';

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar
          onSignOut={handleSignOut}
          username={username}
          userInitial={userInitial}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 h-14 flex items-center gap-3 border-b border-border bg-background/80 backdrop-blur-md px-4">
            <SidebarTrigger />
            <div className="h-5 w-px bg-border" />
            <h1 className="text-sm font-medium text-muted-foreground">Dashboard</h1>
          </header>

          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto min-w-0 overflow-x-hidden">
            <DashboardLayout
              username={username}
              profile={profile}
              calendarEvents={bookings}
              bookingsLoading={eventsLoading}
              filter={filter}
              setFilter={setFilter}
              userId={user?.id}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              meetingTypes={meetingTypes}
              profileLoading={profileLoading}
              handleToggleActive={handleToggleActive}
              handleDeleteMeetingType={handleDeleteMeetingType}
              fetchMeetingTypes={fetchMeetingTypes}
              refreshBookings={handleRefreshAllData}
              hasCompletedFetch={hasCompletedFetch}
              isRateLimited={isRateLimited}
              cancelBooking={cancelBooking}
              cancelingBookingId={cancelingBookingId}
              hostTimeZone={hostTimeZone}
            />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardPage;
