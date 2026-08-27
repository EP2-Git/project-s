import { describe, expect, it, vi } from 'vitest';

import type {
  CreateBookingData,
  ExecutionContext,
  GetBookingPageData,
  ListFreeSlotsData,
  PrepareBookingData,
  ProjectSOperationId,
  ProjectSScope,
} from '@project-s/contracts';

import {
  PublicV1Authorizer,
  ProjectSApplication,
  ProjectSApplicationError,
  type AbuseCheck,
  type AbuseGuard,
  type ApplicationAuditEvent,
  type AuditSink,
  type SchedulingAuthority,
} from '../src/index.js';

const meetingTypeId = '11111111-1111-4111-8111-111111111111';
const preparationId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const preparationToken = 'a'.repeat(64);

const pageData: GetBookingPageData = {
  username: 'demo-host',
  displayName: 'Demo Host',
  avatarUrl: null,
  hostTimeZone: 'America/Halifax',
  meetingTypes: [
    {
      meetingTypeId,
      title: 'Introduction',
      description: null,
      durationMinutes: 30,
      minNoticeMinutes: 60,
      maxAdvanceDays: 60,
    },
  ],
};

const slotsData: ListFreeSlotsData = {
  username: 'demo-host',
  meetingTypeId,
  date: '2026-08-25',
  displayTimeZone: 'America/Halifax',
  generatedAt: '2026-08-19T12:00:00.000Z',
  slots: [
    {
      startAt: '2026-08-25T13:00:00.000Z',
      endAt: '2026-08-25T13:30:00.000Z',
    },
  ],
};

const prepareInput = {
  username: 'demo-host',
  meetingTypeId,
  startAt: '2026-08-25T13:00:00.000Z',
  guestTimeZone: 'Asia/Tokyo',
  booker: {
    name: 'Private Guest',
    email: 'private@example.invalid',
    notes: 'Private agenda',
  },
} as const;

const prepareData: PrepareBookingData = {
  preparationId,
  preparationToken,
  expiresAt: '2026-08-19T12:10:00.000Z',
  notHeld: true,
  confirmationUrl: `https://project-s.example/confirm#${preparationToken}`,
  summary: {
    username: 'demo-host',
    hostDisplayName: 'Demo Host',
    meetingTypeId,
    meetingTypeTitle: 'Introduction',
    startAt: '2026-08-25T13:00:00.000Z',
    endAt: '2026-08-25T13:30:00.000Z',
    hostTimeZone: 'America/Halifax',
    guestTimeZone: 'Asia/Tokyo',
    booker: prepareInput.booker,
  },
};

const createInput = { preparationToken, idempotencyKey } as const;
const createData: CreateBookingData = {
  confirmationCode: 'PROJECT-S-TEST',
  status: 'confirmed',
  username: 'demo-host',
  meetingTypeId,
  meetingTypeTitle: 'Introduction',
  startAt: '2026-08-25T13:00:00.000Z',
  endAt: '2026-08-25T13:30:00.000Z',
  hostTimeZone: 'America/Halifax',
  guestTimeZone: 'Asia/Tokyo',
  idempotencyKey,
};

