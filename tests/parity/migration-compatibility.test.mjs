import assert from 'node:assert/strict';
import {
  bookerSchema,
  descriptionNode,
  displayNameNode,
  executionContextSchema,
  getBookingPageInputSchema,
  isoInstantSchema,
  localDateSchema,
  prepareBookingInputSchema,
  projectSScopes,
  titleNode,
  uuidSchema,
} from '@project-s/contracts';
import {
  v2CreateBookingInputSchema,
  v2InstantSchema,
  v2PrepareBookingInputSchema,
  v2UuidSchema,
} from '../../packages/contracts/dist/v2/index.js';
import {
  ProjectSApplication,
  ProjectSApplicationError,
} from '@project-s/application';

// Freeze actual Project S behavior for a future migration. These fixtures run
// against the current schemas; passing them does not demonstrate Zod 4 support.
// Raw issue codes also record the v3 parser API. Any approved v4 diagnostic API
// change must be reviewed separately from unchanged public field-error messages.
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

test('migration baseline: booker controls fail at the existing field paths', () => {
  for (const [field, value] of [
    ['name', '\tGuest Example\t'],
    ['name', 'Guest\u0000Example'],
    ['name', 'Guest\nExample'],
    ['email', 'guest@example.invalid\n'],
    ['notes', '\tHidden tab'],
  ]) {
    assert.deepEqual(issuesOf(bookerSchema.safeParse({ ...booker, [field]: value })), [
      { code: 'invalid_string', path: [field] },
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
    { code: 'invalid_string', path: ['booker', 'email'] },
    { code: 'invalid_string', path: ['booker', 'name'] },
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
    { code: 'invalid_string', path: ['meetingTypeId'] },
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
  })), [{ code: 'invalid_enum_value', path: ['scopes', 0] }]);
});
