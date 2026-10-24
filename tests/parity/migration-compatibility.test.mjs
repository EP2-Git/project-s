import assert from 'node:assert/strict';
import {
  bookerSchema,
  createBookingDataSchema,
  descriptionNode,
  displayNameNode,
  executionContextSchema,
  getBookingPageInputSchema,
  getBookingPageDataSchema,
  isoInstantSchema,
  localDateSchema,
  prepareBookingInputSchema,
  prepareBookingDataSchema,
  preparedBookingSummarySchema,
  projectSScopes,
  titleNode,
  uuidSchema,
} from '@project-s/contracts';
import {
  v2CreateBookingInputSchema,
  v2ActorContextSchema,
  v2InstantSchema,
  v2PrincipalContextSchema,
  v2PrepareBookingInputSchema,
  v2ProblemEnvelopeSchema,
  v2ProblemStepUpSchema,
  v2StepUpReviewUrlSchema,
  v2UuidSchema,
} from '../../packages/contracts/dist/v2/index.js';
import {
  ProjectSApplication,
  ProjectSApplicationError,
} from '@project-s/application';
import { goldenParityVectors } from './golden-vectors.mjs';

// Freeze actual Project S behavior during the reviewed v4 migration. Native
// invalid_string/invalid_enum_value diagnostics became invalid_format/
// invalid_value as an explicitly reviewed parser API change. Paths and the
// separately asserted public field-error messages remain frozen.
const test = globalThis.Deno?.test
  ? globalThis.Deno.test.bind(globalThis.Deno)
  : (await import('node:test')).default;
const legacyUuid = '11111111-1111-1111-1111-111111111111';
const uppercaseUuid = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
const instant = '2026-10-24T12:34:56.123456+03:30';
const booker = { name: 'Guest Example', email: 'guest@example.invalid' };
const prepareInput = {
  username: 'host_one',
  meetingTypeId: legacyUuid,
  startAt: instant,
  guestTimeZone: 'UTC',
  booker,
};
const context = {
  requestId: 'migration-baseline-request',
  actorKind: 'anonymous',
  transport: 'http',
  scopes: ['bookings:prepare'],
  provenance: { source: 'internal' },
};
const issuesOf = (result) => {
  assert.equal(result.success, false);
  return result.error.issues.map(({ code, path }) => ({ code, path }));
};

test('migration baseline: legacy UUID grammar and v1/v2 case normalization', () => {
  assert.equal(uuidSchema.parse(legacyUuid), legacyUuid);
  assert.equal(v2UuidSchema.parse(legacyUuid), legacyUuid);
  assert.equal(uuidSchema.parse(uppercaseUuid), uppercaseUuid);
  assert.equal(v2UuidSchema.parse(uppercaseUuid), uppercaseUuid.toLowerCase());
  for (const malformed of [
    '11111111-1111-1111-1111-11111111111g',
    '11111111111111111111111111111111',
    legacyUuid + '\n',
    111,
  ]) {
    assert.equal(uuidSchema.safeParse(malformed).success, false);
    assert.equal(v2UuidSchema.safeParse(malformed).success, false);
  }
  assert.equal(prepareBookingInputSchema.parse(prepareInput).meetingTypeId, legacyUuid);
  assert.deepEqual(v2CreateBookingInputSchema.parse({
    preparationId: uppercaseUuid,
    idempotencyKey: legacyUuid,
  }), { preparationId: uppercaseUuid.toLowerCase(), idempotencyKey: legacyUuid });
});

