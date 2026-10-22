import { describe, expect, expectTypeOf, it } from 'vitest';

import { v2CreateBookingInputSchema, v2PrepareBookingInputSchema } from '../src/v2/operations.js';
import {
  v2ActorContextNode,
  v2ActorContextSchema,
  v2PrincipalContextNode,
  v2PrincipalContextSchema,
  type V2ActorContext,
  type V2PrincipalContext,
} from '../src/v2/contexts.js';

const principalId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const credentialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const instanceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const reference = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const principal = {
  contractVersion: 2,
  requestId: 'request-v2-context', principalId, subjectId: principalId.toLowerCase(),
  instanceId, epoch: 1, verifiedAt: '2026-10-22T12:00:00.000001-03:00', transport: 'ui',
};
const actor = {
  ...principal, actorId, credentialId, credentialRevision: 1,
  credentialFingerprint: 'a'.repeat(64), transport: 'stdio_mcp',
};

describe('strict server-derived v2 contexts, never proof of verification', () => {
  it('normalizes account binding and verified time without losing a microsecond', () => {
    const parsed = v2PrincipalContextSchema.parse(principal);
    expect(parsed.principalId).toBe(principalId.toLowerCase());
    expect(parsed.subjectId).toBe(parsed.principalId);
    expect(parsed.verifiedAt).toBe('2026-10-22T15:00:00.000001Z');
    expectTypeOf(parsed).toEqualTypeOf<V2PrincipalContext>();
  });

  it('requires the complete actor binding as distinct from display metadata', () => {
    const parsed = v2ActorContextSchema.parse(actor);
    expectTypeOf(parsed).toEqualTypeOf<V2ActorContext>();
    expect(parsed).toMatchObject({ actorId, credentialId, credentialRevision: 1, epoch: 1 });
    for (const key of ['actorId', 'credentialId', 'credentialRevision', 'credentialFingerprint']) {
      const missing = { ...actor } as Record<string, unknown>;
      delete missing[key];
      expect(v2ActorContextSchema.safeParse(missing).success).toBe(false);
    }
  });

  it.each(['ui', 'http'])('permits reviewed principal transport %s', (transport) => {
    expect(v2PrincipalContextSchema.safeParse({ ...principal, transport }).success).toBe(true);
  });
  it.each(['http', 'stdio_mcp'])('permits reviewed actor transport %s', (transport) => {
    expect(v2ActorContextSchema.safeParse({ ...actor, transport }).success).toBe(true);
  });
  it.each(['ui', 'streamable_http_mcp', 'internal', '', null])('rejects actor transport %s', (transport) => {
    expect(v2ActorContextSchema.safeParse({ ...actor, transport }).success).toBe(false);
  });
  it.each(['stdio_mcp', 'streamable_http_mcp', 'internal', '', null])('rejects principal transport %s', (transport) => {
    expect(v2PrincipalContextSchema.safeParse({ ...principal, transport }).success).toBe(false);
  });

  it('refuses issuing on behalf of a different subject in either context', () => {
    expect(v2PrincipalContextSchema.safeParse({ ...principal, subjectId: actorId }).success).toBe(false);
    expect(v2ActorContextSchema.safeParse({ ...actor, subjectId: actorId }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null])('rejects unsafe or ambiguous epoch/revision %s', (value) => {
    expect(v2PrincipalContextSchema.safeParse({ ...principal, epoch: value }).success).toBe(false);
    expect(v2ActorContextSchema.safeParse({ ...actor, credentialRevision: value }).success).toBe(false);
  });

  it.each(['principalId', 'subjectId', 'instanceId', 'actorId', 'credentialId'])('rejects malformed identity %s', (field) => {
    expect(v2ActorContextSchema.safeParse({ ...actor, [field]: 'client-claim' }).success).toBe(false);
  });

  it.each(['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '\n', true, null])('rejects malformed credential fingerprint %s', (credentialFingerprint) => {
    expect(v2ActorContextSchema.safeParse({ ...actor, credentialFingerprint }).success).toBe(false);
  });

  it.each([
    { actorKind: 'delegated_agent' }, { allowed: true }, { confirmed: true },
    { scopes: ['bookings:create'] }, { credential: 'not-a-real-credential' },
    { authorization: 'Bearer example' }, { onBehalfOf: actorId }, { email: 'guest@example.com' },
    { provenance: { source: 'project_s_mcp' } }, { contractVersion: 1 },
  ])('refuses extra identity, capability or legacy override fields %j', (override) => {
    expect(v2PrincipalContextSchema.safeParse({ ...principal, ...override }).success).toBe(false);
    expect(v2ActorContextSchema.safeParse({ ...actor, ...override }).success).toBe(false);
  });

  it('does not let actor credentials enter a principal context', () => {
    expect(v2PrincipalContextSchema.safeParse({ ...actor, transport: 'http' }).success).toBe(false);
  });

  it('keeps internal context fields out of public prepare/create inputs', () => {
    const prepare = { mandateId: reference, username: 'demo-host', meetingTypeId: reference, startAt: principal.verifiedAt };
    const create = { preparationId: reference, idempotencyKey: reference };
    expect(v2PrepareBookingInputSchema.safeParse(prepare).success).toBe(true);
    expect(v2CreateBookingInputSchema.safeParse(create).success).toBe(true);
    for (const [key, value] of Object.entries(actor)) {
      expect(v2PrepareBookingInputSchema.safeParse({ ...prepare, [key]: value }).success).toBe(false);
      expect(v2CreateBookingInputSchema.safeParse({ ...create, [key]: value }).success).toBe(false);
    }
    expect(v2PrepareBookingInputSchema.safeParse({ ...prepare, context: actor }).success).toBe(false);
    expect(v2CreateBookingInputSchema.safeParse({ ...create, context: actor }).success).toBe(false);
  });

  it('marks both generated schemas internal and does not claim parsing authenticates', () => {
    for (const node of [v2PrincipalContextNode, v2ActorContextNode]) {
      expect(node.jsonSchema.additionalProperties).toBe(false);
      expect(node.jsonSchema['x-project-s-internal-only']).toBe(true);
      expect(node.jsonSchema['x-project-s-refinements']).toEqual(expect.arrayContaining([
        expect.stringContaining('does not authenticate'),
      ]));
    }
  });
});
