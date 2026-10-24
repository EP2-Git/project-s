#!/usr/bin/env node
import assert from 'node:assert/strict';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { chromium, expect, firefox, webkit } from '@playwright/test';
import { PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES } from '@project-s/contracts';

// Browser-only synthetic responses exercise the built app's real support helper.
// Nothing reaches Auth, an API, a challenge provider or a scheduling database.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'test-results/browser-support-limits');
assert.ok(outDir.startsWith(`${root}${sep}`) && outDir !== root);
const origin = 'http://127.0.0.1:4195';
const preparationToken = 'prep_abcdefghijklmnopqrstuvwxyz0123456789';
const requestId = 'synthetic-browser-support';
const preparationId = '11111111-1111-4111-8111-111111111111';
const protocolMessage = 'The scheduling service returned an invalid response.';
const rateMessage = 'Too many requests were made. Please wait a moment and try again.';
const privateDiagnostic = 'synthetic private upstream diagnostic';
const fixture = {
  preparationId,
  expiresAt: '2040-01-01T13:00:00.000Z',
  notHeld: true,
  summary: {
    username: 'demo-host',
    hostDisplayName: 'Synthetic Host Café 🧭',
    meetingTypeId: '22222222-2222-4222-8222-222222222222',
    meetingTypeTitle: 'Synthetic browser review',
    startAt: '2040-01-01T14:00:00.000Z',
    endAt: '2040-01-01T14:30:00.000Z',
    hostTimeZone: 'UTC',
    guestTimeZone: 'UTC',
    booker: {
      name: '  Synthetic Guest  ',
      email: '  GUEST@example.com  ',
      notes: 'Synthetic browser-only fixture.',
    },
  },
};
const grant = {
  preparationId,
  grantId: '33333333-3333-4333-8333-333333333333',
  confirmedAt: '2040-01-01T12:00:00.000Z',
  method: 'human_browser',
};
const scenarios = ['valid', 'oversized-preview', 'oversized-confirm', 'rate-preview', 'rate-confirm'];
const buildConfig = {
  root,
  configFile: false,
  envDir: false,
  envPrefix: 'PROJECT_S_SYNTHETIC_UNUSED_',
  logLevel: 'warn',
  plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } },
  build: { outDir, emptyOutDir: true },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(origin),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('synthetic-browser-support'),
    'import.meta.env.VITE_PROJECT_S_API_URL': JSON.stringify(origin),
    'import.meta.env.VITE_PROJECT_S_TURNSTILE_SITE_KEY': JSON.stringify(''),
    'import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE': JSON.stringify('self-hosted'),
  },
};

