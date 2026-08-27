const IDS = Object.freeze({
  meetingType: '11111111-1111-4111-8111-111111111111',
  preparation: '22222222-2222-4222-8222-222222222222',
  idempotency: '33333333-3333-4333-8333-333333333333',
});

const PREPARATION_TOKEN =
  'prep_0123456789abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const pageData = Object.freeze({
  avatarUrl: 'https://cdn.example.invalid/project-s/host-one.png',
  displayName: '  Host One  ',
  hostTimeZone: 'America/Halifax',
  meetingTypes: [
    {
      description: '  A focused introduction.  ',
      durationMinutes: 30,
      maxAdvanceDays: 60,
      meetingTypeId: IDS.meetingType,
      minNoticeMinutes: 120,
      title: '  Intro call  ',
    },
  ],
  username: 'host_one',
});

const slotsData = Object.freeze({
  date: '2026-09-15',
  displayTimeZone: 'Etc/UTC',
  generatedAt: '2026-09-01T12:00:00Z',
  meetingTypeId: IDS.meetingType,
  slots: [
    {
      startAt: '2026-09-15T13:00:00Z',
      endAt: '2026-09-15T13:30:00Z',
    },
  ],
  username: 'host_one',
});

const preparedSummary = Object.freeze({
  booker: {
    email: '  PRIVATE.BOOKER@EXAMPLE.INVALID  ',
    name: '  Private Booker  ',
    notes: '  Please use the side door.  ',
  },
  endAt: '2026-09-15T13:30:00Z',
  guestTimeZone: 'Etc/UTC',
  hostDisplayName: '  Host One  ',
  hostTimeZone: 'America/Halifax',
  meetingTypeId: IDS.meetingType,
  meetingTypeTitle: '  Intro call  ',
  startAt: '2026-09-15T13:00:00Z',
  username: 'host_one',
});

const prepareData = Object.freeze({
  confirmationUrl:
    'http://127.0.0.1:4173/bookings/confirm?token=parity-sensitive-token',
  expiresAt: '2026-09-01T12:10:00Z',
  notHeld: true,
  preparationId: IDS.preparation,
  preparationToken: PREPARATION_TOKEN,
  summary: preparedSummary,
});

const createData = Object.freeze({
  confirmationCode: 'project-s-confirm-parity-sensitive',
  endAt: '2026-09-15T13:30:00Z',
  guestTimeZone: 'Etc/UTC',
  hostTimeZone: 'America/Halifax',
  idempotencyKey: IDS.idempotency,
  meetingTypeId: IDS.meetingType,
  meetingTypeTitle: '  Intro call  ',
  startAt: '2026-09-15T13:00:00Z',
  status: 'confirmed',
  username: 'host_one',
});

const problem = ({ code, status, slug, title, detail, retry, alternatives }) =>
  Object.freeze({
    type: `https://project-s.example/problems/${slug}`,
    title,
    status,
    code,
    detail,
    requestId: `parity-${slug}-problem`,
    ...(retry === undefined ? {} : { retry }),
    ...(alternatives === undefined ? {} : { alternatives }),
  });