for (const [label, schema, maximum] of [
  ['display name', displayNameNode.zod, 120],
  ['meeting title', titleNode.zod, 160],
  ['description', descriptionNode.zod, 2_000],
]) {
  test('migration baseline: ' + label + ' trims before enforcing UTF-16 length ' + maximum, () => {
    const atMaximum = '🧭'.repeat(maximum / 2);
    assert.equal(atMaximum.length, maximum);
    assert.equal(schema.parse(' \t' + atMaximum + '\n '), atMaximum);
    assert.deepEqual(issuesOf(schema.safeParse(atMaximum + '🧭')), [
      { code: 'too_big', path: [] },
    ]);
    const loneSurrogates = '\ud800'.repeat(maximum);
    assert.equal(schema.parse(loneSurrogates), loneSurrogates);
    assert.deepEqual(issuesOf(schema.safeParse(loneSurrogates + '\ud800')), [
      { code: 'too_big', path: [] },
    ]);
    for (const atCodeUnitBoundary of [
      'a'.repeat(maximum - 2) + '🧭',
      '\udc00'.repeat(maximum),
      'e\u0301'.repeat(maximum / 2),
    ]) {
      assert.equal(atCodeUnitBoundary.length, maximum);
      assert.equal(schema.parse(atCodeUnitBoundary), atCodeUnitBoundary);
      assert.deepEqual(issuesOf(schema.safeParse(atCodeUnitBoundary + 'a')), [
        { code: 'too_big', path: [] },
      ]);
    }
    if (label === 'description') {
      assert.equal(schema.parse(null), null);
      assert.equal(schema.parse(' \t\n '), '');
    } else {
      assert.deepEqual(issuesOf(schema.safeParse(' \t\n ')), [
        { code: 'too_small', path: [] },
      ]);
    }
  });
}

test('migration baseline: booker ASCII-space normalization preserves internal notes', () => {
  const input = {
    ...prepareInput,
    booker: {
      name: '  Guest Example  ',
      email: '  GUEST+TAG@EXAMPLE.INVALID  ',
      notes: '  First line\nSecond line  ',
    },
  };
  const normalized = {
    name: 'Guest Example',
    email: 'guest+tag@example.invalid',
    notes: 'First line\nSecond line',
  };
  assert.deepEqual(bookerSchema.parse(input.booker), normalized);
  assert.deepEqual(prepareBookingInputSchema.parse(input).booker, normalized);
});

test('migration compatibility: booker regex boundaries preserve code units and transform order', async () => {
  const maximumName = '🧭'.repeat(60);
  const maximumNotes = '\udc00'.repeat(2_000);
  const input = {
    name: '  ' + maximumName + '  ',
    email: '  GUEST@EXAMPLE.INVALID  ',
    notes: '  ' + maximumNotes + '  ',
  };
  const expected = { name: maximumName, email: 'guest@example.invalid', notes: maximumNotes };
  assert.deepEqual(bookerSchema.parse(input), expected);
  assert.deepEqual(await bookerSchema.parseAsync(input), expected);
  assert.deepEqual(issuesOf(bookerSchema.safeParse({ ...input, name: maximumName + 'a' })), [
    { code: 'invalid_format', path: ['name'] },
  ]);
  assert.deepEqual(issuesOf(bookerSchema.safeParse({ ...input, notes: maximumNotes + 'a' })), [
    { code: 'invalid_format', path: ['notes'] },
  ]);
  // The legacy name grammar requires two UTF-16 units, rather than two Unicode
  // code points. These distinct outcomes must survive the library migration.
  assert.equal(bookerSchema.parse({ ...booker, name: '🧭' }).name, '🧭');
  assert.deepEqual(issuesOf(bookerSchema.safeParse({ ...booker, name: 'A' })), [
    { code: 'invalid_format', path: ['name'] },
  ]);
});

test('migration baseline: booker controls fail at the existing field paths', () => {
  for (const [field, value] of [
    ['name', '\tGuest Example\t'],
    ['name', 'Guest\u0000Example'],
    ['name', 'Guest\nExample'],
    ['email', 'guest@example.invalid\n'],
    ['notes', '\tHidden tab'],
  ]) {
    assert.deepEqual(issuesOf(bookerSchema.safeParse({ ...booker, [field]: value })), [
      { code: 'invalid_format', path: [field] },
    ]);
  }
});

