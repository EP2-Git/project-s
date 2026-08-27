import { createHash } from 'node:crypto';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PROJECT_S_CONTRACT_VERSION,
  createBookingDataSchema,
  createBookingInputSchema,
  executionContextSchema,
  generateContractArtifacts,
  getBookingPageDataSchema,
  getBookingPageInputSchema,
  isoInstantSchema,
  listFreeSlotsDataSchema,
  listFreeSlotsInputSchema,
  operationRegistry,
  operationRegistryById,
  operationRegistryByMcpToolName,
  prepareBookingDataSchema,
  prepareBookingInputSchema,
  projectSOperationIds,
  projectSProblemEnvelopeSchema,
  projectSProblemSchema,
  stableStringify,
  type CreateBookingData,
  type CreateBookingInput,
  type ExecutionContext,
  type GetBookingPageData,
  type GetBookingPageInput,
  type ListFreeSlotsData,
  type ListFreeSlotsInput,
  type PrepareBookingData,
  type PrepareBookingInput,
  type ProjectSProblem,
  type ProjectSSuccessEnvelope,
} from '../src/index.js';

const meetingTypeId = '11111111-1111-4111-8111-111111111111';
const preparationId = '22222222-2222-4222-8222-222222222222';
const idempotencyKey = '33333333-3333-4333-8333-333333333333';
const preparationToken = 'token_abcdefghijklmnopqrstuvwxyz0123456789';

const getPageInput = { username: 'demo-host' } as const;
const getPageData = {
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
} as const;
const slotsInput = {
  username: 'demo-host',
  meetingTypeId,
  date: '2026-08-25',
  displayTimeZone: 'America/Halifax',
} as const;
const slotsData = {
  ...slotsInput,
  generatedAt: '2026-08-19T12:00:00.000Z',
  slots: [
    {
      startAt: '2026-08-25T13:00:00.000Z',
      endAt: '2026-08-25T13:30:00.000Z',
    },
  ],
} as const;
const prepareInput = {
  username: 'demo-host',
  meetingTypeId,
  startAt: '2026-08-25T13:00:00.000Z',
  guestTimeZone: 'Asia/Tokyo',
  booker: {
    name: 'Example Guest',
    email: 'guest@example.com',
    notes: 'An introduction.',
  },
} as const;
const prepareData = {
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
} as const;
const createInput = { preparationToken, idempotencyKey } as const;
const createData = {
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
} as const;