export const goldenParityVectors = Object.freeze([
  Object.freeze({
    operationId: 'project-s.public.get_booking_page.v1',
    applicationMethod: 'getBookingPage',
    sdkMethod: 'getBookingPage',
    mcpToolName: 'project_s_get_booking_page_v1',
    scope: 'booking_page:read',
    http: Object.freeze({
      method: 'GET',
      path: '/api/v1/public/booking-pages/host_one',
    }),
    input: Object.freeze({ username: 'host_one' }),
    normalizedInput: Object.freeze({ username: 'host_one' }),
    authorityData: pageData,
    forbiddenText: Object.freeze([
      'Host One',
      'Intro call',
      'host-one.png',
    ]),
    problem: problem({
      code: 'NOT_FOUND',
      status: 404,
      slug: 'not-found',
      title: 'Booking page not found',
      detail: 'No public booking page matched the requested username.',
      retry: { action: 'contact_support' },
    }),
  }),
  Object.freeze({
    operationId: 'project-s.public.list_free_slots.v1',
    applicationMethod: 'listFreeSlots',
    sdkMethod: 'listFreeSlots',
    mcpToolName: 'project_s_list_free_slots_v1',
    scope: 'slots:read',
    http: Object.freeze({
      method: 'POST',
      path: '/api/v1/public/free-slots/search',
    }),
    input: Object.freeze({
      date: '2026-09-15',
      displayTimeZone: 'Etc/UTC',
      meetingTypeId: IDS.meetingType,
      username: 'host_one',
    }),
    normalizedInput: Object.freeze({
      date: '2026-09-15',
      displayTimeZone: 'Etc/UTC',
      meetingTypeId: IDS.meetingType,
      username: 'host_one',
    }),
    authorityData: slotsData,
    forbiddenText: Object.freeze([
      IDS.meetingType,
      '2026-09-15T13:00:00Z',
    ]),
    problem: problem({
      code: 'SLOT_UNAVAILABLE',
      status: 409,
      slug: 'slot-unavailable',
      title: 'Slot unavailable',
      detail: 'Choose another available time.',
      retry: { action: 'choose_alternative' },
      alternatives: [
        {
          startAt: '2026-09-15T14:00:00Z',
          endAt: '2026-09-15T14:30:00Z',
        },
      ],
    }),
  }),
  Object.freeze({
    operationId: 'project-s.public.prepare_booking.v1',
    applicationMethod: 'prepareBooking',
    sdkMethod: 'prepareBooking',
    mcpToolName: 'project_s_prepare_booking_v1',
    scope: 'bookings:prepare',
    http: Object.freeze({
      method: 'POST',
      path: '/api/v1/public/bookings/prepare',
    }),
    input: Object.freeze({
      booker: Object.freeze({
        email: '  PRIVATE.BOOKER@EXAMPLE.INVALID  ',
        name: '  Private Booker  ',
        notes: '  Please use the side door.  ',
      }),
      guestTimeZone: 'Etc/UTC',
      meetingTypeId: IDS.meetingType,
      startAt: '2026-09-15T13:00:00Z',
      username: 'host_one',
    }),
    normalizedInput: Object.freeze({
      booker: Object.freeze({
        email: 'private.booker@example.invalid',
        name: 'Private Booker',
        notes: 'Please use the side door.',
      }),
      guestTimeZone: 'Etc/UTC',
      meetingTypeId: IDS.meetingType,
      startAt: '2026-09-15T13:00:00Z',
      username: 'host_one',
    }),
    authorityData: prepareData,
    forbiddenText: Object.freeze([
      'Private Booker',
      'private.booker@example.invalid',
      'Please use the side door.',
      PREPARATION_TOKEN,
      'parity-sensitive-token',
    ]),
    problem: problem({
      code: 'RATE_LIMITED',
      status: 429,
      slug: 'rate-limited',
      title: 'Too many booking preparations',
      detail: 'Wait before preparing another booking.',
      retry: { action: 'retry_after', afterSeconds: 30 },
    }),
  }),
  Object.freeze({
    operationId: 'project-s.public.create_booking.v1',
    applicationMethod: 'createBooking',
    sdkMethod: 'createBooking',
    mcpToolName: 'project_s_create_booking_v1',
    scope: 'bookings:create',
    http: Object.freeze({
      method: 'POST',
      path: '/api/v1/public/bookings',
    }),
    input: Object.freeze({
      idempotencyKey: IDS.idempotency,
      preparationToken: PREPARATION_TOKEN,
    }),
    normalizedInput: Object.freeze({
      idempotencyKey: IDS.idempotency,
      preparationToken: PREPARATION_TOKEN,
    }),
    authorityData: createData,
    forbiddenText: Object.freeze([
      PREPARATION_TOKEN,
      IDS.idempotency,
      'project-s-confirm-parity-sensitive',
    ]),
    problem: problem({
      code: 'CONFIRMATION_REQUIRED',
      status: 428,
      slug: 'confirmation-required',
      title: 'Human confirmation required',
      detail: 'Confirm this preparation in the browser before creating it.',
      retry: { action: 'confirm_in_browser' },
    }),
  }),
]);
