#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createProjectSClient, ProjectSApiError } from '@project-s/sdk';
import { prepareLocalDemoStack, assertLocalDemoStack } from './lib/local-demo-stack.mjs';
import { buildLocalDemoCleanup, localDemoIdentity } from './lib/local-demo-cleanup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runnerStarted = performance.now();
const args = process.argv.slice(2);
const headed = args.includes('--headed');
const serve = args.includes('--serve');
let stage = 'arguments';
let browser;
let server;
let manifestPath;
let retryAfterSeconds;
const verdicts = [];
let blockedExternalRequests = 0;
const check = (value) => assert.ok(value, 'Local demo assertion failed.');
const mark = (message) => { stage = message; console.log(message); };

function artifactDirectory(path) {
  const child = relative(root, path);
  check(child && child !== '..' && !child.startsWith(`..${sep}`));
  let current = root;
  for (const part of child.split(sep)) {
    current = resolve(current, part);
    if (existsSync(current)) {
      check(!lstatSync(current).isSymbolicLink()
        && realpathSync(current).toLowerCase() === current.toLowerCase());
    }
  }
  mkdirSync(path, { recursive: true });
}

async function localContext(options = {}) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1'
      && ['4173', '54321'].includes(url.port)) return route.continue();
    blockedExternalRequests += 1;
    return route.abort('blockedbyclient');
  });
  return context;
}

function sql(context, query, { refusal = false } = {}) {
  const identity = spawnSync('docker', ['inspect', '--format', '{{.Id}}', context.containerName],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  check(!identity.error && identity.status === 0 && identity.stdout.trim() === context.dbId);
  const result = spawnSync('docker', ['exec', '-i', context.containerName, 'psql', '-X', '-q', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], {
    input: query, encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  if (refusal) {
    check(!result.error && result.status !== 0);
    return result.stderr.match(/LOCAL_DEMO_[A-Z_]+/)?.[0] ?? 'UNEXPECTED_DATABASE_REFUSAL';
  }
  check(!result.error && result.status === 0);
  return result.stdout.trim();
}

function baseline(context) {
  const tables = ['profiles', 'meeting_types', 'availabilities', 'specific_date_availabilities', 'bookings'];
  const publicRows = tables.map((name) => `'${name}',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from public.${name} t)`);
  const bytes = sql(context, `select jsonb_build_object(${publicRows.join(',')},
    'auth_users',(select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from auth.users));`);
  return createHash('sha256').update(bytes).digest('hex');
}

async function signedInIdentity(page) {
  return page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabaseClient.ts');
    const result = await supabase.auth.getUser();
    if (result.error || !result.data.user) return null;
    return { id: result.data.user.id, email: result.data.user.email };
  });
}

async function deletedSession(page) {
  return page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabaseClient.ts');
    const result = await supabase.auth.getUser();
    return { userAbsent: !result.data.user, status: result.error?.status ?? null, code: result.error?.code ?? null };
  });
}

function auditSnapshot(context, preparationId) {
  const text = sql(context, `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb)
    from private.booking_audit_events a where preparation_id='${preparationId}'::uuid;`);
  return { count: JSON.parse(text).length, digest: createHash('sha256').update(text).digest('hex') };
}

