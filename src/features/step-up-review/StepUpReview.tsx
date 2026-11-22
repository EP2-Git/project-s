import { useEffect, useId, useRef, useState, type Ref } from 'react';
import {
  v2InstantSchema,
  v2InstantToEpochMicroseconds,
  v2UuidSchema,
  type V2StepUpApproveInput,
  type V2StepUpApprovedData,
  type V2StepUpReviewData,
  type V2StepUpRevokeInput,
} from '@project-s/contracts/v2';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StepUpReviewClientError, type StepUpReviewClient } from '@/services/stepUpReviewClient';

interface StepUpReviewProps {
  reviewId: string;
  sessionKey: string | null;
  client: StepUpReviewClient | null;
  onSignIn?: () => void;
}

type Attempt =
  | { action: 'approve'; reviewId: string; input: V2StepUpApproveInput }
  | { action: 'decline'; reviewId: string; input: V2StepUpRevokeInput };
type Screen =
  | { phase: 'loading' }
  | { phase: 'pending'; review: V2StepUpReviewData; attempt?: Attempt; processing?: boolean;
      error?: 'busy' | 'uncertain'; retryAt?: number }
  | { phase: 'read_error'; error: 'busy' | 'uncertain'; retryAt?: number }
  | { phase: 'approved'; approval: V2StepUpApprovedData; timeZone: string }
  | { phase: 'declined' }
  | { phase: 'authentication' }
  | { phase: 'unavailable' }
  | { phase: 'refused'; reason: 'slot_unavailable' | 'outside_booking_window' };

const clientKeys = new WeakMap<StepUpReviewClient, number>();
let nextClientKey = 0;
const clientKey = (client: StepUpReviewClient) => {
  let key = clientKeys.get(client);
  if (key === undefined) {
    key = ++nextClientKey;
    clientKeys.set(client, key);
  }
  return key;
};

const errorKind = (error: unknown) => error instanceof StepUpReviewClientError ? error.kind : 'uncertain';
const retryTime = (error: unknown) => Date.now() + (
  error instanceof StepUpReviewClientError && error.retryAfterSeconds !== undefined
    ? error.retryAfterSeconds : 1
) * 1_000;

const timeText = (instant: string, timeZone: string) => {
  const date = new Date(instant);
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'long' };
  try {
    return { text: new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(date), fallback: false };
  } catch {
    return { text: new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(date), fallback: true };
  }
};

function ReviewedTime({ instant, timeZone }: { instant: string; timeZone: string }) {
  const formatted = timeText(instant, timeZone);
  return (
    <>
      <time dateTime={instant}>{formatted.text}</time>
      {formatted.fallback && (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          Shown in UTC; this device cannot display the reviewed time zone {timeZone}.
          <span className="mt-1 block break-all font-mono">UTC instant: {instant}</span>
        </span>
      )}
    </>
  );
}

