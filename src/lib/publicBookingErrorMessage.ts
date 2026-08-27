import type { ProjectSProblemCode } from '@project-s/contracts';

const ORIGIN_NOT_ALLOWED_DETAIL =
  'This browser origin is not allowed to call Project S.';

export const PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE =
  'Project S could not reach the scheduling service. Check your connection and try again.';

export const PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE =
  'The scheduling service returned an invalid response.';

export const messageForPublicBookingProblem = (
  code: ProjectSProblemCode,
  detail?: string,
) => {
  if (code === 'FORBIDDEN' && detail === ORIGIN_NOT_ALLOWED_DETAIL) {
    return 'Site configuration error: this web address is not in Project S’s allowed origins. Ask the site administrator to update the booking-service configuration.';
  }

  switch (code) {
    case 'SLOT_UNAVAILABLE':
      return 'That time was just booked. Your details are still here; please choose another time.';
    case 'MEETING_TYPE_UNAVAILABLE':
    case 'NOT_FOUND':
      return 'This public booking option is no longer available.';
    case 'OUTSIDE_BOOKING_WINDOW':
      return 'That time is outside the host’s booking window.';
    case 'INVALID_TIME_ZONE':
      return 'The selected time zone is not supported.';
    case 'CONFIRMATION_REQUIRED':
      return 'Review and approve this booking in the confirmation step first.';
    case 'PREPARATION_EXPIRED':
      return 'This booking review expired. Review the booking again.';
    case 'PREPARATION_MISMATCH':
    case 'PREPARATION_STALE':
      return 'The host’s schedule changed. Review the current details again.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'This request key is already tied to different booking details. Check the original outcome before starting another booking.';
    case 'VALIDATION_ERROR':
      return 'Review the booking details and try again.';
    case 'RATE_LIMITED':
      return 'Too many requests were made. Please wait a moment and try again.';
    case 'FORBIDDEN':
    case 'INSUFFICIENT_SCOPE':
    case 'AUTHENTICATION_REQUIRED':
      return 'This booking action is not allowed.';
    case 'INTERNAL_ERROR':
      return 'The scheduling service is temporarily unavailable. Please try again.';
    default:
      return 'Project S could not complete this request. Please try again.';
  }
};