test('migration baseline: v1 retains offsets while v2 preserves and normalizes microseconds', () => {
  assert.equal(isoInstantSchema.parse(instant), instant);
  assert.equal(v2InstantSchema.parse(instant), '2026-10-24T09:04:56.123456Z');
  assert.equal(v2InstantSchema.parse('2026-10-24T12:34:56.1Z'), '2026-10-24T12:34:56.100000Z');
  assert.equal(v2PrepareBookingInputSchema.parse({
    mandateId: legacyUuid,
    meetingTypeId: legacyUuid,
    username: 'host_one',
    startAt: instant,
  }).startAt, '2026-10-24T09:04:56.123456Z');
  for (const malformed of [
    '2026-10-24T12:34:56.1234567Z',
    '2026-10-24T12:34:56.1234567+03:30',
    '2026-02-30T12:34:56Z',
  ]) {
    assert.equal(isoInstantSchema.safeParse(malformed).success, false);
    assert.equal(v2InstantSchema.safeParse(malformed).success, false);
  }
});

test('migration baseline: existing v1/v2 offset and lowercase-z differences stay explicit', () => {
  // Compatibility observations, not security endorsements. Tightening legacy
  // acceptance requires a separately reviewed correction, not a silent upgrade.
  const outOfRangeOffset = '2026-10-24T12:34:56+24:99';
  assert.equal(isoInstantSchema.parse(outOfRangeOffset), outOfRangeOffset);
  assert.equal(v2InstantSchema.safeParse(outOfRangeOffset).success, false);
  const lowercaseZulu = '2026-10-24T12:34:56z';
  assert.equal(isoInstantSchema.safeParse(lowercaseZulu).success, false);
  assert.equal(v2InstantSchema.parse(lowercaseZulu), '2026-10-24T12:34:56.000000Z');
});

test('migration baseline: local dates retain existing year and Gregorian behavior', () => {
  // The legacy Date.UTC validator maps years 00..99 to 1900..1999, so those
  // four-digit years currently fail. This fixture records rather than fixes it.
  for (const rejected of [
    '0000-01-01', '0001-01-01', '0099-12-31',
    '1900-02-29', '2026-02-30', '2026-1-01',
  ]) {
    assert.deepEqual(issuesOf(localDateSchema.safeParse(rejected)), [
      { code: 'custom', path: [] },
    ]);
  }
  for (const accepted of ['0100-01-01', '2000-02-29', '2026-10-24']) {
    assert.equal(localDateSchema.parse(accepted), accepted);
  }
});

test('migration baseline: v1/v2 strict objects reject root and nested unknown fields', () => {
  const syntheticPrivateValue = 'SYNTHETIC_PRIVATE_INPUT';
  assert.deepEqual(issuesOf(getBookingPageInputSchema.safeParse({
    username: 'host_one', credentialId: syntheticPrivateValue,
  })), [{ code: 'unrecognized_keys', path: [] }]);
  assert.deepEqual(issuesOf(prepareBookingInputSchema.safeParse({
    ...prepareInput, booker: { ...booker, credentialId: syntheticPrivateValue },
  })), [{ code: 'unrecognized_keys', path: ['booker'] }]);
  assert.deepEqual(issuesOf(v2CreateBookingInputSchema.safeParse({
    preparationId: legacyUuid,
    idempotencyKey: legacyUuid,
    principalId: syntheticPrivateValue,
  })), [{ code: 'unrecognized_keys', path: [] }]);
});

