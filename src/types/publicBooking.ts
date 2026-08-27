import {
  createBookingDataSchema,
  createBookingInputSchema,
  getBookingPageDataSchema,
  ianaTimeZoneSchema,
  isoInstantSchema,
  listFreeSlotsDataSchema,
  localDateSchema,
  prepareBookingDataSchema,
  prepareBookingInputSchema,
  publicMeetingTypeSchema,
  publicSlotSchema,
  publicUsernameSchema,
  type CreateBookingData,
  type CreateBookingInput,
  type GetBookingPageData,
  type ListFreeSlotsData,
  type PrepareBookingData,
  type PrepareBookingInput,
  type PublicMeetingType,
  type PublicSlot,
  type ProjectSProblemCode,
} from '@project-s/contracts';
import type { z } from 'zod';

export {
  createBookingDataSchema,
  createBookingInputSchema,
  getBookingPageDataSchema,
  ianaTimeZoneSchema,
  isoInstantSchema,
  listFreeSlotsDataSchema,
  localDateSchema,
  prepareBookingDataSchema,
  prepareBookingInputSchema,
  publicMeetingTypeSchema,
  publicSlotSchema,
  publicUsernameSchema,
};

// Compatibility aliases keep the React surface concise while the canonical
// definitions live in @project-s/contracts and generate every transport schema.
export const publicBookingPageSchema = getBookingPageDataSchema;
export const freeSlotsResponseSchema = listFreeSlotsDataSchema;
export const createPublicBookingRequestSchema = createBookingInputSchema;
export const createPublicBookingResponseSchema = createBookingDataSchema;

export type LocalDate = z.infer<typeof localDateSchema>;
export type IsoInstant = z.infer<typeof isoInstantSchema>;
export type IanaTimeZone = z.infer<typeof ianaTimeZoneSchema>;
export type {
  PublicMeetingType,
  PublicSlot,
  PrepareBookingInput,
  PrepareBookingData,
  CreateBookingInput,
  CreateBookingData,
};
export type PublicBookingPageDto = GetBookingPageData;
export type FreeSlotsResponse = ListFreeSlotsData;
export type PreparePublicBookingRequest = PrepareBookingInput;
export type PreparePublicBookingResponse = PrepareBookingData;
export type CreatePublicBookingRequest = CreateBookingInput;
export type CreatePublicBookingResponse = CreateBookingData;
export type BookingApiErrorCode = ProjectSProblemCode;
