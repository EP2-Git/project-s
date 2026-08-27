
import { format } from 'date-fns';

/**
 * Formats a date into a consistent format for database storage
 */
export const formatDateForDB = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

/**
 * Formats a date for display in the UI
 */
export const formatDateForDisplay = (date: Date): string => {
  return format(date, 'EEEE, MMMM d, yyyy');
};

/**
 * Determines if a date is in the past
 */
export const isDateInPast = (date: Date): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};