test('migration baseline: issue codes and application field paths preserve safe error mapping', async () => {
  const syntheticPrivateValue = 'SYNTHETIC_PRIVATE_INPUT';
  const invalid = {
    ...prepareInput,
    booker: {
      name: 'Guest\nExample',
      email: 'NOT-AN-EMAIL',
      credentialId: syntheticPrivateValue,
    },
    principalId: syntheticPrivateValue,
  };
  assert.deepEqual(issuesOf(prepareBookingInputSchema.safeParse(invalid)), [
    { code: 'invalid_format', path: ['booker', 'email'] },
    { code: 'invalid_format', path: ['booker', 'name'] },
    { code: 'unrecognized_keys', path: ['booker'] },
    { code: 'unrecognized_keys', path: [] },
  ]);
  let authorityCalls = 0;
  const unexpectedAuthorityCall = async () => {
    authorityCalls++;
    throw new Error('The invalid fixture must not reach the scheduling authority.');
  };
  const application = new ProjectSApplication({
    authority: {
      getBookingPage: unexpectedAuthorityCall,
      listFreeSlots: unexpectedAuthorityCall,
      prepareBooking: unexpectedAuthorityCall,
      createBooking: unexpectedAuthorityCall,
    },
  });
  await assert.rejects(application.prepareBooking(invalid, context), (error) => {
    assert.ok(error instanceof ProjectSApplicationError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.equal(error.message, 'The request does not match the Project S v1 contract.');
    assert.deepEqual(error.fieldErrors.map(({ path }) => path), [
      '/booker/email', '/booker/name', '/booker', '/',
    ]);
    assert.deepEqual(error.fieldErrors, [
      { path: '/booker/email', message: 'Invalid' },
      { path: '/booker/name', message: 'Invalid' },
      { path: '/booker', message: "Unrecognized key(s) in object: 'credentialId'" },
      { path: '/', message: "Unrecognized key(s) in object: 'principalId'" },
    ]);
    // The existing safe application projection omits per-field issue codes and
    // input values. The raw schema code/path expectations above remain separate.
    for (const field of error.fieldErrors) {
      assert.equal(Object.hasOwn(field, 'code'), false);
    }
    assert.equal(JSON.stringify(error.fieldErrors).includes(syntheticPrivateValue), false);
    return true;
  });
  const invalidUuid = { ...prepareInput, meetingTypeId: 'invalid' };
  assert.deepEqual(issuesOf(prepareBookingInputSchema.safeParse(invalidUuid)), [
    { code: 'invalid_format', path: ['meetingTypeId'] },
  ]);
  await assert.rejects(application.prepareBooking(invalidUuid, context), (error) => {
    assert.ok(error instanceof ProjectSApplicationError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.deepEqual(error.fieldErrors, [
      { path: '/meetingTypeId', message: 'Invalid uuid' },
    ]);
    return true;
  });
  assert.equal(authorityCalls, 0);
});

test('migration baseline: scopes retain uniqueness and enum issue paths', () => {
  assert.deepEqual(executionContextSchema.parse({ ...context, scopes: [...projectSScopes] }).scopes, [...projectSScopes]);
  assert.deepEqual(issuesOf(executionContextSchema.safeParse({
    ...context, scopes: ['slots:read', 'slots:read'],
  })), [{ code: 'custom', path: ['scopes'] }]);
  assert.deepEqual(issuesOf(executionContextSchema.safeParse({
    ...context, scopes: ['slots:delete'],
  })), [{ code: 'invalid_value', path: ['scopes', 0] }]);
});

test('migration compatibility: existing scalar, object, literal and enum messages remain exact', () => {
  // Recorded from the unchanged 3.25.76 application schemas, not candidate
  // defaults. Raw v4 issue codes can change; these public projections cannot.
  const page = goldenParityVectors[0].authorityData;
  const invalidNumbers = {
    ...page,
    meetingTypes: [{
      ...page.meetingTypes[0], durationMinutes: 4.5, maxAdvanceDays: 0, minNoticeMinutes: -1, title: '  ',
    }],
  };
  const cases = [
    [prepareBookingInputSchema, {}, [
      { path: ['booker'], message: 'Required' },
      { path: ['guestTimeZone'], message: 'Required' },
      { path: ['meetingTypeId'], message: 'Required' },
      { path: ['startAt'], message: 'Required' },
      { path: ['username'], message: 'Required' },
    ]],
    [prepareBookingInputSchema, null, [{ path: [], message: 'Expected object, received null' }]],
    [getBookingPageDataSchema, invalidNumbers, [
      { path: ['meetingTypes', 0, 'durationMinutes'], message: 'Expected integer, received float' },
      { path: ['meetingTypes', 0, 'durationMinutes'], message: 'Number must be greater than or equal to 5' },
      { path: ['meetingTypes', 0, 'maxAdvanceDays'], message: 'Number must be greater than or equal to 1' },
      { path: ['meetingTypes', 0, 'minNoticeMinutes'], message: 'Number must be greater than or equal to 0' },
      { path: ['meetingTypes', 0, 'title'], message: 'String must contain at least 1 character(s)' },
    ]],
    [prepareBookingDataSchema, { ...goldenParityVectors[2].authorityData, notHeld: false }, [
      { path: ['notHeld'], message: 'Invalid literal value, expected true' },
    ]],
    [createBookingDataSchema, { ...goldenParityVectors[3].authorityData, status: 'pending' }, [
      { path: ['status'], message: 'Invalid literal value, expected "confirmed"' },
    ]],
    [executionContextSchema, { ...context, scopes: ['notvalid'] }, [
      { path: ['scopes', 0], message: "Invalid enum value. Expected 'booking_page:read' | 'slots:read' | 'bookings:prepare' | 'bookings:create', received 'notvalid'" },
    ]],
  ];
  for (const [schema, input, expected] of cases) {
    const parsed = schema.safeParse(input);
    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error.issues.map(({ path, message }) => ({ path, message })), expected);
  }
  for (const [type, input] of [
    ['date', new Date(0)], ['map', new Map()], ['set', new Set()],
    ['promise', Promise.resolve(null)], ['nan', NaN], ['number', Infinity],
  ]) {
    const parsed = prepareBookingInputSchema.safeParse(input);
    assert.equal(parsed.success, false);
    assert.deepEqual(parsed.error.issues.map(({ path, message }) => ({ path, message })), [
      { path: [], message: 'Expected object, received ' + type },
    ]);
  }
});

test('migration compatibility: malformed review URLs preserve nonthrowing check order', async () => {
  for (const input of ['', 'a', '🧭']) {
    for (const result of [v2StepUpReviewUrlSchema.safeParse(input), await v2StepUpReviewUrlSchema.safeParseAsync(input)]) {
      assert.equal(result.success, false);
      assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
        { path: [], message: 'Invalid url' },
        { path: [], message: 'Expected an exact authority review URL with one opaque review UUID.' },
      ]);
    }
  }
});