const durationText = (review: V2StepUpReviewData) => {
  const duration = v2InstantToEpochMicroseconds(review.exactSummary.endAt) -
    v2InstantToEpochMicroseconds(review.exactSummary.startAt);
  if (duration % 60_000_000n === 0n) return `${duration / 60_000_000n} minutes`;
  const fraction = (duration % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${duration / 1_000_000n}${fraction ? `.${fraction}` : ''} seconds`;
};

const differenceLabels = {
  host: 'Host', meeting_type: 'Meeting type', meeting_window: 'Meeting time', duration: 'Duration',
} as const;

function DifferenceValue({ field, value, timeZone }: {
  field: V2StepUpReviewData['differences'][number]['field']; value: string; timeZone: string;
}) {
  if (field === 'duration' && /^\d+$/.test(value)) return <>{value} minutes</>;
  if (field === 'meeting_window') {
    const instants = value.split(' / ');
    if (instants.length === 2 && instants.every((instant) => v2InstantSchema.safeParse(instant).success)) {
      return <><ReviewedTime instant={instants[0]} timeZone={timeZone} />{' – '}<ReviewedTime instant={instants[1]} timeZone={timeZone} /></>;
    }
  }
  return <>{value}</>;
}

function SignInNotice({ onSignIn, headingRef }: { onSignIn?: () => void; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <div className="space-y-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Sign in to review this request</h2>
      <p className="text-sm text-muted-foreground">Use the account that owns this request. The link alone does not give permission to view or approve it.</p>
      {onSignIn && <Button type="button" className="min-h-11" onClick={onSignIn}>Sign in</Button>}
    </div>
  );
}

function ActiveReview({ reviewId, client, onSignIn }: {
  reviewId: string; client: StepUpReviewClient; onSignIn?: () => void;
}) {
  const [screen, setScreen] = useState<Screen>({ phase: 'loading' });
  const [reload, setReload] = useState(0);
  const [, updateClock] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const outcome = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    inFlight.current = true;
    const operation = ++generation.current;
    const controller = new AbortController();
    const current = () => mounted.current && generation.current === operation && !controller.signal.aborted;
    const load = async () => client.getReview(reviewId, controller.signal);
    void load().then((review) => {
      if (!current()) return;
      setScreen(review.reviewId === reviewId
        ? { phase: 'pending', review }
        : { phase: 'unavailable' });
    }, (error: unknown) => {
      if (!current()) return;
      const kind = errorKind(error);
      setScreen(kind === 'authentication' ? { phase: 'authentication' }
        : kind === 'unavailable' ? { phase: 'unavailable' }
        : { phase: 'read_error', error: kind === 'busy' ? 'busy' : 'uncertain',
          ...(kind === 'busy' ? { retryAt: retryTime(error) } : {}) });
    }).finally(() => {
      if (current()) inFlight.current = false;
    });
    return () => {
      mounted.current = false;
      controller.abort();
      actionController.current?.abort();
      inFlight.current = false;
    };
  }, [client, reviewId, reload]);

  const retryAt = (screen.phase === 'pending' || screen.phase === 'read_error') ? screen.retryAt : undefined;
  useEffect(() => {
    if (retryAt === undefined || retryAt <= Date.now()) return;
    const timer = window.setTimeout(() => updateClock((tick) => tick + 1), Math.min(retryAt - Date.now(), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  useEffect(() => {
    if (screen.phase !== 'loading' && screen.phase !== 'pending') outcome.current?.focus();
  }, [screen.phase]);

  const checkAgain = () => {
    if (inFlight.current || (retryAt !== undefined && retryAt > Date.now())) return;
    inFlight.current = true;
    setScreen({ phase: 'loading' });
    setReload((value) => value + 1);
  };

  const submit = async (action: Attempt['action']) => {
    if (inFlight.current || screen.phase !== 'pending' ||
        (screen.retryAt !== undefined && screen.retryAt > Date.now()) ||
        (screen.attempt !== undefined && screen.attempt.action !== action)) return;
    inFlight.current = true;
    const attempt: Attempt = screen.attempt ?? (action === 'approve'
      ? { action, reviewId: screen.review.reviewId, input: Object.freeze({
        expectedRevision: screen.review.revision, summaryDigest: screen.review.summaryDigest,
      }) }
      : { action, reviewId: screen.review.reviewId, input: Object.freeze({ expectedRevision: screen.review.revision }) });
    const review = screen.review;
    const operation = ++generation.current;
    const controller = new AbortController();
    actionController.current = controller;
    const current = () => mounted.current && generation.current === operation && !controller.signal.aborted;
    setScreen({ phase: 'pending', review, attempt, processing: true });
    try {
      if (attempt.action === 'approve') {
        const approval = await client.approve(attempt.reviewId, attempt.input, controller.signal);
        if (current()) setScreen(approval.reviewId === attempt.reviewId
          ? { phase: 'approved', approval, timeZone: review.exactSummary.guestTimeZone }
          : { phase: 'pending', review, attempt, error: 'uncertain' });
      } else {
        const declined = await client.decline(attempt.reviewId, attempt.input, controller.signal);
        if (current()) setScreen(declined.reviewId === attempt.reviewId
          ? { phase: 'declined' }
          : { phase: 'pending', review, attempt, error: 'uncertain' });
      }
    } catch (error) {
      if (!current()) return;
      const kind = errorKind(error);
      setScreen(kind === 'authentication' ? { phase: 'authentication' }
        : kind === 'unavailable' ? { phase: 'unavailable' }
        : kind === 'slot_unavailable' || kind === 'outside_booking_window' ? { phase: 'refused', reason: kind }
        : { phase: 'pending', review, attempt, error: kind === 'busy' ? 'busy' : 'uncertain',
          ...(kind === 'busy' ? { retryAt: retryTime(error) } : {}) });
    } finally {
      if (current()) {
        inFlight.current = false;
        actionController.current = null;
      }
    }
  };

  if (screen.phase === 'loading') return (
    <div role="status" aria-live="polite" className="space-y-4">
      <p>Loading this request…</p>
      <Skeleton className="h-24 w-full" aria-hidden="true" />
      <Skeleton className="h-16 w-full" aria-hidden="true" />
    </div>
  );
  if (screen.phase === 'authentication') return <SignInNotice onSignIn={onSignIn} headingRef={outcome} />;
  if (screen.phase === 'unavailable') return (
    <div className="space-y-3">
      <h2 ref={outcome} tabIndex={-1} className="text-xl font-semibold outline-none">This request is no longer available</h2>
      <p className="text-sm text-muted-foreground">Ask your agent to check its current permission.</p>
    </div>
  );
  if (screen.phase === 'approved') return (
    <div role="status" className="space-y-3">
      <h2 ref={outcome} tabIndex={-1} className="text-xl font-semibold outline-none">Approval recorded</h2>
      <p>Your approval is permission to book, not a booking confirmation. Ask your agent for the booking result.</p>
      <p className="text-sm text-muted-foreground">Approval deadline: <ReviewedTime instant={screen.approval.expiresAt} timeZone={screen.timeZone} /></p>
    </div>
  );
  if (screen.phase === 'declined') return (
    <div role="status" className="space-y-3">
      <h2 ref={outcome} tabIndex={-1} className="text-xl font-semibold outline-none">Request declined</h2>
      <p className="text-sm text-muted-foreground">Your agent’s existing permission stays unchanged if it remains valid.</p>
    </div>
  );
  if (screen.phase === 'refused') return (
    <div className="space-y-3">
      <h2 ref={outcome} tabIndex={-1} className="text-xl font-semibold outline-none">
        {screen.reason === 'slot_unavailable' ? 'That time is no longer available' : 'That time is outside the host’s booking window'}
      </h2>
      <p className="text-sm text-muted-foreground">Ask your agent to find another time. No different meeting has been approved here.</p>
    </div>
  );
  if (screen.phase === 'read_error') return (
    <div className="space-y-4">
      <h2 ref={outcome} tabIndex={-1} className="text-xl font-semibold outline-none">Unable to check this request</h2>
      <p className="text-sm text-muted-foreground">{screen.error === 'busy' ? 'The service is busy. Wait a moment and check again.' : 'Check your connection and try again. No meeting details are available yet.'}</p>
      <Button type="button" className="min-h-11 whitespace-normal" disabled={retryAt !== undefined && retryAt > Date.now()} onClick={checkAgain}>Check this request again</Button>
    </div>
  );

  const { review, attempt, processing } = screen;
  const summary = review.exactSummary;
  const waiting = retryAt !== undefined && retryAt > Date.now();
  const actionLabel = (action: Attempt['action']) => processing && attempt?.action === action
    ? action === 'approve' ? 'Recording approval…' : 'Declining request…'
    : attempt?.action === action ? `Retry the same ${action === 'approve' ? 'approval' : 'decline'}`
    : action === 'approve' ? 'Approve this request' : 'Decline this request';
  return (
    <div className="min-w-0 space-y-5">
      <Card>
        <CardHeader><h2 className="text-lg font-semibold">Meeting details</h2></CardHeader>
        <CardContent>
          <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2 [&>div]:min-w-0 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:wrap-break-word [&_dd]:font-medium">
            <div><dt>Host</dt><dd>{summary.hostDisplayName} <span className="font-normal text-muted-foreground">@{summary.username}</span></dd></div>
            <div><dt>Meeting</dt><dd>{summary.meetingTypeTitle}</dd></div>
            <div className="sm:col-span-2"><dt>Starts</dt><dd><ReviewedTime instant={summary.startAt} timeZone={summary.guestTimeZone} /></dd></div>
            <div className="sm:col-span-2"><dt>Ends</dt><dd><ReviewedTime instant={summary.endAt} timeZone={summary.guestTimeZone} /></dd></div>
            <div><dt>Duration</dt><dd>{durationText(review)}</dd></div>
            <div><dt>Reviewed time zones</dt><dd>Guest: {summary.guestTimeZone}<br />Host: {summary.hostTimeZone}</dd></div>
            <div><dt>Name</dt><dd>{summary.name}</dd></div>
            <div><dt>Email</dt><dd className="break-all">{summary.email}</dd></div>
          </dl>
        </CardContent>
      </Card>
      <div>
        <h2 className="text-lg font-semibold">Why approval is needed</h2>
        <p className="mt-1 text-sm text-muted-foreground">This meeting is outside the permission already given.</p>
        <ul className="mt-3 space-y-3">
          {review.differences.map((difference, index) => (
            <li key={`${difference.field}-${index}`} className="min-w-0 rounded-md border p-3 text-sm">
              <h3 className="font-semibold">{differenceLabels[difference.field]}</h3>
              <dl className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2 [&>div]:min-w-0 [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:wrap-break-word">
                <div><dt>Current permission</dt><dd><DifferenceValue field={difference.field} value={difference.reviewed} timeZone={summary.guestTimeZone} /></dd></div>
                <div><dt>Requested meeting</dt><dd><DifferenceValue field={difference.field} value={difference.proposed} timeZone={summary.guestTimeZone} /></dd></div>
              </dl>
            </li>
          ))}
        </ul>
      </div>
      <p className="rounded-md border bg-muted/20 p-4 text-sm">Approving replaces your agent’s unused one-booking permission with permission for this exact meeting once. Project S checks permission and availability again when you approve. The time is not reserved.</p>
      <p className="text-sm text-muted-foreground">Review deadline: <ReviewedTime instant={review.expiresAt} timeZone={summary.guestTimeZone} /></p>
      {screen.error && (
        <Alert role="alert">
          <h2 className="mb-2 font-semibold">{screen.error === 'busy' ? 'The service is busy.' : 'We haven’t received the result yet.'}</h2>
          <AlertDescription>{screen.error === 'busy' ? 'Wait a moment, then retry the same request.' : 'The request may have been recorded. Retry only the same action to check its result.'}</AlertDescription>
        </Alert>
      )}
      {processing && <p role="status" aria-live="polite">Sending your {attempt?.action === 'approve' ? 'approval' : 'decline'}…</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="button" className="min-h-11 whitespace-normal" disabled={processing || waiting || (attempt !== undefined && attempt.action !== 'approve')} onClick={() => void submit('approve')}>{actionLabel('approve')}</Button>
        <Button type="button" variant="outline" className="min-h-11 whitespace-normal" disabled={processing || waiting || (attempt !== undefined && attempt.action !== 'decline')} onClick={() => void submit('decline')}>{actionLabel('decline')}</Button>
      </div>
      <p className="text-sm text-muted-foreground">Declining this request leaves your agent’s existing permission unchanged if it remains valid.</p>
    </div>
  );
}

export default function StepUpReview({ reviewId, sessionKey, client, onSignIn }: StepUpReviewProps) {
  const titleId = useId();
  const parsedId = v2UuidSchema.safeParse(reviewId);
  return (
    <section aria-labelledby={titleId} className="mx-auto w-full min-w-0 max-w-2xl space-y-6 px-4 py-6 sm:px-6">
      <h1 id={titleId} className="text-2xl font-semibold">Review this meeting</h1>
      {sessionKey === null ? <SignInNotice onSignIn={onSignIn} />
        : client === null || !parsedId.success ? (
          <div className="space-y-3"><h2 className="text-xl font-semibold">This request is no longer available</h2><p className="text-sm text-muted-foreground">Ask your agent to check its current permission.</p></div>
        ) : <ActiveReview key={JSON.stringify([parsedId.data, sessionKey, clientKey(client)])} reviewId={parsedId.data} client={client} onSignIn={onSignIn} />}
    </section>
  );
}
