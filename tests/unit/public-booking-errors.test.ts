import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE,
  PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE,
  messageForPublicBookingProblem,
} from '../../src/lib/publicBookingErrorMessage';

describe('public booking error messages', () => {
  it('explains the exact safe origin-configuration refusal', () => {
    expect(
      messageForPublicBookingProblem(
        'FORBIDDEN',
        'This browser origin is not allowed to call Project S.',
      ),
    ).toBe(
      'Site configuration error: this web address is not in Project S’s allowed origins. Ask the site administrator to update the booking-service configuration.',
    );
  });

  it('keeps unrelated authority refusals deliberately generic', () => {
    expect(
      messageForPublicBookingProblem(
        'FORBIDDEN',
        'Human confirmation could not be verified.',
      ),
    ).toBe('This booking action is not allowed.');
  });

  it('distinguishes unreachable, invalid-response, and service failures', () => {
    expect(PUBLIC_BOOKING_TRANSPORT_ERROR_MESSAGE).toMatch(/could not reach/i);
    expect(PUBLIC_BOOKING_PROTOCOL_ERROR_MESSAGE).toMatch(/invalid response/i);
    expect(messageForPublicBookingProblem('INTERNAL_ERROR')).toMatch(
      /temporarily unavailable/i,
    );
  });
});

describe('local Edge origin configuration', () => {
  it('allows the default app, end-to-end test, and selected-review ports', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'project-s-edge-env-'));

    try {
      execFileSync(
        process.execPath,
        [resolve(process.cwd(), 'scripts/write-local-edge-env.mjs')],
        { cwd: fixtureRoot, stdio: 'pipe' },
      );
      const content = readFileSync(
        join(fixtureRoot, 'supabase/functions/.env'),
        'utf8',
      );
      const allowedOrigins = content
        .split('\n')
        .find((line) => line.startsWith('PROJECT_S_ALLOWED_ORIGINS='))
        ?.split('=')[1]
        .split(',');

      expect(allowedOrigins).toEqual(
        expect.arrayContaining([
          'http://127.0.0.1:8080',
          'http://127.0.0.1:4173',
          'http://127.0.0.1:4184',
          'http://localhost:4184',
        ]),
      );
      expect(
        allowedOrigins?.every((origin) => {
          const url = new URL(origin);
          return (
            url.protocol === 'http:' &&
            ['127.0.0.1', 'localhost'].includes(url.hostname)
          );
        }),
      ).toBe(true);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