test('migration compatibility: step-up matching does not run after a child transform fails', () => {
  const stepUp = {
    reviewId: legacyUuid,
    reviewUrl: 'https://project-s.example/authority/review#review=' + legacyUuid,
    expiresAt: '2026-11-02T13:05:00.000001Z',
  };
  for (const reviewId of ['', 'invalid']) {
    const result = v2ProblemStepUpSchema.safeParse({ ...stepUp, reviewId });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
      { path: ['reviewId'], message: 'String must contain exactly 36 character(s)' },
      { path: ['reviewId'], message: 'Invalid uuid' },
    ]);
  }
  for (const reviewUrl of ['', 'invalid']) {
    const result = v2ProblemStepUpSchema.safeParse({ ...stepUp, reviewUrl });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
      { path: ['reviewUrl'], message: 'Invalid url' },
      { path: ['reviewUrl'], message: 'Expected an exact authority review URL with one opaque review UUID.' },
    ]);
  }
  const invalidInstantAndMismatchedReview = v2ProblemStepUpSchema.safeParse({
    ...stepUp,
    expiresAt: 'invalid',
    reviewUrl: 'https://project-s.example/authority/review#review=22222222-2222-4222-8222-222222222222',
  });
  assert.equal(invalidInstantAndMismatchedReview.success, false);
  assert.deepEqual(invalidInstantAndMismatchedReview.error.issues.map(({ path, message }) => ({ path, message })), [
    { path: ['expiresAt'], message: 'Invalid v2 instant or UTC value outside four-digit years.' },
    { path: ['reviewUrl'], message: 'Review URL must reference the same review ID.' },
  ]);
});