async function saveHours(page) {
  const response = page.waitForResponse((r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname.endsWith('/rpc/set_weekly_schedule_v1'));
  await page.getByRole('button', { name: 'Save Weekly Availability', exact: true }).click();
  check((await response).ok());
}

async function chooseTime(page) {
  const calendar = page.locator('section[aria-labelledby="select-date-title"]');
  const date = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Halifax', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const today = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() + ((1 - today.getUTCDay() + 7) % 7 || 7));
  const slots = page.locator('button[aria-label^="Select "]');
  await slots.first().or(page.getByText('No available time slots for this date.')).waitFor();
  if (monday.getUTCMonth() !== today.getUTCMonth()) {
    await calendar.getByRole('button', { name: /go to next month/i }).click();
  }
  const searched = page.waitForResponse((r) => r.request().method() === 'POST'
    && new URL(r.url()).pathname.endsWith('/public/free-slots/search')
    && r.request().postDataJSON().date === monday.toISOString().slice(0, 10));
  await calendar.locator('button[name="day"]:not([disabled]):not(.day-outside)')
    .filter({ hasText: new RegExp(`^${monday.getUTCDate()}$`) }).click();
  check((await searched).ok());
  await slots.first().waitFor();
  await slots.first().focus();
  await page.keyboard.press('Enter');
}

function replayClient(replay) {
  return createProjectSClient({ baseUrl: 'http://127.0.0.1:4173', headers: replay.headers });
}

async function deniedReplay(replay) {
  try { await replayClient(replay).public.createBooking(replay.input); }
  catch (error) {
    check(error instanceof ProjectSApiError);
    if (error.problem.code === 'RATE_LIMITED') throw error;
    check(['NOT_FOUND', 'PREPARATION_STALE', 'PREPARATION_MISMATCH', 'PREPARATION_EXPIRED'].includes(error.problem.code));
    return error.problem.code;
  }
  throw new Error('A deleted preparation unexpectedly created a booking.');
}

async function runCycle({ context, identity, runId, cycle, password, previousId, previousReplay, client, artifactRoot }) {
  const cycleStarted = performance.now();
  await assertLocalDemoStack({ root });
  const startedAt = new Date(sql(context, 'select clock_timestamp();')).toISOString();
  const hostContext = await localContext({ timezoneId: 'America/Halifax', viewport: { width: 1280, height: 900 } });
  const guestContext = await localContext({ timezoneId: 'America/Halifax', viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  host.setDefaultTimeout(20_000); guest.setDefaultTimeout(20_000);
  let manifest;
  let replay;
  try {
    mark(`Cycle ${cycle}: create an account through signup`);
    await host.goto('http://127.0.0.1:4173/signup');
    await host.getByLabel('Full Name', { exact: true }).fill(identity.hostName);
    await host.getByLabel('Email', { exact: true }).fill(identity.email);
    await host.getByLabel('Username', { exact: true }).fill(identity.username);
    await host.getByLabel('Password', { exact: true }).fill(password);
    await host.getByRole('button', { name: 'Create Account', exact: true }).click();
    await host.waitForURL('**/dashboard');
    const principal = await signedInIdentity(host);
    check(principal?.email === identity.email && principal.id !== previousId
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(principal.id));
    manifest = { runId, userId: principal.id, startedAt };
    writeFileSync(manifestPath, JSON.stringify({ stage, cycle, ...manifest }), { mode: 0o600 });

    mark(`Cycle ${cycle}: save profile, meeting type and availability`);
    const setup = host.getByRole('region', { name: 'Booking setup', exact: true });
    await setup.getByRole('link', { name: 'Profile and timezone', exact: true }).click();
    await host.getByLabel('Times shown in', { exact: true }).selectOption('America/Halifax');
    await host.getByLabel('Full Name', { exact: true }).fill(`${identity.hostName} Ready`);
    await host.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await host.getByText('Profile updated successfully', { exact: true }).waitFor();
    await host.goto('http://127.0.0.1:4173/dashboard');
    await setup.getByRole('button', { name: 'Meeting types', exact: true }).click();
    await host.getByRole('button', { name: 'Create a Meeting Type', exact: true }).click();
    await host.getByLabel('Title *', { exact: true }).fill('Local demo conversation');
    await host.getByLabel('Duration (minutes) *', { exact: true }).fill('30');
    await host.getByRole('button', { name: 'Create Meeting Type', exact: true }).click();
    await host.getByRole('heading', { name: 'Local demo conversation', exact: true }).waitFor();
    await host.getByRole('button', { name: 'Overview', exact: true }).click();
    await setup.getByRole('button', { name: 'Availability', exact: true }).click();
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await host.getByRole('switch', { name: `Set ${day} availability`, exact: true }).uncheck();
    }
    await host.getByRole('switch', { name: 'Set Monday availability', exact: true }).check();
    await saveHours(host);
    await host.getByRole('button', { name: 'Overview', exact: true }).click();
    await setup.getByRole('heading', { name: 'Your setup is saved', exact: true }).waitFor();
    await host.screenshot({ path: resolve(artifactRoot, `cycle-${cycle}-setup.png`), fullPage: true });
    const oldReplayRefusal = previousReplay ? await deniedReplay(previousReplay) : null;

    mark(`Cycle ${cycle}: book in a separate guest browser and confirm normally`);
    await guest.goto(`http://127.0.0.1:4173/book/${identity.username}`);
    await guest.getByRole('heading', { name: `Book time with ${identity.hostName} Ready` }).waitFor();
    await chooseTime(guest);
    await guest.getByLabel('Your name', { exact: true }).fill(identity.guestName);
    await guest.getByLabel('Your email', { exact: true }).fill(identity.guestEmail);
    await guest.getByRole('checkbox', { name: /accept terms and privacy notice/i }).check();
    await guest.getByRole('button', { name: 'Review booking', exact: true }).click();
    await guest.getByRole('heading', { name: 'Confirm these booking details', exact: true }).waitFor();
    check(await guest.getByRole('button', { name: 'Confirm and book', exact: true }).isDisabled());
    await guest.getByRole('checkbox', { name: /confirming this local development booking/i }).check();
    const created = guest.waitForResponse((r) => r.request().method() === 'POST'
      && new URL(r.url()).pathname === '/api/v1/public/bookings');
    await guest.getByRole('button', { name: 'Confirm and book', exact: true }).click();
    const response = await created;
    if (response.status() === 429) {
      const value = Number(response.headers()['retry-after']);
      if (Number.isSafeInteger(value) && value > 0 && value <= 86_400) retryAfterSeconds = value;
    }
    check(response.ok());
    const headers = Object.fromEntries(Object.entries(await response.request().allHeaders()).filter(([name]) => (
      ['apikey', 'authorization', 'user-agent', 'origin', 'referer'].includes(name) || name.startsWith('x-project-s-')
    )));
    check(headers.apikey === context.anonKey && headers.authorization === `Bearer ${context.anonKey}`);
    replay = { input: response.request().postDataJSON(), headers };
    const originalResult = await response.json();
    const exactReplay = await replayClient(replay).public.createBooking(replay.input);
    check(exactReplay.data.confirmationCode === originalResult.data.confirmationCode);
    const bookingElapsedMs = Math.round(performance.now() - cycleStarted);
    const runnerToBookingMs = Math.round(performance.now() - runnerStarted);
    await guest.getByRole('heading', { name: 'Booking confirmed', exact: true }).waitFor();
    check(await guest.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    await guest.screenshot({ path: resolve(artifactRoot, `cycle-${cycle}-booking.png`), fullPage: true });
    await guestContext.close();
    const rows = JSON.parse(sql(context, `select jsonb_agg(jsonb_build_object('id',id,'type',meeting_type_id,'preparation',preparation_id))
      from public.bookings where user_id='${principal.id}'::uuid;`));
    check(rows?.length === 1);
    manifest = { ...manifest, meetingTypeId: rows[0].type, bookingId: rows[0].id };
    writeFileSync(manifestPath, JSON.stringify({ stage, cycle, ...manifest }), { mode: 0o600 });
    const cleanup = buildLocalDemoCleanup(manifest);
    const preparationId = rows[0].preparation;
    check(/^[0-9a-f-]{36}$/.test(preparationId));
    check(sql(context, cleanup, { refusal: true }) === 'LOCAL_DEMO_UNEXPECTED_RECORDS');

    mark(`Cycle ${cycle}: the host cancels the saved booking`);
    await host.reload();
    await host.getByRole('button', { name: 'Bookings', exact: true }).click();
    const booking = host.getByRole('row').filter({ hasText: identity.guestName });
    await booking.waitFor();
    await booking.getByRole('button', { name: `Cancel booking with ${identity.guestName}` }).click();
    await host.getByRole('alertdialog').getByRole('button', { name: 'Cancel booking', exact: true }).click();
    await booking.filter({ hasText: 'cancelled' }).waitFor();
    await host.screenshot({ path: resolve(artifactRoot, `cycle-${cycle}-cancelled.png`), fullPage: true });
    const wrong = buildLocalDemoCleanup({ ...manifest, userId: randomUUID() });
    check(sql(context, wrong, { refusal: true }) === 'LOCAL_DEMO_IDENTITY_MISMATCH');
    const probe = `local_demo_probe_${runId.replaceAll('-', '').slice(0, 12)}`;
    sql(context, `begin; create table private.${probe} (booking_id uuid references public.bookings(id) on delete cascade);
      insert into private.${probe} values ('${manifest.bookingId}'::uuid); commit;`);
    try { check(sql(context, cleanup, { refusal: true }) === 'LOCAL_DEMO_EXTERNAL_STATE'); }
    finally { sql(context, `drop table private.${probe};`); }

    mark(`Cycle ${cycle}: delete only this demo account and its owned records`);
    await host.waitForLoadState('networkidle');
    const auditBefore = auditSnapshot(context, preparationId);
    await hostContext.setOffline(true);
    await assertLocalDemoStack({ root });
    const deletion = JSON.parse(sql(context, cleanup));
    check(deletion.accountDeleted && deletion.bookingsDeleted === 1 && deletion.auditEventsRetained >= 3);
    const auditAfter = auditSnapshot(context, preparationId);
    check(auditAfter.digest === auditBefore.digest && auditAfter.count === deletion.auditEventsRetained);
    await hostContext.setOffline(false);
    const denied = await deletedSession(host);
    check(denied.userAbsent && [401, 403].includes(denied.status)
      && ['user_not_found', 'session_not_found', 'bad_jwt', 'session_expired'].includes(denied.code));
    try { await client.public.getBookingPage({ username: identity.username }); check(false); }
    catch (error) { check(error instanceof ProjectSApiError && error.problem.code === 'NOT_FOUND'); }
    const missingContext = await localContext();
    try {
      const missingPage = await missingContext.newPage();
      const lookup = missingPage.waitForResponse((r) => new URL(r.url()).pathname === `/api/v1/public/booking-pages/${identity.username}`);
      await missingPage.goto(`http://127.0.0.1:4173/book/${identity.username}`);
      check((await lookup).status() === 404);
      await missingPage.getByRole('alert').waitFor();
      await missingPage.screenshot({ path: resolve(artifactRoot, `cycle-${cycle}-deleted.png`), fullPage: true });
    } finally { await missingContext.close(); }
    verdicts.push({ cycle, signup: true, setupSaved: true, guestBooking: true, hostCancellation: true,
      cleanupRefusedBeforeCancellation: true, wrongManifestRefused: true, externalReferenceRefused: true,
      accountDeleted: true, oldSessionDenied: true, authDenialStatus: denied.status,
      auditDigestPreserved: true, publicPageNotFound: true,
      recreatedWithNewAuthId: cycle === 2, exactReplayBeforeDeletion: true,
      oldPreparationDenied: Boolean(previousReplay), oldReplayRefusal,
      signupToBookingMs: bookingElapsedMs, runnerToBookingMs,
      cycleElapsedMs: Math.round(performance.now() - cycleStarted), ...deletion });
    return { userId: principal.id, replay };
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
}

async function main() {
  check(process.cwd() === root && args.every((arg) => ['--headed', '--serve', '--setup'].includes(arg)));
  mark('Verify or prepare the separately owned local demo stack');
  const context = await prepareLocalDemoStack({ root });
  if (args.includes('--setup')) return;
  if (!serve) {
    mark('Check the existing rate-limit budget before creating an account');
    const budget = Number(sql(context, `select coalesce(ceil(extract(epoch from max(b.expires_at)-clock_timestamp())),0)::integer
      from private.public_rate_limit_buckets b join private.public_rate_limit_policies p using(operation_id)
      where b.expires_at>clock_timestamp() and ((p.operation_id='project-s.public.create_booking.v1' and b.request_count>p.request_limit-5)
      or (p.operation_id='project-s.public.prepare_booking.v1' and b.request_count>p.request_limit-2));`));
    check(Number.isSafeInteger(budget));
    if (budget > 0) { retryAfterSeconds = budget; throw new Error('Local demo rate window is still active.'); }
  }
  process.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE = 'self-hosted';
  server = await createServer({ root, mode: 'development', server: { host: '127.0.0.1', port: serve ? 8080 : 4173, strictPort: true } });
  await server.listen();
  if (serve) {
    console.log('Local Slotly app: http://127.0.0.1:8080 — stop with Ctrl+C. This is not a hosted Cloud service.');
    await new Promise((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
    return;
  }
  const runId = randomUUID();
  const identity = localDemoIdentity(runId);
  const artifactRoot = resolve(root, 'output/playwright', `local-demo-${runId}`);
  artifactDirectory(artifactRoot);
  manifestPath = resolve(root, '.cache', `local-demo-run-${runId}.json`);
  const before = baseline(context);
  const client = createProjectSClient({ baseUrl: 'http://127.0.0.1:4173', headers: {
    apikey: context.anonKey, authorization: `Bearer ${context.anonKey}`,
    'x-project-s-client': 'project-s-local-demo', 'x-project-s-client-version': '0.1.0-prealpha',
    'x-project-s-source': 'project_s_ui',
  } });
  browser = await chromium.launch({ headless: !headed, ...(headed ? { slowMo: 120 } : {}) });
  let previous;
  for (const cycle of [1, 2]) {
    previous = await runCycle({ context, identity, runId, cycle, previousId: previous?.userId,
      previousReplay: previous?.replay, password: `Local-${randomUUID()}-Aa1!`, client, artifactRoot });
    check(baseline(context) === before);
  }
  check(Number(sql(context, `select count(*) from auth.users where email='${identity.email}';`)) === 0);
  const report = { version: 1, backend: 'actual local Auth/API/PostgreSQL', identities: 'disposable demo identities',
    cycles: verdicts, sameIdentityReused: true, unrelatedBaselineUnchanged: true,
    auditRetained: true, publicSelfServiceDeletion: false, blockedExternalRequests,
    timingScope: 'Automated runner elapsed time; excludes prerequisite installation and Docker repair.',
    completedAt: new Date().toISOString() };
  writeFileSync(resolve(artifactRoot, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(manifestPath, JSON.stringify({ runId, completed: true, cycles: 2 }));
  console.log(`PASS: two signup/setup/booking/cancellation/account-deletion cycles; unrelated records preserved. Report: ${artifactRoot}`);
}

try { await main(); }
catch (error) {
  const retry = error instanceof ProjectSApiError && error.problem.code === 'RATE_LIMITED'
    ? error.problem.retry?.afterSeconds : retryAfterSeconds;
  if (Number.isSafeInteger(retry) && retry > 0 && retry <= 86_400) {
    console.error(`Existing rate limits remain active. Retry after ${retry} seconds; no rate-limit records were cleared.`);
  }
  console.error(`Local demo stopped at: ${stage}. Demo data is preserved for diagnosis; no automatic reset or broad cleanup was performed.`);
  const locations = error instanceof Error ? error.stack?.split('\n').filter((line) => /local-demo\.mjs:\d+:\d+/.test(line)).slice(0, 3) : [];
  for (const location of locations ?? []) console.error(`Failure location: ${location.trim()}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}
