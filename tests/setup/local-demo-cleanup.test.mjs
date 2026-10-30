import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalDemoCleanup, localDemoIdentity } from '../../scripts/lib/local-demo-cleanup.mjs';

const manifest = {
  runId: 'a1111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  meetingTypeId: '33333333-3333-4333-8333-333333333333',
  bookingId: '44444444-4444-4444-8444-444444444444',
  startedAt: '2026-10-30T12:00:00.000Z',
};

test('demo identity is deterministic, immutable, bounded and reserved for local test mail', () => {
  const identity = localDemoIdentity(manifest.runId);
  assert.deepEqual(identity, localDemoIdentity(manifest.runId));
  assert.equal(Object.isFrozen(identity), true);
  assert.match(identity.username, /^[a-z0-9][a-z0-9_-]{2,29}$/);
  assert.equal(identity.username.length, 29);
  assert.equal(identity.email, 'demo-a1111111111141118111111111111111@example.invalid');
  assert.notEqual(identity.email, identity.guestEmail);
  assert.match(identity.hostName, /^Local Demo Host /);
  assert.match(identity.guestName, /^Local Demo Guest /);
});

test('identity generation rejects noncanonical or interpolated identifiers without echoing input', () => {
  for (const unsafe of [null, undefined, [], [manifest.runId], {}, 1, manifest.runId.toUpperCase(),
    "'; delete from auth.users; --"]) {
    assert.throws(() => localDemoIdentity(unsafe), { message: 'Local demo cleanup requires its exact run-owned manifest.' });
  }
});

test('cleanup rejects unsafe manifest shapes, extras and accessors before building SQL', () => {
  const getter = { ...manifest };
  Object.defineProperty(getter, 'userId', { get() { throw new Error('getter must not execute'); }, enumerable: true });
  for (const unsafe of [null, [], 'fixture', 0, { ...manifest, serviceRoleKey: 'synthetic-secret' },
    { ...manifest, email: 'person@example.com' }, { ...manifest, bookingIds: [manifest.bookingId] },
    Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'bookingId')), getter]) {
    assert.throws(() => buildLocalDemoCleanup(unsafe), { message: 'Local demo cleanup requires its exact run-owned manifest.' });
  }
});

test('every manifest identifier must be a primitive canonical v4 UUID and IDs must be distinct', () => {
  for (const key of ['runId', 'userId', 'meetingTypeId', 'bookingId']) {
    for (const unsafe of [[manifest[key]], { toString: () => manifest[key] }, null, 1, 'main',
      "a'; delete from auth.users; --", manifest[key].toUpperCase()]) {
      if (unsafe === manifest[key]) continue;
      assert.throws(() => buildLocalDemoCleanup({ ...manifest, [key]: unsafe }));
    }
  }
  assert.throws(() => buildLocalDemoCleanup({ ...manifest, bookingId: manifest.userId }));
});

test('cleanup refuses impossible, noncanonical and injection-shaped timestamps', () => {
  for (const startedAt of [null, ['2026-10-30T12:00:00.000Z'], '2026-02-30T12:00:00.000Z',
    '2026-10-30', '2026-10-30T12:00:00+00:00', '2026-10-30T12:00:00.000Z\n',
    "2026-10-30T12:00:00.000Z'; drop schema public; --"]) {
    assert.throws(() => buildLocalDemoCleanup({ ...manifest, startedAt }));
  }
});

test('SQL is bounded to the cancelled recorded fixture and commits before reporting sanitized counts', () => {
  const sql = buildLocalDemoCleanup(manifest);
  assert.match(sql, /pg_try_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_user::text, 0\)\)/);
  assert.match(sql, /for update nowait/);
  assert.match(sql, /status = 'cancelled' and version = 2 and canceled_by = 'host'/);
  assert.match(sql, /LOCAL_DEMO_UNEXPECTED_RECORDS/);
  assert.match(sql, /LOCAL_DEMO_UNEXPECTED_REFERENCES/);
  assert.match(sql, /private\.v2_authority_principals/);
  assert.match(sql, /storage\.objects/);
  assert.match(sql, /pg_catalog\.pg_constraint/);
  assert.ok(sql.indexOf('delete from private.booking_confirmation_grants') < sql.indexOf('delete from public.bookings'));
  assert.ok(sql.indexOf('delete from public.bookings') < sql.indexOf('delete from private.booking_preparations'));
  assert.ok(sql.indexOf('delete from private.booking_preparations') < sql.indexOf('delete from auth.users'));
  assert.doesNotMatch(sql, /(?:delete from|update|truncate) private\.(?:booking_audit_events|v2_)/i);
  assert.doesNotMatch(sql, /(?:disable trigger|drop |cascade;|set role|service_role)/i);
  const output = sql.slice(sql.lastIndexOf('commit;'));
  assert.match(output, /^commit;\nselect pg_catalog\.json_build_object/);
  for (const value of Object.values(manifest)) assert.equal(output.includes(value), false);
  assert.equal(output.includes('@example.invalid'), false);
});
