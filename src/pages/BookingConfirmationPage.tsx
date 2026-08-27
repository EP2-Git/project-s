import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Database, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import BookingHeader from '@/components/booking/BookingHeader';
import BookingReview from '@/components/booking/BookingReview';
import ErrorState from '@/components/booking/ErrorState';
import LoadingState from '@/components/booking/LoadingState';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  PublicBookingError,
  publicBookingService,
  type PreparationPreview,
} from '@/services/publicBookingService';

const tokenFromFragment = () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get('preparation');
  if (window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  return token;
};

const BookingConfirmationPage = () => {
  const [preparationToken] = useState(tokenFromFragment);
  const [preview, setPreview] = useState<PreparationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approvalTitleRef = useRef<HTMLHeadingElement>(null);

  const loadPreview = useCallback(async () => {
    if (!preparationToken) {
      setError('This confirmation link is missing its private preparation token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPreview(await publicBookingService.getPreparation(preparationToken));
    } catch (cause) {
      setError(
        cause instanceof PublicBookingError
          ? cause.message
          : 'Project S could not load this booking review.',
      );
    } finally {
      setLoading(false);
    }
  }, [preparationToken]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Review a prepared booking | Project S';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    if (confirmed) approvalTitleRef.current?.focus();
  }, [confirmed]);

  const confirm = async () => {
    if (!preparationToken || !challengeToken || !consentAccepted) return;
    setBusy(true);
    setError(null);
    try {
      await publicBookingService.confirmPreparation({
        preparationToken,
        challengeToken,
      });
      setConfirmed(true);
      setChallengeToken(null);
    } catch (cause) {
      setChallengeToken(null);
      setError(
        cause instanceof PublicBookingError
          ? cause.message
          : 'Project S could not approve this booking.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <BookingHeader />
      <main className="flex flex-grow items-center justify-center p-4 sm:p-6">
        <Card className="w-full max-w-3xl shadow-md" aria-labelledby="confirmation-page-title">
          <CardHeader className="border-b">
            <p className="text-sm font-medium text-muted-foreground">Authority boundary</p>
            <h1 id="confirmation-page-title" className="text-2xl font-semibold sm:text-3xl">
              Review a prepared booking
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              An app or agent prepared this request. It cannot create the booking until Project S records your explicit approval for these exact details.
            </p>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {loading ? (
              <LoadingState />
            ) : confirmed ? (
              <section
                className="py-8 text-center"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-labelledby="approval-title"
              >
                <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden="true" />
                <h2
                  ref={approvalTitleRef}
                  id="approval-title"
                  tabIndex={-1}
                  className="mt-4 text-2xl font-semibold outline-none"
                >
                  Human authority recorded
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
                  This page approved the exact preparation. It did not create or reserve a booking.
                </p>
                <div className="mx-auto mt-6 flex max-w-xl items-start gap-3 rounded-lg border bg-muted/20 p-4 text-left">
                  <Database className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <p className="text-sm leading-6">
                    Return to the app or agent that prepared the request. When it asks Project S to commit, the database will recheck the current time, policy, availability, confirmation, and authority under the host lock.
                  </p>
                </div>
              </section>
            ) : preview ? (
              <div>
                <div
                  className="mb-6 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
                  role="status"
                  aria-live="polite"
                >
                  <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <p className="font-medium">Agent create is blocked</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      No booking exists yet, and this preparation holds no time. Project S requires this browser review before it records the one-use authority needed for a later create attempt.
                    </p>
                  </div>
                </div>
                <BookingReview
                  preparationId={preview.preparationId}
                  expiresAt={preview.expiresAt}
                  summary={preview.summary}
                  error={error}
                  busy={busy}
                  challengeToken={challengeToken}
                  confirmationReady={consentAccepted}
                  confirmationNotice={
                    <label className="mb-5 flex items-start gap-3 rounded-md border p-4">
                      <Checkbox
                        checked={consentAccepted}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setConsentAccepted(checked === true)
                        }
                      />
                      <span className="text-sm leading-5">
                        <span className="block font-medium">
                          Accept terms and privacy notice
                        </span>
                        I agree to the{' '}
                        <Link to="/terms" target="_blank" className="underline">
                          terms
                        </Link>{' '}
                        and understand that my details will be shared with the host
                        as described in the{' '}
                        <Link to="/privacy" target="_blank" className="underline">
                          privacy notice
                        </Link>
                        .
                      </span>
                    </label>
                  }
                  onChallengeTokenChange={setChallengeToken}
                  onConfirm={confirm}
                  confirmLabel="Approve booking"
                />
              </div>
            ) : (
              <ErrorState
                message={error ?? 'This booking preparation is unavailable.'}
                onRetry={loadPreview}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default BookingConfirmationPage;
