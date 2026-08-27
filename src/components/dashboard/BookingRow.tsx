import React from 'react';
import { Badge } from '@/components/ui/badge';
import { TableCell, TableRow } from '@/components/ui/table';
import type { BookingEvent } from '@/hooks/useBookingsData';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatSlotDateTime } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';
import { canCancelBooking } from '@/lib/dashboardTime';

interface BookingRowProps {
  booking: BookingEvent;
  onCancel?: (bookingId: string, expectedVersion: number) => Promise<void>;
  isCancelling?: boolean;
  hostTimeZone: IanaTimeZone;
  now: Date;
}

const BookingRow: React.FC<BookingRowProps> = ({
  booking,
  onCancel,
  isCancelling = false,
  hostTimeZone,
  now,
}) => {
  const dateTime = formatSlotDateTime(booking.start.toISOString(), hostTimeZone);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{booking.bookerName || 'No name'}</div>
        <div className="max-w-[180px] truncate text-sm text-muted-foreground">
          {booking.bookerEmail || 'No email'}
        </div>
        <div className="mt-2 text-xs text-muted-foreground md:hidden">{dateTime}</div>
        <Badge variant="outline" className="mt-2 md:hidden">
          {booking.status || 'confirmed'}
        </Badge>
        {canCancelBooking(booking.status, booking.start, now) && onCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3 w-full sm:w-auto"
                disabled={isCancelling}
                aria-label={`Cancel booking with ${booking.bookerName || 'guest'}`}
              >
                {isCancelling ? 'Cancelling…' : 'Cancel booking'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
                <AlertDialogDescription>
                  This releases the time for another guest. Core pre-alpha does not send a cancellation email, so contact the guest separately if needed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep booking</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void onCancel(booking.id, booking.version)}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Cancel booking
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </TableCell>
      <TableCell>{booking.title || 'Untitled meeting'}</TableCell>
      <TableCell className="hidden md:table-cell">{dateTime}</TableCell>
      <TableCell className="hidden md:table-cell">
        <Badge variant="outline">{booking.status || 'confirmed'}</Badge>
      </TableCell>
    </TableRow>
  );
};

export default BookingRow;
