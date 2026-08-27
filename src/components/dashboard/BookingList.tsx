
import React, { useState } from 'react';
import { Loader2, Calendar, Plus } from 'lucide-react';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import type { BookingEvent } from '@/hooks/useBookingsData';
import BookingRow from './BookingRow';
import BookingsToolbar from './BookingsToolbar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatSlotDateTime } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';
import { bookingIsVisibleInFilter } from '@/lib/dashboardTime';
import { useCurrentTime } from '@/hooks/useCurrentTime';

interface BookingListProps {
  bookings?: BookingEvent[];
  loading: boolean;
  filter: 'all' | 'upcoming' | 'week';
  setFilter: (filter: 'all' | 'upcoming' | 'week') => void;
  refreshBookings: () => void;
  setActiveTab?: (tab: string) => void;
  compact?: boolean;
  maxItems?: number;
  isRateLimited?: boolean;
  onCancelBooking?: (bookingId: string, expectedVersion: number) => Promise<void>;
  cancelingBookingId?: string | null;
  hostTimeZone: IanaTimeZone;
}

const BookingList: React.FC<BookingListProps> = ({
  bookings = [],
  loading,
  filter,
  setFilter,
  refreshBookings,
  setActiveTab,
  compact = false,
  maxItems = 5,
  isRateLimited = false,
  onCancelBooking,
  cancelingBookingId = null,
  hostTimeZone,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const now = useCurrentTime();

  const handleRefresh = () => {
    if (isRateLimited) {
      return;
    }

    setIsRefreshing(true);
    refreshBookings();

    // Set a timeout to reset the refreshing state
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  };

  const handleCreateMeetingTypeClick = () => {
    if (setActiveTab) {
      setActiveTab('meeting-types');
    }
  };

  const handleViewAllBookings = () => {
    if (setActiveTab) {
      setActiveTab('bookings');
    }
  };

  // Count sources for summary display
  // For compact view, display only a specified number of items
  const visibleBookings = bookings.filter((booking) =>
    bookingIsVisibleInFilter(booking.status, booking.start, filter, hostTimeZone, now),
  );
  const displayedBookings = compact ? visibleBookings.slice(0, maxItems) : visibleBookings;

  // Compact view renders a simpler list
  const renderCompactView = () => {
    if (loading) {
      return (
        <div className="flex flex-col justify-center items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary mb-2" />
          <span className="text-xs text-muted-foreground">Loading...</span>
        </div>
      );
    }

    if (visibleBookings.length === 0) {
      return (
        <div className="text-center py-6">
          <Calendar className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">No upcoming bookings</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {displayedBookings.map((booking) => (
          <div
            key={booking.id}
            className={cn(
              "flex flex-col p-3 border border-border rounded-md hover:bg-muted/30 transition-colors",
            )}
          >
            <div className="flex justify-between items-start mb-1">
              <div className="font-medium truncate">{booking.title}</div>
              <div className="flex items-center space-x-1">
                <Badge
                  variant="outline"
                  className={
                    booking.status === 'confirmed'
                      ? 'border-green-500/30 text-green-500 text-xs'
                      : 'border-amber-500/30 text-amber-500 text-xs'
                  }
                >
                  {booking.status || 'confirmed'}
                </Badge>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mb-1">
              {formatSlotDateTime(booking.start.toISOString(), hostTimeZone)}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {booking.bookerName} {booking.bookerEmail ? `• ${booking.bookerEmail}` : ''}
            </div>
          </div>
        ))}

        {visibleBookings.length > maxItems && (
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewAllBookings}
              className="w-full text-xs h-8"
            >
              View all ({visibleBookings.length}) bookings
            </Button>
          </div>
        )}
      </div>
    );
  };

  // Render compact or full view based on prop
  if (compact) {
    return renderCompactView();
  }

  return (
    <div className="space-y-4">
      <BookingsToolbar
        filter={filter}
        setFilter={setFilter}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        isRateLimited={isRateLimited}
      />

      {loading ? (
        // Loading state
        <div className="flex flex-col justify-center items-center py-12 border border-border rounded-md bg-card/50">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <span className="text-muted-foreground">Loading your bookings...</span>
        </div>
      ) : visibleBookings.length === 0 ? (
        // Empty state with call-to-action for new users
        <div className="text-center py-12 border border-border rounded-md bg-card/50">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No bookings found</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
            {filter === 'all'
              ? "You don't have any bookings yet. Create a meeting type so people can start booking time with you."
              : `No ${filter === 'upcoming' ? 'upcoming' : 'this week'} bookings found.`}
          </p>

          {filter === 'all' && (
            <Button onClick={handleCreateMeetingTypeClick}>
              <Plus className="mr-2 h-4 w-4" />
              Create a Meeting Type
            </Button>
          )}
        </div>
      ) : (
        // Booking list table
        <>
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Meeting</TableHead>
                  <TableHead className="hidden md:table-cell">Date & Time</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleBookings.map((booking) => (
                  <BookingRow
                    key={booking.id}
                    booking={booking}
                    onCancel={onCancelBooking}
                    isCancelling={cancelingBookingId === booking.id}
                    hostTimeZone={hostTimeZone}
                    now={now}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

    </div>
  );
};

export default BookingList;