test('migration compatibility: context binding preserves aborted UUID and continuable instant failures', () => {
  const subjectId = '22222222-2222-4222-8222-222222222222';
  const principal = {
    contractVersion: 2,
    requestId: 'request-v2-context',
    principalId: legacyUuid,
    subjectId,
    instanceId: legacyUuid,
    epoch: 1,
    verifiedAt: '2026-10-22T12:00:00.000001-03:00',
    transport: 'ui',
  };
  const actor = {
    ...principal, actorId: legacyUuid, credentialId: legacyUuid,
    credentialRevision: 1, credentialFingerprint: 'a'.repeat(64), transport: 'stdio_mcp',
  };
  for (const [schema, input, uuidFields] of [
    [v2PrincipalContextSchema, principal, ['principalId', 'subjectId', 'instanceId']],
    [v2ActorContextSchema, actor, ['principalId', 'subjectId', 'instanceId', 'actorId', 'credentialId']],
  ]) {
    for (const field of uuidFields) {
      const result = schema.safeParse({ ...input, [field]: 'invalid' });
      assert.equal(result.success, false);
      assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
        { path: [field], message: 'String must contain exactly 36 character(s)' },
        { path: [field], message: 'Invalid uuid' },
      ]);
    }
    const result = schema.safeParse({ ...input, verifiedAt: 'invalid' });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
      { path: ['verifiedAt'], message: 'Invalid v2 instant or UTC value outside four-digit years.' },
      { path: ['subjectId'], message: 'The initial authority subject must be the issuing principal.' },
    ]);
  }
});

test('migration compatibility: nested continuable instant errors preserve problem and envelope refusals', () => {
  const problem = {
    code: 'FORBIDDEN', status: 400,
    type: 'https://project-s.example/problems/forbidden',
    title: 'Permission unavailable', detail: 'The requested operation is not permitted.',
    requestId: 'request-v2-problems',
    stepUp: {
      reviewId: legacyUuid,
      reviewUrl: 'https://project-s.example/authority/review#review=' + legacyUuid,
      expiresAt: 'invalid',
    },
  };
  const result = v2ProblemEnvelopeSchema.safeParse({
    contractVersion: 2, requestId: 'request-v2-other', error: problem,
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
    { path: ['error', 'stepUp', 'expiresAt'], message: 'Invalid v2 instant or UTC value outside four-digit years.' },
    { path: ['error', 'status'], message: 'Status must be 403 for FORBIDDEN.' },
    { path: ['error', 'stepUp'], message: 'Step-up is required only for STEP_UP_REQUIRED.' },
    { path: ['error', 'requestId'], message: 'Envelope and problem request IDs must match.' },
  ]);
});

test('migration compatibility: invalid booker transforms suppress the parent slot-order check', () => {
  const summary = goldenParityVectors[2].authorityData.summary;
  for (const [field, value] of [['email', 'invalid'], ['name', 'a'], ['notes', '\t']]) {
    const result = preparedBookingSummarySchema.safeParse({
      ...summary, booker: { ...summary.booker, [field]: value }, endAt: summary.startAt,
    });
    assert.equal(result.success, false);
    assert.deepEqual(result.error.issues.map(({ path, message }) => ({ path, message })), [
      { path: ['booker', field], message: 'Invalid' },
    ]);
  }
});
