import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import BookingForm from '@/components/BookingForm';
import BookingHeader from '@/components/booking/BookingHeader';
import BookingReview from '@/components/booking/BookingReview';
import BookingSelector from '@/components/booking/BookingSelector';
import BookingSuccess from '@/components/booking/BookingSuccess';
import ErrorState from '@/components/booking/ErrorState';
import LoadingState from '@/components/booking/LoadingState';
import { useCreatePublicBooking } from '@/hooks/useCreatePublicBooking';
import { useFreeSlots } from '@/hooks/useFreeSlots';
import { usePreparePublicBooking } from '@/hooks/usePreparePublicBooking';
import { usePublicBookingPage } from '@/hooks/usePublicBookingPage';
import {
  PublicBookingError,
  publicBookingService,
} from '@/services/publicBookingService';
import {
  addDaysToDateKey,
  getBrowserTimeZone,
  getDateKeyInTimeZone,
} from '@/lib/time';
import type {
  CreatePublicBookingResponse,
  IanaTimeZone,
  LocalDate,
  PreparePublicBookingResponse,
  PublicMeetingType,
  PublicSlot,
} from '@/types/publicBooking';
import type { BookingFormValues } from '@/types/bookingForm';

const emptyDraft: BookingFormValues = {
  name: '',
  email: '',
  notes: '',
  terms: false,
};

interface PublicBookingPageProps {
  embed?: boolean;
}

const messageFrom = (error: unknown) =>
  error instanceof PublicBookingError
    ? error.message
    : 'Project S could not load scheduling information. Please try again.';