describe('four-operation v1 contracts', () => {
  it('exports precise inferred request, data, and envelope types', () => {
    expectTypeOf(getBookingPageInputSchema.parse(getPageInput)).toEqualTypeOf<GetBookingPageInput>();
    expectTypeOf(getBookingPageDataSchema.parse(getPageData)).toEqualTypeOf<GetBookingPageData>();
    expectTypeOf(listFreeSlotsInputSchema.parse(slotsInput)).toEqualTypeOf<ListFreeSlotsInput>();
    expectTypeOf(listFreeSlotsDataSchema.parse(slotsData)).toEqualTypeOf<ListFreeSlotsData>();
    expectTypeOf(prepareBookingInputSchema.parse(prepareInput)).toEqualTypeOf<PrepareBookingInput>();
    expectTypeOf(prepareBookingDataSchema.parse(prepareData)).toEqualTypeOf<PrepareBookingData>();
    expectTypeOf(createBookingInputSchema.parse(createInput)).toEqualTypeOf<CreateBookingInput>();
    expectTypeOf(createBookingDataSchema.parse(createData)).toEqualTypeOf<CreateBookingData>();
    expectTypeOf<ProjectSSuccessEnvelope<CreateBookingData>>().toMatchTypeOf<{
      contractVersion: 1;
      requestId: string;
      data: CreateBookingData;
    }>();
  });

  it('accepts the canonical DTOs', () => {
    expect(getBookingPageInputSchema.parse(getPageInput)).toEqual(getPageInput);
    expect(getBookingPageDataSchema.parse(getPageData)).toEqual(getPageData);
    expect(listFreeSlotsInputSchema.parse(slotsInput)).toEqual(slotsInput);
    expect(listFreeSlotsDataSchema.parse(slotsData)).toEqual(slotsData);
    expect(prepareBookingInputSchema.parse(prepareInput)).toEqual(prepareInput);
    expect(prepareBookingDataSchema.parse(prepareData)).toEqual(prepareData);
    expect(createBookingInputSchema.parse(createInput)).toEqual(createInput);
    expect(createBookingDataSchema.parse(createData)).toEqual(createData);
  });

  it('keeps instant precision aligned with PostgreSQL authority validation', () => {
    expect(
      isoInstantSchema.safeParse('2026-08-25T13:00:00.123456Z').success,
    ).toBe(true);
    expect(
      isoInstantSchema.safeParse('2026-08-25T13:00:00.1234567Z').success,
    ).toBe(false);
  });

  it('keeps booker normalization aligned with PostgreSQL authority validation', () => {
    for (const email of [
      'user+@example.com',
      'user_@example.com',
      'user-@example.com',
      'foo..bar@example.com',
    ]) {
      expect(
        prepareBookingInputSchema.safeParse({
          ...prepareInput,
          booker: { ...prepareInput.booker, email },
        }).success,
      ).toBe(false);
    }
    expect(
      prepareBookingInputSchema.safeParse({
        ...prepareInput,
        booker: { ...prepareInput.booker, name: 'ab\ncd' },
      }).success,
    ).toBe(false);
  });

  it('rejects client attempts to supply authority or derived fields', () => {
    expect(
      prepareBookingInputSchema.safeParse({
        ...prepareInput,
        ownerId: '44444444-4444-4444-8444-444444444444',
      }).success,
    ).toBe(false);
    expect(
      prepareBookingInputSchema.safeParse({
        ...prepareInput,
        endAt: '2026-08-25T13:30:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      prepareBookingInputSchema.safeParse({
        ...prepareInput,
        durationMinutes: 30,
        bufferMinutes: 15,
      }).success,
    ).toBe(false);
    expect(
      createBookingInputSchema.safeParse({
        ...createInput,
        confirmed: true,
        onBehalfOf: '44444444-4444-4444-8444-444444444444',
      }).success,
    ).toBe(false);
  });

  it('rejects private scheduling state in public responses', () => {
    expect(
      getBookingPageDataSchema.safeParse({
        ...getPageData,
        ownerId: '44444444-4444-4444-8444-444444444444',
      }).success,
    ).toBe(false);
    expect(
      listFreeSlotsDataSchema.safeParse({
        ...slotsData,
        busyIntervals: [],
        rawAvailabilityRules: [],
      }).success,
    ).toBe(false);
    expect(
      listFreeSlotsDataSchema.safeParse({
        ...slotsData,
        slots: [{ ...slotsData.slots[0], bookingId: preparationId }],
      }).success,
    ).toBe(false);
  });

  it('rejects reversed intervals and malformed dates and zones', () => {
    expect(
      listFreeSlotsDataSchema.safeParse({
        ...slotsData,
        slots: [
          {
            startAt: '2026-08-25T14:00:00.000Z',
            endAt: '2026-08-25T13:30:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
    expect(listFreeSlotsInputSchema.safeParse({ ...slotsInput, date: '2026-02-30' }).success).toBe(false);
    expect(
      listFreeSlotsInputSchema.safeParse({
        ...slotsInput,
        displayTimeZone: 'Browser/Local',
      }).success,
    ).toBe(false);
  });
});

describe('canonical problems and execution context', () => {
  const problem = {
    type: 'https://project-s.example/problems/slot-unavailable',
    title: 'Slot unavailable',
    status: 409,
    code: 'SLOT_UNAVAILABLE',
    detail: 'That time is no longer available.',
    requestId: 'req_12345678',
    retry: { action: 'choose_alternative' },
    alternatives: slotsData.slots,
  } as const;

  it('validates a bounded, transport-neutral problem', () => {
    expect(projectSProblemSchema.parse(problem)).toEqual(problem);
    const envelope = {
      contractVersion: PROJECT_S_CONTRACT_VERSION,
      requestId: problem.requestId,
      error: problem,
    };
    expect(projectSProblemEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expectTypeOf(projectSProblemSchema.parse(problem)).toMatchTypeOf<ProjectSProblem>();
  });

  it('caps alternatives and rejects provider/private details', () => {
    expect(
      projectSProblemSchema.safeParse({
        ...problem,
        alternatives: [
          ...slotsData.slots,
          ...slotsData.slots,
          ...slotsData.slots,
          ...slotsData.slots,
        ],
      }).success,
    ).toBe(false);
    expect(
      projectSProblemSchema.safeParse({
        ...problem,
        databaseError: 'exclusion constraint bookings_no_overlap',
      }).success,
    ).toBe(false);
  });

  it('accepts only server-derived execution context fields and unique scopes', () => {
    const context: ExecutionContext = {
      requestId: 'req_12345678',
      actorKind: 'delegated_agent',
      transport: 'stdio_mcp',
      clientId: 'project-s-mcp/0.1.0-prealpha',
      principalId: '44444444-4444-4444-8444-444444444444',
      subjectId: '55555555-5555-4555-8555-555555555555',
      onBehalfOf: '55555555-5555-4555-8555-555555555555',
      delegationId: '66666666-6666-4666-8666-666666666666',
      scopes: ['booking_page:read', 'bookings:prepare'],
      provenance: {
        source: 'project_s_mcp',
        clientVersion: '0.1.0-prealpha',
        userAgentHash: 'a'.repeat(64),
      },
      confirmationGrant: {
        grantId: '77777777-7777-4777-8777-777777777777',
        confirmedAt: '2026-08-19T12:00:00.000Z',
        method: 'verified_challenge',
        challengeId: 'challenge_12345678',
      },
    };
    expect(executionContextSchema.parse(context)).toEqual(context);
    expect(
      executionContextSchema.safeParse({
        ...context,
        scopes: ['bookings:prepare', 'bookings:prepare'],
      }).success,
    ).toBe(false);
    expect(
      executionContextSchema.safeParse({ ...context, ownerId: preparationId }).success,
    ).toBe(false);
  });
});

describe('operation registry and generated artifacts', () => {
  it('contains exactly the four approved pre-alpha operations', () => {
    expect(operationRegistry.map(({ id }) => id)).toEqual(projectSOperationIds);
    expect(Object.keys(operationRegistryById).sort()).toEqual([...projectSOperationIds].sort());
    expect(Object.keys(operationRegistryByMcpToolName).sort()).toEqual([
      'project_s_create_booking_v1',
      'project_s_get_booking_page_v1',
      'project_s_list_free_slots_v1',
      'project_s_prepare_booking_v1',
    ]);
    expect(
      operationRegistry.every(
        ({ version, stability }) => version === 1 && stability === 'prealpha',
      ),
    ).toBe(true);
  });

  it('emits strict JSON Schema 2020-12, OpenAPI 3.1, and MCP artifacts', () => {
    const artifacts = generateContractArtifacts();
    expect(artifacts.jsonSchemaBundle.$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
    expect(artifacts.openApi.openapi).toBe('3.1.1');
    expect(artifacts.openApi.info.version).toBe('0.1.0-prealpha');
    expect(artifacts.openApi.info.description).toMatch(/pre-alpha/i);
    expect(artifacts.openApi.info.description).not.toMatch(/\bstable\b/i);
    expect(Object.keys(artifacts.openApi.paths)).toEqual([
      '/api/v1/public/booking-pages/{username}',
      '/api/v1/public/free-slots/search',
      '/api/v1/public/bookings/prepare',
      '/api/v1/public/bookings',
    ]);
    expect(artifacts.mcpManifest.protocolRevision).toBe('2026-07-28');
    expect(artifacts.mcpManifest.server.version).toBe('0.1.0-prealpha');
    const createOperation = artifacts.openApi.paths[
      '/api/v1/public/bookings'
    ].post as {
      responses: Record<
        string,
        { content?: Record<string, { schema: unknown }> }
      >;
    };
    expect(createOperation.responses).toHaveProperty('201');
    expect(
      createOperation.responses.default.content?.['application/problem+json']
        .schema,
    ).toEqual(expect.objectContaining({ title: 'ProjectSProblem' }));
    expect(artifacts.mcpManifest.tools).toHaveLength(4);
    expect(
      artifacts.mcpManifest.tools.every(
        (tool) =>
          tool.inputSchema.additionalProperties === false &&
          Array.isArray(tool.outputSchema.oneOf) &&
          tool.outputSchema.oneOf.length === 2,
      ),
    ).toBe(true);
  });

  it('fails on unreviewed generated-contract drift', () => {
    const serialized = stableStringify(generateContractArtifacts(), 0);
    const digest = createHash('sha256').update(serialized).digest('hex');
    expect(digest).toBe('827656a8a8748d1d58afa9042daae09fa3be586d274d86308e09ae8ace3f57be');
  });
});
