import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSlotDateTime, formatSlotTime } from '@/lib/time';
import type {
  CreatePublicBookingResponse,
  IanaTimeZone,
} from '@/types/publicBooking';

interface BookingSuccessProps {
  confirmation: CreatePublicBookingResponse;
  displayTimeZone: IanaTimeZone;
  onBookAnother: () => void;
}

const BookingSuccess: React.FC<BookingSuccessProps> = ({
  confirmation,
  displayTimeZone,
  onBookAnother,
}) => (
  <section
    role="status"
    aria-live="polite"
    aria-labelledby="booking-success-title"
    className="mx-auto max-w-xl space-y-6 py-6 text-center"
  >
    <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" aria-hidden="true" />
    <div>
      <h2 id="booking-success-title" className="text-2xl font-semibold">
        Booking confirmed
      </h2>
      <p className="mt-2 text-muted-foreground">
        Save these details for your records.
      </p>
    </div>
    <dl className="rounded-lg border bg-muted/20 p-5 text-left">
      <div className="mb-4">
        <dt className="text-sm text-muted-foreground">Meeting</dt>
        <dd className="font-medium">{confirmation.meetingTypeTitle}</dd>
      </div>
      <div className="mb-4">
        <dt className="text-sm text-muted-foreground">When</dt>
        <dd className="font-medium">
          {formatSlotDateTime(confirmation.startAt, displayTimeZone)} –{' '}
          {formatSlotTime(confirmation.endAt, displayTimeZone)}
        </dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Confirmation</dt>
        <dd className="font-mono text-sm">{confirmation.confirmationCode}</dd>
      </div>
    </dl>
    <Button type="button" variant="outline" onClick={onBookAnother}>
      Book another time
    </Button>
  </section>
);

export default BookingSuccess;
