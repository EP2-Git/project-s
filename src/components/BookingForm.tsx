import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatSlotDateTime, formatSlotTime } from '@/lib/time';
import type {
  IanaTimeZone,
  PublicMeetingType,
  PublicSlot,
} from '@/types/publicBooking';
import { bookingFormSchema, type BookingFormValues } from '@/types/bookingForm';

interface BookingFormProps {
  timeSlot: PublicSlot;
  meetingType: PublicMeetingType;
  displayTimeZone: IanaTimeZone;
  initialValues: BookingFormValues;
  submissionError: string | null;
  onValuesChange: (values: BookingFormValues) => void;
  onSubmit: (values: BookingFormValues) => Promise<void>;
  onCancel: () => void;
}

const BookingForm: React.FC<BookingFormProps> = ({
  timeSlot,
  meetingType,
  displayTimeZone,
  initialValues,
  submissionError,
  onValuesChange,
  onSubmit,
  onCancel,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: initialValues,
  });

  useEffect(() => {
    const subscription = form.watch((values) => {
      onValuesChange({
        name: values.name ?? '',
        email: values.email ?? '',
        notes: values.notes ?? '',
        terms: values.terms === true,
      });
    });
    return () => subscription.unsubscribe();
  }, [form, onValuesChange]);

  useEffect(() => {
    if (submissionError) errorRef.current?.focus();
  }, [submissionError]);

  const handleSubmit = async (values: BookingFormValues) => {
    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 rounded-lg border bg-muted/20 p-4">
        <p className="font-medium">{meetingType.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatSlotDateTime(timeSlot.startAt, displayTimeZone)} –{' '}
          {formatSlotTime(timeSlot.endAt, displayTimeZone)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Times shown in {displayTimeZone}
        </p>
      </div>

      {submissionError && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium">Booking not completed</p>
            <p className="mt-1 text-sm">{submissionError}</p>
          </div>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your name</FormLabel>
                <FormControl>
                  <Input autoComplete="name" placeholder="Example Guest" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your email</FormLabel>
                <FormControl>
                  <Input autoComplete="email" inputMode="email" type="email" maxLength={320} placeholder="guest@example.invalid" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Anything the host should know before the meeting"
                    className="resize-y"
                    rows={4}
                    {...field}
                  />
                </FormControl>
                <FormDescription>Optional. Maximum 2,000 characters.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="terms"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3 space-y-0 rounded-md border p-4">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Accept terms and privacy notice</FormLabel>
                  <FormDescription>
                    I agree to the <Link to="/terms" target="_blank" className="underline">terms</Link> and understand that my details will be shared with the host as described in the <Link to="/privacy" target="_blank" className="underline">privacy notice</Link>.
                  </FormDescription>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Choose another time
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Preparing…' : 'Review booking'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default BookingForm;
