import { z } from 'zod';

import {
  bookerNode,
  descriptionNode,
  displayNameNode,
  httpsOrLocalUrlNode,
  ianaTimeZoneNode,
  isoInstantNode,
  localDateNode,
  nullablePublicUrlNode,
  preparationTokenNode,
  publicUsernameNode,
  successEnvelopeNode,
  titleNode,
  uuidNode,
  type ProjectSSuccessEnvelope,
} from './common.js';
import {
  arrayNode,
  contractNode,
  objectNode,
  type ContractNode,
} from './schema.js';

const durationMinutesNode = contractNode(z.number().int().min(5).max(1_440), {
  type: 'integer',
  minimum: 5,
  maximum: 1_440,
});
const minNoticeMinutesNode = contractNode(
  z.number().int().nonnegative().max(525_600),
  { type: 'integer', minimum: 0, maximum: 525_600 },
);
const maxAdvanceDaysNode = contractNode(z.number().int().min(1).max(730), {
  type: 'integer',
  minimum: 1,
  maximum: 730,
});

export const publicMeetingTypeNode = objectNode(
  {
    description: descriptionNode,
    durationMinutes: durationMinutesNode,
    maxAdvanceDays: maxAdvanceDaysNode,
    meetingTypeId: uuidNode,
    minNoticeMinutes: minNoticeMinutesNode,
    title: titleNode,
  },
  { title: 'PublicMeetingType' },
);
export const publicMeetingTypeSchema = publicMeetingTypeNode.zod;

const publicSlotBaseNode = objectNode(
  {
    endAt: isoInstantNode,
    startAt: isoInstantNode,
  },
  { title: 'PublicSlot' },
);
export const publicSlotNode: ContractNode<z.ZodEffects<typeof publicSlotBaseNode.zod>> =
  contractNode(
    publicSlotBaseNode.zod.refine(
      ({ startAt, endAt }) => new Date(endAt).getTime() > new Date(startAt).getTime(),
      { message: 'endAt must be later than startAt.', path: ['endAt'] },
    ),
    publicSlotBaseNode.jsonSchema,
  );
export const publicSlotSchema = publicSlotNode.zod;

export const getBookingPageInputNode = objectNode(
  { username: publicUsernameNode },
  { title: 'GetBookingPageInput' },
);
export const getBookingPageInputSchema = getBookingPageInputNode.zod;

export const getBookingPageDataNode = objectNode(
  {
    avatarUrl: nullablePublicUrlNode,
    displayName: displayNameNode,
    hostTimeZone: ianaTimeZoneNode,
    meetingTypes: arrayNode(publicMeetingTypeNode, { maxItems: 100 }),
    username: publicUsernameNode,
  },
  { title: 'GetBookingPageData' },
);
export const getBookingPageDataSchema = getBookingPageDataNode.zod;
export const getBookingPageResponseNode = successEnvelopeNode(getBookingPageDataNode);
export const getBookingPageResponseSchema = getBookingPageResponseNode.zod;

export const listFreeSlotsInputNode = objectNode(
  {
    date: localDateNode,
    displayTimeZone: ianaTimeZoneNode,
    meetingTypeId: uuidNode,
    username: publicUsernameNode,
  },
  { title: 'ListFreeSlotsInput' },
);
export const listFreeSlotsInputSchema = listFreeSlotsInputNode.zod;

export const listFreeSlotsDataNode = objectNode(
  {
    date: localDateNode,
    displayTimeZone: ianaTimeZoneNode,
    generatedAt: isoInstantNode,
    meetingTypeId: uuidNode,
    slots: arrayNode(publicSlotNode, { maxItems: 2_000 }),
    username: publicUsernameNode,
  },
  { title: 'ListFreeSlotsData' },
);
export const listFreeSlotsDataSchema = listFreeSlotsDataNode.zod;
export const listFreeSlotsResponseNode = successEnvelopeNode(listFreeSlotsDataNode);
export const listFreeSlotsResponseSchema = listFreeSlotsResponseNode.zod;

export const prepareBookingInputNode = objectNode(
  {
    booker: bookerNode,
    guestTimeZone: ianaTimeZoneNode,
    meetingTypeId: uuidNode,
    startAt: isoInstantNode,
    username: publicUsernameNode,
  },
  { title: 'PrepareBookingInput' },
);
export const prepareBookingInputSchema = prepareBookingInputNode.zod;

