
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { BookingEvent } from '@/hooks/useBookingsData';
import { Calendar, Clock, Mail, MessageSquare, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatSlotDateTime, formatSlotTime } from '@/lib/time';
import type { IanaTimeZone } from '@/types/publicBooking';
import { getSafeMailtoHref } from '@/lib/contact';

interface BookingDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  event: BookingEvent | null;
  hostTimeZone: IanaTimeZone;
}

const BookingDetailsDialog: React.FC<BookingDetailsDialogProps> = ({
  isOpen,
  onClose,
  event,
  hostTimeZone,
}) => {
  if (!event) return null;

  const startDate = event.start;
  const endDate = event.end;
  const safeMailtoHref = event.bookerEmail ? getSafeMailtoHref(event.bookerEmail) : null;

  const getBadgeVariant = (status?: string): 'secondary' | 'destructive' | 'outline' => {
    if (!status) return 'secondary';

    switch (status.toLowerCase()) {
      case 'confirmed':
        return 'secondary';
      case 'cancelled':
        return 'destructive';
      case 'tentative':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl">{event.title}</DialogTitle>
          {event.status && (
            <Badge variant={getBadgeVariant(event.status)} className="mt-2 w-fit">
              {event.status.charAt(0).toUpperCase() + event.status.slice(1)}
            </Badge>
          )}
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="flex items-start gap-2">
            <Calendar className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">When</p>
              <p className="text-muted-foreground text-sm">
                {formatSlotDateTime(startDate.toISOString(), hostTimeZone)}
              </p>
              <p className="text-muted-foreground text-sm">
                to {formatSlotTime(endDate.toISOString(), hostTimeZone)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <p className="font-medium">Duration</p>
              <p className="text-muted-foreground text-sm">
                {Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60))} minutes
              </p>
            </div>
          </div>

          {event.bookerName && (
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium">Guest</p>
                <p className="text-muted-foreground text-sm">{event.bookerName}</p>
              </div>
            </div>
          )}

          {event.bookerEmail && (
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary flex-shrink-0" />
              <div>
                <p className="font-medium">Email</p>
                {safeMailtoHref ? (
                  <a href={safeMailtoHref} className="text-blue-500 hover:underline text-sm">
                    {event.bookerEmail}
                  </a>
                ) : (
                  <p className="text-muted-foreground text-sm break-all">{event.bookerEmail}</p>
                )}
              </div>
            </div>
          )}

          {event.notes && (
            <div className="flex items-start gap-2">
              <MessageSquare className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">Guest notes</p>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{event.notes}</p>
              </div>
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BookingDetailsDialog;