const PublicBookingPage: React.FC<PublicBookingPageProps> = ({ embed = false }) => {
  const { username } = useParams<{ username: string }>();
  const canonicalUsername = username?.trim().toLowerCase();
  const [displayTimeZone, setDisplayTimeZone] = useState<IanaTimeZone>(
    getBrowserTimeZone,
  );
  const [selectedDate, setSelectedDate] = useState<LocalDate>(() =>
    getDateKeyInTimeZone(new Date(), displayTimeZone),
  );
  const [selectedMeetingType, setSelectedMeetingType] =
    useState<PublicMeetingType | null>(null);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<PublicSlot | null>(null);
  const [draft, setDraft] = useState<BookingFormValues>(emptyDraft);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<CreatePublicBookingResponse | null>(null);
  const [preparation, setPreparation] =
    useState<PreparePublicBookingResponse | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [approvalRecorded, setApprovalRecorded] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const pageQuery = usePublicBookingPage(canonicalUsername);
  const slotsQuery = useFreeSlots({
    username: canonicalUsername,
    meetingTypeId: selectedMeetingType?.meetingTypeId,
    date: selectedDate,
    displayTimeZone,
  });
  const prepareBooking = usePreparePublicBooking();
  const createBooking = useCreatePublicBooking();

  useEffect(() => {
    const meetingTypes = pageQuery.data?.meetingTypes;
    if (!meetingTypes) return;

    setSelectedMeetingType((current) => {
      if (
        current &&
        meetingTypes.some(
          (item) => item.meetingTypeId === current.meetingTypeId,
        )
      ) {
        return current;
      }
      return meetingTypes.length === 1 ? meetingTypes[0] : null;
    });
  }, [pageQuery.data?.meetingTypes]);

  const minDate = useMemo(
    () => getDateKeyInTimeZone(new Date(), displayTimeZone),
    [displayTimeZone],
  );
  const maxDate = useMemo(
    () =>
      addDaysToDateKey(
        minDate,
        selectedMeetingType?.maxAdvanceDays ??
          Math.max(
            1,
            ...(pageQuery.data?.meetingTypes.map(
              (meetingType) => meetingType.maxAdvanceDays,
            ) ?? [90]),
          ),
      ),
    [minDate, pageQuery.data?.meetingTypes, selectedMeetingType?.maxAdvanceDays],
  );

  const chooseMeetingType = (meetingType: PublicMeetingType) => {
    setSelectedMeetingType(meetingType);
    setSelectedTimeSlot(null);
    setSubmissionError(null);
    setConfirmation(null);
    setPreparation(null);
    setChallengeToken(null);
    setApprovalRecorded(false);
  };

  const chooseDate = (date: LocalDate) => {
    setSelectedDate(date);
    setSelectedTimeSlot(null);
    setSubmissionError(null);
    setPreparation(null);
    setChallengeToken(null);
    setApprovalRecorded(false);
  };

  const chooseTimeZone = (timeZone: IanaTimeZone) => {
    setDisplayTimeZone(timeZone);
    setSelectedDate(getDateKeyInTimeZone(new Date(), timeZone));
    setSelectedTimeSlot(null);
    setSubmissionError(null);
    setPreparation(null);
    setChallengeToken(null);
    setApprovalRecorded(false);
  };

  const chooseTimeSlot = (slot: PublicSlot) => {
    setSelectedTimeSlot(slot);
    setIdempotencyKey(crypto.randomUUID());
    setSubmissionError(null);
    setPreparation(null);
    setChallengeToken(null);
    setApprovalRecorded(false);
  };

  const updateDraft = useCallback((values: BookingFormValues) => {
    setDraft(values);
  }, []);

  const submitBooking = async (values: BookingFormValues) => {
    if (!canonicalUsername || !selectedMeetingType || !selectedTimeSlot) return;
    setSubmissionError(null);

    try {
      const result = await prepareBooking.mutateAsync({
        username: canonicalUsername,
        meetingTypeId: selectedMeetingType.meetingTypeId,
        startAt: selectedTimeSlot.startAt,
        guestTimeZone: displayTimeZone,
        booker: {
          name: values.name,
          email: values.email,
          ...(values.notes ? { notes: values.notes } : {}),
        },
      });
      setPreparation(result);
      setChallengeToken(null);
      setApprovalRecorded(false);
      setSubmissionError(null);
    } catch (error) {
      setSubmissionError(messageFrom(error));
      if (
        error instanceof PublicBookingError &&
        error.code === 'SLOT_UNAVAILABLE'
      ) {
        await slotsQuery.refetch();
      }
    }
  };

  const confirmPreparedBooking = async () => {
    if (!preparation || (!approvalRecorded && !challengeToken)) return;
    setSubmissionError(null);
    setIsConfirming(true);
    let approved = approvalRecorded;

    try {
      if (!approved) {
        await publicBookingService.confirmPreparation({
          preparationToken: preparation.preparationToken,
          challengeToken: challengeToken!,
        });
        approved = true;
        setApprovalRecorded(true);
      }
      const result = await createBooking.mutateAsync({
        preparationToken: preparation.preparationToken,
        idempotencyKey,
      });
      setConfirmation(result);
      setPreparation(null);
      setChallengeToken(null);
      setApprovalRecorded(false);
      setDraft(emptyDraft);
    } catch (error) {
      setSubmissionError(messageFrom(error));
      setChallengeToken(null);
      if (
        error instanceof PublicBookingError &&
        ['PREPARATION_EXPIRED', 'PREPARATION_MISMATCH', 'PREPARATION_STALE'].includes(
          error.code,
        )
      ) {
        setPreparation(null);
        setApprovalRecorded(false);
      }
      if (
        error instanceof PublicBookingError &&
        error.code === 'SLOT_UNAVAILABLE'
      ) {
        setPreparation(null);
        setApprovalRecorded(false);
        setSelectedTimeSlot(null);
        await slotsQuery.refetch();
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const startAnotherBooking = () => {
    setConfirmation(null);
    setSelectedTimeSlot(null);
    setPreparation(null);
    setChallengeToken(null);
    setApprovalRecorded(false);
    setIdempotencyKey(crypto.randomUUID());
    setDraft(emptyDraft);
  };

  const shellClass = embed
    ? 'min-h-0 bg-transparent flex flex-col'
    : 'min-h-screen bg-background flex flex-col';

  if (pageQuery.isLoading) {
    return (
      <div className={shellClass}>
        {!embed && <BookingHeader />}
        <div className="flex flex-grow items-center justify-center p-4">
          <LoadingState />
        </div>
      </div>
    );
  }

  if (!canonicalUsername || pageQuery.isError || !pageQuery.data) {
    return (
      <div className={shellClass}>
        {!embed && <BookingHeader />}
        <div className="flex flex-grow items-center justify-center p-4">
          <ErrorState
            message={messageFrom(pageQuery.error)}
            onRetry={() => pageQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  const page = pageQuery.data;

  return (
    <div className={shellClass}>
      {!embed && <BookingHeader />}
      <main
        className={
          embed
            ? 'flex flex-grow items-start justify-center p-2 sm:p-4'
            : 'flex flex-grow items-center justify-center p-4 sm:p-6 md:p-8'
        }
      >
        <Card
          className={
            embed
              ? 'w-full max-w-5xl border-0 bg-transparent shadow-none'
              : 'w-full max-w-5xl shadow-md'
          }
        >
          <CardHeader className={embed ? 'pb-4' : 'border-b'}>
            <CardTitle className="text-xl sm:text-2xl">
              Book time with {page.displayName}
            </CardTitle>
            <CardDescription>
              Select a meeting type, date and available time. The host schedules in{' '}
              {page.hostTimeZone}.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {confirmation ? (
              <BookingSuccess
                confirmation={confirmation}
                displayTimeZone={displayTimeZone}
                onBookAnother={startAnotherBooking}
              />
            ) : preparation ? (
              <BookingReview
                preparationId={preparation.preparationId}
                expiresAt={preparation.expiresAt}
                summary={preparation.summary}
                error={submissionError}
                busy={isConfirming || createBooking.isPending}
                challengeToken={challengeToken}
                approvalRecorded={approvalRecorded}
                onChallengeTokenChange={setChallengeToken}
                onConfirm={confirmPreparedBooking}
                onBack={
                  approvalRecorded
                    ? undefined
                    : () => {
                        setPreparation(null);
                        setChallengeToken(null);
                        setApprovalRecorded(false);
                        setSubmissionError(null);
                      }
                }
              />
            ) : selectedTimeSlot && selectedMeetingType ? (
              <BookingForm
                timeSlot={selectedTimeSlot}
                meetingType={selectedMeetingType}
                displayTimeZone={displayTimeZone}
                initialValues={draft}
                submissionError={submissionError}
                onValuesChange={updateDraft}
                onSubmit={submitBooking}
                onCancel={() => {
                  setSelectedTimeSlot(null);
                  setSubmissionError(null);
                }}
              />
            ) : (
              <BookingSelector
                meetingTypes={page.meetingTypes}
                selectedMeetingType={selectedMeetingType}
                onMeetingTypeSelect={chooseMeetingType}
                selectedDate={selectedDate}
                onDateSelect={chooseDate}
                minDate={minDate}
                maxDate={maxDate}
                availableTimeSlots={slotsQuery.data?.slots ?? []}
                slotsLoading={slotsQuery.isFetching}
                slotsError={slotsQuery.isError ? messageFrom(slotsQuery.error) : null}
                onRetrySlots={() => slotsQuery.refetch()}
                onTimeSlotSelect={chooseTimeSlot}
                displayTimeZone={displayTimeZone}
                onTimeZoneChange={chooseTimeZone}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default PublicBookingPage;