const installFixture = ({ scenario, maximumBytes, fixture, grant, requestId, privateDiagnostic }) => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  const entries = [];
  const calls = [];
  const paths = new Map([
    ['/api/v1/public/booking-preparations/preview', 'preview'],
    ['/api/v1/public/booking-preparations/confirm', 'confirm'],
  ]);
  globalThis.__projectSSupportLimits = {
    snapshot: () => ({
      calls,
      streams: entries.map(({ body, ...entry }) => ({ ...entry, locked: body.locked })),
    }),
  };
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, globalThis.location.href);
    const operation = url.origin === globalThis.location.origin ? paths.get(url.pathname) : undefined;
    if (!operation) return originalFetch(input, init);
    calls.push({
      operation,
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    const oversized = scenario === `oversized-${operation}`;
    const rateLimited = scenario === `rate-${operation}`;
    const problem = {
      type: 'https://project-s.example/problems/rate-limited',
      title: 'Rate limited',
      status: 429,
      code: 'RATE_LIMITED',
      detail: privateDiagnostic,
      requestId,
      retry: { action: 'retry_after', afterSeconds: 7 },
    };
    const payload = rateLimited
      ? operation === 'preview' ? problem : { contractVersion: 1, requestId, error: problem }
      : { contractVersion: 1, requestId, data: operation === 'preview' ? fixture : grant };
    const prefix = new TextEncoder().encode(JSON.stringify(payload));
    const totalBytes = oversized ? maximumBytes + 4_096 : prefix.byteLength;
    const entry = {
      operation,
      status: rateLimited ? 429 : 200,
      deliveredBytes: 0,
      totalBytes,
      cancellations: 0,
      readerCancellations: 0,
      releases: 0,
      textCalls: 0,
      jsonCalls: 0,
    };
    const stream = new ReadableStream({
      pull(controller) {
        if (entry.deliveredBytes === totalBytes) {
          controller.close();
          return;
        }
        // Valid bodies deliberately split every UTF-8 code point into bytes.
        const length = Math.min(oversized ? 512 : 1, totalBytes - entry.deliveredBytes);
        const chunk = new Uint8Array(length).fill(32);
        if (entry.deliveredBytes < prefix.byteLength) {
          chunk.set(prefix.subarray(entry.deliveredBytes, Math.min(prefix.byteLength, entry.deliveredBytes + length)));
        }
        entry.deliveredBytes += length;
        controller.enqueue(chunk);
      },
      cancel() { entry.cancellations += 1; },
    }, { highWaterMark: 0 });
    const headers = { 'content-type': 'application/json', 'x-request-id': requestId };
    if (oversized && operation === 'confirm') headers['content-length'] = '1';
    const response = new Response(stream, { status: entry.status, headers });
    entry.body = response.body;
    entries.push(entry);
    const getReader = response.body.getReader.bind(response.body);
    Object.defineProperty(response.body, 'getReader', {
      value: () => {
        const reader = getReader();
        const cancel = reader.cancel.bind(reader);
        const releaseLock = reader.releaseLock.bind(reader);
        reader.cancel = (reason) => {
          entry.readerCancellations += 1;
          return cancel(reason);
        };
        reader.releaseLock = () => {
          releaseLock();
          entry.releases += 1;
        };
        return reader;
      },
    });
    const text = response.text.bind(response);
    const json = response.json.bind(response);
    response.text = () => { entry.textCalls += 1; return text(); };
    response.json = () => { entry.jsonCalls += 1; return json(); };
    return Promise.resolve(response);
  };
};

