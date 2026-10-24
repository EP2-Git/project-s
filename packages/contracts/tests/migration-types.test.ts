import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  bookerSchema,
  createBookingInputSchema,
  prepareBookingInputSchema,
  publicMeetingTypeSchema,
} from '../src/index.js';
import { v2CreateBookingInputSchema, v2InstantSchema, v2RevisionNode } from '../src/v2/index.js';
import { contractNode, objectNode } from '../src/schema.js';

type BookerShape = { email: string; name: string; notes?: string | undefined };
type PrepareShape = {
  booker: BookerShape;
  guestTimeZone: string;
  meetingTypeId: string;
  startAt: string;
  username: string;
};
type MeetingTypeShape = {
  description: string | null;
  durationMinutes: number;
  maxAdvanceDays: number;
  meetingTypeId: string;
  minNoticeMinutes: number;
  title: string;
};

describe('reviewed Zod 4 consumer type boundary', () => {
  it('preserves concrete domain inputs and outputs through normalization and strict objects', () => {
    // Literal independent shapes catch accidental unknown/any widening caused
    // by replacing the old ZodEffects and strict-object generic annotations.
    expectTypeOf<z.input<typeof bookerSchema>>().toEqualTypeOf<BookerShape>();
    expectTypeOf<z.output<typeof bookerSchema>>().toEqualTypeOf<BookerShape>();
    expectTypeOf<z.input<typeof prepareBookingInputSchema>>().toEqualTypeOf<PrepareShape>();
    expectTypeOf<z.output<typeof prepareBookingInputSchema>>().toEqualTypeOf<PrepareShape>();
    expectTypeOf<z.input<typeof createBookingInputSchema>>().toEqualTypeOf<{
      idempotencyKey: string; preparationToken: string;
    }>();
    expectTypeOf<z.output<typeof createBookingInputSchema>>().toEqualTypeOf<{
      idempotencyKey: string; preparationToken: string;
    }>();
    expectTypeOf<z.input<typeof publicMeetingTypeSchema>>().toEqualTypeOf<MeetingTypeShape>();
    expectTypeOf<z.output<typeof publicMeetingTypeSchema>>().toEqualTypeOf<MeetingTypeShape>();
    expectTypeOf<z.input<typeof v2InstantSchema>>().toEqualTypeOf<string>();
    expectTypeOf<z.output<typeof v2InstantSchema>>().toEqualTypeOf<string>();
    expectTypeOf<z.input<typeof v2RevisionNode.zod>>().toEqualTypeOf<number>();
    expectTypeOf<z.output<typeof v2RevisionNode.zod>>().toEqualTypeOf<number>();
    expectTypeOf<z.input<typeof v2CreateBookingInputSchema>>().toEqualTypeOf<{
      idempotencyKey: string; preparationId: string;
    }>();
    expectTypeOf<z.output<typeof v2CreateBookingInputSchema>>().toEqualTypeOf<{
      idempotencyKey: string; preparationId: string;
    }>();
    expect(bookerSchema.parse({ name: '  Guest Example  ', email: '  GUEST@EXAMPLE.INVALID  ' }))
      .toEqual({ name: 'Guest Example', email: 'guest@example.invalid' });
  });

  it('keeps reusable field schemas on the node without advertising a parser facade', () => {
    const label = z.string().trim();
    const node = objectNode({ label: contractNode(label, { type: 'string' }) });
    expect(node.shape.label).toBe(label);
    for (const parser of [node.zod, node.zod.clone(), node.zod.describe('consumer'), node.zod.refine(() => true)]) {
      // Native derivation only preserves Zod's genuine parser API. The
      // separately retained node shape supports field reuse after derivation.
      type AdvertisesShape = 'shape' extends keyof typeof parser ? true : false;
      expectTypeOf<AdvertisesShape>().toEqualTypeOf<false>();
      expect(parser).not.toHaveProperty('shape');
      expect(parser.parse({ label: '  human-readable  ' })).toEqual({ label: 'human-readable' });
      expect(parser.safeParse({ label: 'valid', extra: true }).success).toBe(false);
      expect(node.shape.label.parse('  reusable  ')).toBe('reusable');
    }
  });
});
