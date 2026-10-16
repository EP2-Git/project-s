import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { projectSProblemSchema } from '@project-s/contracts';
import { expectedRefusal, fixture } from './fixture.mjs';

export function localApiBaseUrl(value = 'http://127.0.0.1:8080') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Examples require a loopback HTTP app origin without credentials.');
  }
  return url.origin;
}

export class ExampleProblem extends Error {
  constructor(problem) {
    super('The local API returned a public problem.');
    this.problem = projectSProblemSchema.parse(problem);
  }
}

// The same public-client methods work through raw HTTP, SDK and local MCP.
// The server selects times and enforces authority; this client does neither.
export async function runPreparationExample(transport, {
  now = new Date(), idempotencyKey = randomUUID(), log = console.log,
} = {}) {
  const page = (await transport.getBookingPage({ username: fixture.username })).data;
  assert.equal(page.username, fixture.username);
  const meetingType = page.meetingTypes[0];
  assert.ok(meetingType, 'The seeded host needs a public meeting type.');
  let search;
  let slot;
  for (let offset = 1; offset <= fixture.lookAheadDays && !slot; offset++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + offset);
    search = {
      username: fixture.username, meetingTypeId: meetingType.meetingTypeId,
      date: date.toISOString().slice(0, 10), displayTimeZone: fixture.timeZone,
    };
    slot = (await transport.listFreeSlots(search)).data.slots[0];
  }
  assert.ok(slot, 'No seeded availability found in the next 14 UTC dates.');
  log('Discovered the synthetic host and a server-listed slot.');

  const prepared = (await transport.prepareBooking({
    username: fixture.username, meetingTypeId: meetingType.meetingTypeId,
    startAt: slot.startAt, guestTimeZone: fixture.timeZone, booker: fixture.booker,
  })).data;
  assert.equal(prepared.notHeld, true);
  const after = (await transport.listFreeSlots(search)).data.slots;
  assert.ok(after.some((candidate) => candidate.startAt === slot.startAt && candidate.endAt === slot.endAt),
    'The selected slot is no longer listed; this run cannot demonstrate no hold.');
  log('Prepare returned notHeld=true; the selected slot remains listed.');

  let refusal;
  try {
    await transport.createBooking({ preparationToken: prepared.preparationToken, idempotencyKey });
  } catch (error) {
    refusal = projectSProblemSchema.parse(error?.problem);
  }
  assert.ok(refusal, 'Unexpected create success without browser authority.');
  assert.equal(refusal.code, expectedRefusal.code);
  assert.equal(refusal.status, expectedRefusal.status);
  assert.equal(refusal.retry?.action, expectedRefusal.retryAction);
  log('Create refused: CONFIRMATION_REQUIRED (428), retry=confirm_in_browser.');
  log('Stopped before browser approval; this example did not commit a booking.');
  return { notHeld: prepared.notHeld, refusal: refusal.code };
}

export async function runCli(moduleUrl, createTransport) {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(process.argv[1]).href) return;
  let transport;
  try {
    transport = await createTransport(localApiBaseUrl(process.env.PROJECT_S_API_BASE_URL));
    await runPreparationExample(transport);
  } catch {
    // Never dump guest fields, opaque preparation tokens, upstream bodies or URLs.
    console.error('Local example failed. Check the seeded stack, app origin and examples/README.md. Details are withheld.');
    process.exitCode = 1;
  } finally {
    try { await transport?.close?.(); }
    catch { console.error('Local MCP example cleanup failed.'); process.exitCode = 1; }
  }
}