const contextFor = (
  scope: ProjectSScope,
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext => ({
  requestId: `req_${scope.replace(/[^a-z]/g, '_')}`,
  actorKind: 'anonymous',
  transport: 'http',
  scopes: [scope],
  provenance: { source: 'project_s_sdk' },
  ...overrides,
});

const makeAuthority = (
  overrides: Partial<SchedulingAuthority> = {},
): SchedulingAuthority => ({
  async getBookingPage(_input, _context) {
    return pageData;
  },
  async listFreeSlots(_input, _context) {
    return slotsData;
  },
  async prepareBooking(_input, _context) {
    return prepareData;
  },
  async createBooking(_input, _context) {
    return createData;
  },
  ...overrides,
});

const getPageInput = { username: 'demo-host' } as const;
const slotsInput = {
  username: 'demo-host',
  meetingTypeId,
  date: '2026-08-25',
  displayTimeZone: 'America/Halifax',
} as const;

const caughtFrom = (callback: () => void): ProjectSApplicationError => {
  try {
    callback();
  } catch (error) {
    if (error instanceof ProjectSApplicationError) return error;
    throw error;
  }
  throw new Error('Expected ProjectSApplicationError.');
};

describe('PublicV1Authorizer', () => {
  const authorizer = new PublicV1Authorizer();

  it('requires the exact operation scope and distinguishes anonymous from verified callers', () => {
    expect(() =>
      authorizer.assertAuthorized(
        'project-s.public.get_booking_page.v1',
        contextFor('booking_page:read'),
      ),
    ).not.toThrow();

    const anonymous = caughtFrom(() =>
      authorizer.assertAuthorized(
        'project-s.public.get_booking_page.v1',
        contextFor('slots:read'),
      ),
    );
    expect(anonymous).toMatchObject({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
    });

    const verified = caughtFrom(() =>
      authorizer.assertAuthorized(
        'project-s.public.get_booking_page.v1',
        contextFor('slots:read', { actorKind: 'human' }),
      ),
    );
    expect(verified).toMatchObject({ status: 403, code: 'INSUFFICIENT_SCOPE' });
  });

  it('forbids delegated identity on anonymous contexts', () => {
    const error = caughtFrom(() =>
      authorizer.assertAuthorized(
        'project-s.public.prepare_booking.v1',
        contextFor('bookings:prepare', {
          principalId: '44444444-4444-4444-8444-444444444444',
        }),
      ),
    );
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('requires a complete verified delegated-agent binding', () => {
    const incomplete = contextFor('bookings:prepare', {
      actorKind: 'delegated_agent',
      principalId: '44444444-4444-4444-8444-444444444444',
      subjectId: '55555555-5555-4555-8555-555555555555',
      delegationId: '66666666-6666-4666-8666-666666666666',
    });
    const error = caughtFrom(() =>
      authorizer.assertAuthorized(
        'project-s.public.prepare_booking.v1',
        incomplete,
      ),
    );
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN' });

    expect(() =>
      authorizer.assertAuthorized(
        'project-s.public.prepare_booking.v1',
        {
          ...incomplete,
          onBehalfOf: '55555555-5555-4555-8555-555555555555',
        },
      ),
    ).not.toThrow();
  });
});

describe('ProjectSApplication boundary', () => {
  it('rejects public authority fields before abuse or authority execution', async () => {
    const guard = vi.fn(async (_check: AbuseCheck) => undefined);
    const authority = makeAuthority({
      prepareBooking: vi.fn(async () => prepareData),
      createBooking: vi.fn(async () => createData),
    });
    const application = new ProjectSApplication({
      authority,
      abuseGuard: { assertAllowed: guard },
    });

    await expect(
      application.prepareBooking(
        {
          ...prepareInput,
          ownerId: '77777777-7777-4777-8777-777777777777',
          endAt: prepareData.summary.endAt,
          bufferMinutes: 15,
        },
        contextFor('bookings:prepare'),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(
      application.createBooking(
        { ...createInput, confirmed: true, onBehalfOf: preparationId },
        contextFor('bookings:create'),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    expect(guard).not.toHaveBeenCalled();
    expect(authority.prepareBooking).not.toHaveBeenCalled();
    expect(authority.createBooking).not.toHaveBeenCalled();
  });

  it('runs the abuse guard before authority for all four operations', async () => {
    const order: string[] = [];
    const checks: AbuseCheck[] = [];
    const guard: AbuseGuard = {
      async assertAllowed(check) {
        checks.push(check);
        order.push(`guard:${check.operationId}`);
      },
    };
    const afterGuard = <T>(operationId: ProjectSOperationId, result: T) => async () => {
      order.push(`authority:${operationId}`);
      return result;
    };
    const authority = makeAuthority({
      getBookingPage: afterGuard('project-s.public.get_booking_page.v1', pageData),
      listFreeSlots: afterGuard('project-s.public.list_free_slots.v1', slotsData),
      prepareBooking: afterGuard('project-s.public.prepare_booking.v1', prepareData),
      createBooking: afterGuard('project-s.public.create_booking.v1', createData),
    });
    const application = new ProjectSApplication({ authority, abuseGuard: guard });

    await application.getBookingPage(
      getPageInput,
      contextFor('booking_page:read'),
    );
    await application.listFreeSlots(slotsInput, contextFor('slots:read'));
    await application.prepareBooking(
      prepareInput,
      contextFor('bookings:prepare'),
    );
    await application.createBooking(createInput, contextFor('bookings:create'));

    expect(order).toEqual([
      'guard:project-s.public.get_booking_page.v1',
      'authority:project-s.public.get_booking_page.v1',
      'guard:project-s.public.list_free_slots.v1',
      'authority:project-s.public.list_free_slots.v1',
      'guard:project-s.public.prepare_booking.v1',
      'authority:project-s.public.prepare_booking.v1',
      'guard:project-s.public.create_booking.v1',
      'authority:project-s.public.create_booking.v1',
    ]);
    expect(checks.map(({ operationId }) => operationId)).toEqual([
      'project-s.public.get_booking_page.v1',
      'project-s.public.list_free_slots.v1',
      'project-s.public.prepare_booking.v1',
      'project-s.public.create_booking.v1',
    ]);
    expect(checks.map(({ resource }) => resource)).toEqual([
      { username: 'demo-host' },
      { username: 'demo-host', meetingTypeId, date: '2026-08-25' },
      { username: 'demo-host', meetingTypeId },
      {},
    ]);
  });

  it('audits success and rejection without booker, token, or preparation data', async () => {
    const events: ApplicationAuditEvent[] = [];
    const audit: AuditSink = {
      async append(event) {
        events.push(event);
      },
    };
    const application = new ProjectSApplication({
      authority: makeAuthority(),
      audit,
      clock: { now: () => new Date('2026-08-19T12:00:00.000Z') },
    });

    await application.prepareBooking(
      prepareInput,
      contextFor('bookings:prepare'),
    );
    await expect(
      application.getBookingPage(
        getPageInput,
        contextFor('slots:read', { actorKind: 'human' }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE', status: 403 });
    await expect(
      application.prepareBooking(
        {
          ...prepareInput,
          ownerId: '77777777-7777-4777-8777-777777777777',
        },
        contextFor('bookings:prepare', {
          requestId: 'req_invalid_prepare',
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    expect(events).toEqual([
      {
        requestId: 'req_bookings_prepare',
        operationId: 'project-s.public.prepare_booking.v1',
        actorKind: 'anonymous',
        transport: 'http',
        principalId: undefined,
        subjectId: undefined,
        delegationId: undefined,
        outcome: 'success',
        code: undefined,
        occurredAt: '2026-08-19T12:00:00.000Z',
      },
      {
        requestId: 'req_slots_read',
        operationId: 'project-s.public.get_booking_page.v1',
        actorKind: 'human',
        transport: 'http',
        principalId: undefined,
        subjectId: undefined,
        delegationId: undefined,
        outcome: 'rejected',
        code: 'INSUFFICIENT_SCOPE',
        occurredAt: '2026-08-19T12:00:00.000Z',
      },
      {
        requestId: 'req_invalid_prepare',
        operationId: 'project-s.public.prepare_booking.v1',
        actorKind: 'anonymous',
        transport: 'http',
        principalId: undefined,
        subjectId: undefined,
        delegationId: undefined,
        outcome: 'rejected',
        code: 'VALIDATION_ERROR',
        occurredAt: '2026-08-19T12:00:00.000Z',
      },
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Private Guest');
    expect(serialized).not.toContain('private@example.invalid');
    expect(serialized).not.toContain('Private agenda');
    expect(serialized).not.toContain(preparationToken);
    expect(serialized).not.toContain(preparationId);
    expect(serialized).not.toContain('ownerId');
    expect(serialized).not.toContain('77777777');
  });

  it('maps invalid authority output to INTERNAL_ERROR and safe failure audit', async () => {
    const events: ApplicationAuditEvent[] = [];
    const application = new ProjectSApplication({
      authority: makeAuthority({
        getBookingPage: async () => ({
          ...pageData,
          ownerId: '77777777-7777-4777-8777-777777777777',
        } as never),
      }),
      audit: {
        async append(event) {
          events.push(event);
        },
      },
      clock: { now: () => new Date('2026-08-19T12:00:00.000Z') },
    });

    const caught = await application
      .getBookingPage(getPageInput, contextFor('booking_page:read'))
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ProjectSApplicationError);
    expect(caught).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    expect(events).toEqual([
      expect.objectContaining({
        operationId: 'project-s.public.get_booking_page.v1',
        outcome: 'failure',
        code: 'INTERNAL_ERROR',
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('ownerId');
    expect(JSON.stringify(events)).not.toContain('77777777');
  });
});
