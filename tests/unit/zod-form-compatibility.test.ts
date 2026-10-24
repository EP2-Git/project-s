import { zodResolver } from '@hookform/resolvers/zod';
import { act, renderHook } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { z } from 'zod';
import { bookingFormSchema, type BookingFormValues } from '../../src/types/bookingForm';
import { signupFormSchema, type SignupFormValues } from '../../src/types/signupForm';
import { personalInfoFormSchema, type PersonalInfoFormValues } from '../../src/types/personalInfoForm';
import { cancelBookingResponseSchema } from '../../src/types/hostBooking';

const resolverOptions = {
  criteriaMode: 'all' as const,
  fields: {},
  shouldUseNativeValidation: false,
};
const booking = { name: '  Synthetic Guest  ', email: '  Guest+test@Example.COM  ', notes: '  Test note  ', terms: true };
const signup = { fullName: '  Synthetic User  ', email: '  Guest+test@Example.COM  ', username: 'synthetic-user', password: 'synthetic-password' };
const personalInfo = { fullName: '  Synthetic User  ', username: 'synthetic-user', timezone: 'America/Halifax' };

describe('Zod 4 form resolver compatibility', () => {
  it('preserves domain input/output types for each form without resolver casts', () => {
    expectTypeOf<z.input<typeof bookingFormSchema>>().toEqualTypeOf<BookingFormValues>();
    expectTypeOf<z.input<typeof signupFormSchema>>().toEqualTypeOf<SignupFormValues>();
    expectTypeOf<z.input<typeof personalInfoFormSchema>>().toEqualTypeOf<PersonalInfoFormValues>();
  });

  it('keeps React Hook Form validation and normalized submission working', async () => {
    const { result } = renderHook(() => {
      const form = useForm<BookingFormValues>({
        resolver: zodResolver(bookingFormSchema), mode: 'onChange',
        defaultValues: { name: '', email: '', notes: '', terms: false },
      });
      return { ...form, errors: form.formState.errors };
    });
    const submit = vi.fn();
    await act(() => result.current.handleSubmit(submit)());
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.errors.name?.message).toBe('Name must be at least 2 characters.');
    expect(result.current.errors.terms?.message).toBe('You must accept the terms and privacy notice.');
    act(() => {
      result.current.setValue('name', booking.name);
      result.current.setValue('email', booking.email);
      result.current.setValue('notes', booking.notes);
      result.current.setValue('terms', true);
    });
    await act(() => result.current.handleSubmit(submit)());
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0]).toEqual({
      name: 'Synthetic Guest', email: 'Guest+test@Example.COM', notes: 'Test note', terms: true,
    });
    expect(result.current.errors).toEqual({});
  });

  for (const mode of ['sync', 'async'] as const) {
    it(`resolves normalized booking values and retains their email case (${mode})`, async () => {
      const result = await zodResolver(bookingFormSchema, undefined, { mode })(booking, undefined, resolverOptions);
      expect(result).toEqual({ errors: {}, values: {
        name: 'Synthetic Guest', email: 'Guest+test@Example.COM', notes: 'Test note', terms: true,
      } });
      expect(booking.name).toBe('  Synthetic Guest  ');
    });

    it(`returns existing booking field messages instead of throwing (${mode})`, async () => {
      const result = await zodResolver(bookingFormSchema, undefined, { mode })({
        name: ' ', email: 'invalid', notes: 'x'.repeat(2001), terms: false,
      }, undefined, resolverOptions);
      expect(result.values).toEqual({});
      expect(result.errors.name?.message).toBe('Name must be at least 2 characters.');
      expect(result.errors.email?.message).toBe('Enter a valid email address.');
      expect(result.errors.notes?.message).toBe('Notes cannot exceed 2,000 characters.');
      expect(result.errors.terms?.message).toBe('You must accept the terms and privacy notice.');
    });

    it(`resolves signup and personal profile values after trimming (${mode})`, async () => {
      expect(await zodResolver(signupFormSchema, undefined, { mode })(signup, undefined, resolverOptions))
        .toEqual({ errors: {}, values: { ...signup, fullName: 'Synthetic User', email: 'Guest+test@Example.COM' } });
      expect(await zodResolver(personalInfoFormSchema, undefined, { mode })(personalInfo, undefined, resolverOptions))
        .toEqual({ errors: {}, values: { ...personalInfo, fullName: 'Synthetic User' } });
    });

    it(`keeps signup and profile errors attached to their existing field names (${mode})`, async () => {
      const signupResult = await zodResolver(signupFormSchema, undefined, { mode })({
        fullName: ' ', email: 'bad', username: 'A!', password: 'short',
      }, undefined, resolverOptions);
      expect(signupResult.values).toEqual({});
      expect(signupResult.errors.fullName?.message).toBe('Full name must be at least 2 characters.');
      expect(signupResult.errors.email?.message).toBe('Please enter a valid email address.');
      expect(signupResult.errors.username?.message).toBe('Username must be at least 3 characters.');
      expect(Object.values(signupResult.errors.username?.types ?? {})).toContain('Use lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.');
      expect(signupResult.errors.password?.message).toBe('Password must be at least 6 characters.');
      const profileResult = await zodResolver(personalInfoFormSchema, undefined, { mode })({
        fullName: 'x'.repeat(121), username: 'A!bad', timezone: 'Invalid/Synthetic',
      }, undefined, resolverOptions);
      expect(profileResult.values).toEqual({});
      expect(profileResult.errors.fullName?.message).toBe('Full name cannot exceed 120 characters.');
      expect(profileResult.errors.username?.message).toBe('Use lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.');
      expect(profileResult.errors.timezone?.message).toBe('Invalid IANA time zone.');
    });
  }

  it('keeps UTF-16 boundaries after trim for names, notes and passwords', () => {
    expect(bookingFormSchema.safeParse({ ...booking, name: ` ${'😀'.repeat(60)} `, notes: '😀'.repeat(1000) }).success).toBe(true);
    expect(bookingFormSchema.safeParse({ ...booking, name: '😀'.repeat(61) }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...booking, notes: '😀'.repeat(1001) }).success).toBe(false);
    expect(bookingFormSchema.safeParse({ ...booking, name: '😀' }).success).toBe(true);
    expect(signupFormSchema.safeParse({ ...signup, fullName: '😀'.repeat(60), password: '😀'.repeat(3) }).success).toBe(true);
    expect(signupFormSchema.safeParse({ ...signup, fullName: '😀'.repeat(61) }).success).toBe(false);
    expect(signupFormSchema.safeParse({ ...signup, password: '😀'.repeat(2) }).success).toBe(false);
    expect(personalInfoFormSchema.safeParse({ ...personalInfo, fullName: '\ud800'.repeat(120) }).success).toBe(true);
    expect(personalInfoFormSchema.safeParse({ ...personalInfo, fullName: '\ud800'.repeat(121) }).success).toBe(false);
  });

  it('keeps the existing form email grammar and does not use canonical API normalization', () => {
    const trailingHyphen = 'guest@example.invalid'.replace('@example.', '@example-.');
    for (const email of ["apostrophe'name@example.com", 'local_underscore@example.com', 'plus+tag@example.com', trailingHyphen]) {
      expect(bookingFormSchema.parse({ ...booking, email }).email).toBe(email);
      expect(signupFormSchema.parse({ ...signup, email }).email).toBe(email);
    }
    for (const email of ['.leading@example.com', 'double..dot@example.com', 'guest@localhost', 'guest@example.c']) {
      expect(bookingFormSchema.safeParse({ ...booking, email }).success).toBe(false);
      expect(signupFormSchema.safeParse({ ...signup, email }).success).toBe(false);
    }
  });

  it('accepts valid 320-unit emails and rejects larger values with the prior message', () => {
    const email = `${'a'.repeat(253)}@${'b'.repeat(62)}.com`;
    expect(email.length).toBe(320);
    expect(bookingFormSchema.parse({ ...booking, email }).email).toBe(email);
    const result = bookingFormSchema.safeParse({ ...booking, email: `a${email}` });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe('String must contain at most 320 character(s)');
  });

  it('retains stripping of extra form fields and does not submit them', async () => {
    const input = { ...booking, privateDiagnostic: 'synthetic-only' };
    const result = await zodResolver(bookingFormSchema)(input, undefined, resolverOptions);
    expect(result.errors).toEqual({});
    expect(result.values).not.toHaveProperty('privateDiagnostic');
  });

  it('refuses legacy non-object categories even when they carry valid form properties', () => {
    for (const value of [new Date('2040-01-01'), new Map(), new Set(), Promise.resolve(null)]) {
      expect(bookingFormSchema.safeParse(Object.assign(value, booking)).success).toBe(false);
      expect(signupFormSchema.safeParse(Object.assign(value, signup)).success).toBe(false);
      expect(personalInfoFormSchema.safeParse(Object.assign(value, personalInfo)).success).toBe(false);
    }
  });

  it('preserves host cancellation GUID grammar, integer boundary and strict envelope', () => {
    const response = { bookingId: '11111111-1111-1111-1111-111111111111', status: 'cancelled', version: Number.MAX_SAFE_INTEGER + 1, canceledAt: null };
    expect(cancelBookingResponseSchema.parse(response)).toEqual(response);
    for (const version of [0, -1, 1.5, Infinity, NaN]) {
      expect(cancelBookingResponseSchema.safeParse({ ...response, version }).success).toBe(false);
    }
    expect(cancelBookingResponseSchema.safeParse({ ...response, privateDiagnostic: 'synthetic-only' }).success).toBe(false);
  });
});