const preparedBookingSummaryBaseNode = objectNode(
  {
    booker: bookerNode,
    endAt: isoInstantNode,
    guestTimeZone: ianaTimeZoneNode,
    hostDisplayName: displayNameNode,
    hostTimeZone: ianaTimeZoneNode,
    meetingTypeId: uuidNode,
    meetingTypeTitle: titleNode,
    startAt: isoInstantNode,
    username: publicUsernameNode,
  },
  { title: 'PreparedBookingSummary' },
);
export const preparedBookingSummaryNode: ContractNode<
  z.ZodEffects<typeof preparedBookingSummaryBaseNode.zod>
> = contractNode(
  preparedBookingSummaryBaseNode.zod.refine(
    ({ startAt, endAt }) => new Date(endAt).getTime() > new Date(startAt).getTime(),
    { message: 'endAt must be later than startAt.', path: ['endAt'] },
  ),
  preparedBookingSummaryBaseNode.jsonSchema,
);
export const preparedBookingSummarySchema = preparedBookingSummaryNode.zod;

export const prepareBookingDataNode = objectNode(
  {
    confirmationUrl: httpsOrLocalUrlNode,
    expiresAt: isoInstantNode,
    notHeld: contractNode(z.literal(true), { type: 'boolean', const: true }),
    preparationId: uuidNode,
    preparationToken: preparationTokenNode,
    summary: preparedBookingSummaryNode,
  },
  { title: 'PrepareBookingData' },
);
export const prepareBookingDataSchema = prepareBookingDataNode.zod;
export const prepareBookingResponseNode = successEnvelopeNode(prepareBookingDataNode);
export const prepareBookingResponseSchema = prepareBookingResponseNode.zod;

export const createBookingInputNode = objectNode(
  {
    idempotencyKey: uuidNode,
    preparationToken: preparationTokenNode,
  },
  { title: 'CreateBookingInput' },
);
export const createBookingInputSchema = createBookingInputNode.zod;

const createBookingDataBaseNode = objectNode(
  {
    confirmationCode: contractNode(
      z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
      {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9_-]+$',
      },
    ),
    endAt: isoInstantNode,
    guestTimeZone: ianaTimeZoneNode,
    hostTimeZone: ianaTimeZoneNode,
    idempotencyKey: uuidNode,
    meetingTypeId: uuidNode,
    meetingTypeTitle: titleNode,
    startAt: isoInstantNode,
    status: contractNode(z.literal('confirmed'), {
      type: 'string',
      const: 'confirmed',
    }),
    username: publicUsernameNode,
  },
  { title: 'CreateBookingData' },
);
export const createBookingDataNode: ContractNode<
  z.ZodEffects<typeof createBookingDataBaseNode.zod>
> = contractNode(
  createBookingDataBaseNode.zod.refine(
    ({ startAt, endAt }) => new Date(endAt).getTime() > new Date(startAt).getTime(),
    { message: 'endAt must be later than startAt.', path: ['endAt'] },
  ),
  createBookingDataBaseNode.jsonSchema,
);
export const createBookingDataSchema = createBookingDataNode.zod;
export const createBookingResponseNode = successEnvelopeNode(createBookingDataNode);
export const createBookingResponseSchema = createBookingResponseNode.zod;

export type PublicMeetingType = z.infer<typeof publicMeetingTypeSchema>;
export type PublicSlot = z.infer<typeof publicSlotSchema>;
export type GetBookingPageInput = z.infer<typeof getBookingPageInputSchema>;
export type GetBookingPageData = z.infer<typeof getBookingPageDataSchema>;
export type GetBookingPageResponse = ProjectSSuccessEnvelope<GetBookingPageData>;
export type ListFreeSlotsInput = z.infer<typeof listFreeSlotsInputSchema>;
export type ListFreeSlotsData = z.infer<typeof listFreeSlotsDataSchema>;
export type ListFreeSlotsResponse = ProjectSSuccessEnvelope<ListFreeSlotsData>;
export type PrepareBookingInput = z.infer<typeof prepareBookingInputSchema>;
export type PreparedBookingSummary = z.infer<typeof preparedBookingSummarySchema>;
export type PrepareBookingData = z.infer<typeof prepareBookingDataSchema>;
export type PrepareBookingResponse = ProjectSSuccessEnvelope<PrepareBookingData>;
export type CreateBookingInput = z.infer<typeof createBookingInputSchema>;
export type CreateBookingData = z.infer<typeof createBookingDataSchema>;
export type CreateBookingResponse = ProjectSSuccessEnvelope<CreateBookingData>;