const tabTo = async (page, locator) => {
  for (let count = 0; count < 32; count += 1) {
    if (await locator.evaluate((element) => element === globalThis.document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('The expected confirmation control was not reachable by keyboard.');
};

const approveByKeyboard = async (page) => {
  const approve = page.getByRole('button', { name: 'Approve booking', exact: true });
  await expect(approve).toBeDisabled();
  const terms = page.getByRole('checkbox', { name: /Accept terms and privacy notice/ });
  const human = page.getByRole('checkbox', { name: /I reviewed these details and am confirming this local development booking/ });
  await tabTo(page, terms);
  await page.keyboard.press('Space');
  await expect(terms).toBeChecked();
  await expect(approve).toBeDisabled();
  await tabTo(page, human);
  await page.keyboard.press('Space');
  await expect(human).toBeChecked();
  await expect(approve).toBeEnabled();
  const before = await page.evaluate(() => globalThis.__projectSSupportLimits.snapshot());
  assert.equal(before.calls.filter((call) => call.operation === 'confirm').length, 0);
  await tabTo(page, approve);
  await page.keyboard.press('Enter');
};

await build(buildConfig);
const server = await preview({
  root,
  configFile: false,
  envDir: false,
  envPrefix: 'PROJECT_S_SYNTHETIC_UNUSED_',
  logLevel: 'warn',
  build: { outDir },
  preview: { host: '127.0.0.1', port: 4195, strictPort: true },
});

let completed = 0;
try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      for (const scenario of scenarios) {
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1_280, height: 900 } });
        const blocked = [];
        const unsafeApiAttempts = [];
        const sockets = [];
        try {
          await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const staticGet = request.method() === 'GET' && url.origin === origin && (
              (request.isNavigationRequest() && url.pathname === '/booking/confirm') ||
              url.pathname.startsWith('/assets/') ||
              url.pathname === '/favicon.ico'
            );
            if (staticGet) await route.continue();
            else {
              blocked.push(url.origin);
              if (url.pathname.startsWith('/api/') || request.resourceType() === 'fetch' || request.resourceType() === 'xhr') {
                unsafeApiAttempts.push(`${request.method()} ${url.origin}${url.pathname}`);
              }
              await route.abort('blockedbyclient');
            }
          });
          await context.routeWebSocket('**/*', (socket) => {
            sockets.push('blocked');
            socket.close({ code: 1008, reason: 'Synthetic browser proof blocks network sockets.' });
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.addInitScript(installFixture, {
            scenario, maximumBytes: PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES,
            fixture, grant, requestId, privateDiagnostic,
          });
          await page.goto(`${origin}/booking/confirm#preparation=${preparationToken}`);
          await expect(page.getByRole('heading', { name: 'Review a prepared booking', exact: true })).toBeVisible();
          assert.equal(await page.evaluate(() => globalThis.location.hash), '');
          if (scenario === 'oversized-preview' || scenario === 'rate-preview') {
            await expect(page.getByRole('alert')).toContainText(scenario === 'oversized-preview' ? protocolMessage : rateMessage);
            await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Approve booking', exact: true })).toHaveCount(0);
          } else {
            await expect(page.getByText('Agent create is blocked', { exact: true })).toBeVisible();
            await expect(page.getByText('Synthetic Host Café 🧭', { exact: true })).toBeVisible();
            await expect(page.getByText('Synthetic Guest', { exact: true })).toBeVisible();
            await expect(page.getByText('guest@example.com', { exact: true })).toBeVisible();
            await approveByKeyboard(page);
            if (scenario === 'valid') {
              const recorded = page.getByRole('heading', { name: 'Human authority recorded', exact: true });
              await expect(recorded).toBeVisible();
              await expect(recorded).toBeFocused();
              await expect(page.getByText('This page approved the exact preparation. It did not create or reserve a booking.', { exact: true })).toBeVisible();
            } else {
              await expect(page.getByRole('alert')).toContainText(scenario === 'oversized-confirm' ? protocolMessage : rateMessage);
              await expect(page.getByRole('button', { name: 'Approve booking', exact: true })).toBeDisabled();
            }
          }
          if (scenario !== 'valid') {
            await expect(page.getByRole('heading', { name: 'Human authority recorded', exact: true })).toHaveCount(0);
          }
          assert.equal((await page.locator('body').innerText()).includes(privateDiagnostic), false);
          const result = await page.evaluate(() => globalThis.__projectSSupportLimits.snapshot());
          assert.deepEqual(result.calls.map((call) => call.operation), scenario.endsWith('preview') ? ['preview'] : ['preview', 'confirm']);
          for (const call of result.calls) {
            assert.equal(call.method, 'POST');
            assert.deepEqual(call.body, call.operation === 'preview'
              ? { preparationToken }
              : { preparationToken, challengeToken: 'project-s-local-confirmation' });
          }
          for (const stream of result.streams) {
            assert.equal(stream.textCalls, 0);
            assert.equal(stream.jsonCalls, 0);
            assert.equal(stream.releases, 1);
            assert.equal(stream.locked, false);
            if (scenario === `oversized-${stream.operation}`) {
              assert.ok(stream.deliveredBytes > PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES);
              assert.ok(stream.deliveredBytes <= PROJECT_S_PUBLIC_RESPONSE_MAX_BYTES + 512);
              assert.ok(stream.deliveredBytes < stream.totalBytes);
              assert.equal(stream.cancellations, 1);
              assert.equal(stream.readerCancellations, 1);
            } else {
              assert.equal(stream.deliveredBytes, stream.totalBytes);
              assert.equal(stream.cancellations, 0);
            }
          }
          assert.deepEqual(errors, [], `${name}/${scenario}: production browser errors`);
          assert.deepEqual(unsafeApiAttempts, [], `${name}/${scenario}: unexpected network API request`);
          assert.deepEqual(sockets, [], `${name}/${scenario}: unexpected network socket`);
          completed += 1;
          console.log(`${name}/${scenario}: PASS; synthetic support streams, keyboard gates, safe outcomes; ${blocked.length} non-static requests blocked.`);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  console.log(`${completed}/${scenarios.length * 3} browser support scenarios passed. No API, Auth, challenge or booking service was contacted.`);
} finally {
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
