import { AlertCircle, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatSlotDateTime, formatSlotTime } from '@/lib/time';
import type { PreparedBookingSummary } from '@project-s/contracts';
import HumanConfirmationChallenge from './HumanConfirmationChallenge';

interface BookingReviewProps {
  preparationId: string;
  expiresAt: string;
  summary: PreparedBookingSummary;
  error: string | null;
  busy: boolean;
  challengeToken: string | null;
  approvalRecorded?: boolean;
  confirmationNotice?: ReactNode;
  confirmationReady?: boolean;
  onChallengeTokenChange(token: string | null): void;
  onConfirm(): Promise<void>;
  onBack?: () => void;
  confirmLabel?: string;
}

const BookingReview = ({
  preparationId,
  expiresAt,
  summary,
  error,
  busy,
  challengeToken,
  approvalRecorded = false,
  confirmationNotice,
  confirmationReady = true,
  onChallengeTokenChange,
  onConfirm,
  onBack,
  confirmLabel = 'Confirm and book',
}: BookingReviewProps) => {
  const expired = new Date(expiresAt).getTime() <= Date.now();

  return (
    <section className="mx-auto max-w-2xl" aria-labelledby="booking-review-title">
      <div className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">Final review</p>
        <h2 id="booking-review-title" className="mt-1 text-2xl font-semibold">
          Confirm these booking details
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This preparation does not hold the time. Project S checks availability again when the booking is created.
        </p>
      </div>

      <dl className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Host</dt>
          <dd className="mt-1 font-medium">{summary.hostDisplayName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meeting</dt>
          <dd className="mt-1 font-medium">{summary.meetingTypeTitle}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Time</dt>
          <dd className="mt-1 font-medium">
            {formatSlotDateTime(summary.startAt, summary.guestTimeZone)} –{' '}
            {formatSlotTime(summary.endAt, summary.guestTimeZone)}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            Shown in {summary.guestTimeZone}; host time zone {summary.hostTimeZone}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</dt>
          <dd className="mt-1 break-words">{summary.booker.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
          <dd className="mt-1 break-all">{summary.booker.email}</dd>
        </div>
        {summary.booker.notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">{summary.booker.notes}</dd>
          </div>
        )}
      </dl>

      <div className="my-5 flex items-start gap-3 rounded-md border p-3 text-sm">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Review expires at{' '}
          {new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: summary.guestTimeZone,
          }).format(new Date(expiresAt))}.
        </p>
      </div>

      {confirmationNotice}

      {error && (
        <div role="alert" className="mb-5 flex gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {approvalRecorded ? (
        <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Human approval is recorded. You can safely retry with the same request key; Project S will return an already-created booking or reject an expired uncommitted review.
          </p>
        </div>
      ) : expired ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          This review expired. Return to the booking page and prepare it again.
        </p>
      ) : (
        <HumanConfirmationChallenge
          preparationId={preparationId}
          value={challengeToken}
          disabled={busy}
          onTokenChange={onChallengeTokenChange}
        />
      )}

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {onBack && !approvalRecorded ? (
          <Button type="button" variant="outline" onClick={onBack} disabled={busy}>
            Edit details
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          disabled={
            busy ||
            !confirmationReady ||
            (!approvalRecorded && (expired || !challengeToken))
          }
          onClick={() => void onConfirm()}
        >
          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
          {busy ? 'Confirming…' : approvalRecorded ? 'Create booking' : confirmLabel}
        </Button>
      </div>
    </section>
  );
};

export default BookingReview;
