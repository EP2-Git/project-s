import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  cancelBookingResponseSchema,
  type CancelBookingResponse,
} from '@/types/hostBooking';

export type HostBookingErrorCode =
  | 'VERSION_CONFLICT'
  | 'NOT_FOUND'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

export class HostBookingError extends Error {
  constructor(
    public readonly code: HostBookingErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HostBookingError';
  }
}

const codeFrom = (error: PostgrestError): HostBookingErrorCode => {
  const value = `${error.code} ${error.message} ${error.details ?? ''}`.toUpperCase();
  if (value.includes('VERSION_CONFLICT') || error.code === 'PT409') return 'VERSION_CONFLICT';
  if (value.includes('NOT_FOUND') || error.code === 'PT404') return 'NOT_FOUND';
  if (value.includes('AUTHENTICATION_REQUIRED') || error.code === 'PT401') {
    return 'AUTHENTICATION_REQUIRED';
  }
  if (value.includes('INVALID_REQUEST') || error.code === 'PT400') return 'INVALID_REQUEST';
  return 'INTERNAL_ERROR';
};

const publicMessage = (code: HostBookingErrorCode) => {
  switch (code) {
    case 'VERSION_CONFLICT':
      return 'This booking changed in another session. The latest booking data has been loaded.';
    case 'NOT_FOUND':
      return 'This booking no longer exists or is not available to this account.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Your session has expired. Sign in and try again.';
    case 'INVALID_REQUEST':
      return 'This cancellation request is invalid.';
    default:
      return 'Project S could not cancel this booking. Please try again.';
  }
};

export const cancelHostBooking = async (
  bookingId: string,
  expectedVersion: number,
): Promise<CancelBookingResponse> => {
  const { data, error } = await supabase.rpc('cancel_booking_v1', {
    p_booking_id: bookingId,
    p_expected_version: expectedVersion,
  });
  if (error) {
    const code = codeFrom(error);
    throw new HostBookingError(code, publicMessage(code), error);
  }

  const parsed = cancelBookingResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new HostBookingError(
      'INTERNAL_ERROR',
      'The scheduling service returned an invalid cancellation response.',
      parsed.error,
    );
  }
  return parsed.data;
};
