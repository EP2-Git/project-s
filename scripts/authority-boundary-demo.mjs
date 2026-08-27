#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import { createServer as createViteServer } from 'vite';
import {
  createProjectSMcpClient,
  PROJECT_S_MCP_PROTOCOL_VERSION,
  PROJECT_S_MCP_TOOL_NAMES,
} from './lib/project-s-mcp-client.mjs';

const FIXTURE = Object.freeze({
  username: 'demo-host',
  hostId: '10000000-0000-4000-8000-000000000001',
  hostEmail: 'demo@project-s.local',
  hostPassword: 'project-s-demo-password',
  hostTimeZone: 'America/Halifax',
  meetingTypeId: '20000000-0000-4000-8000-000000000001',
  guest: Object.freeze({
    name: 'Casey Example',
    email: 'casey.example@example.invalid',
    notes: 'Fictional local Authority Boundary Demo booking.',
  }),
});

class DemoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoError';
  }
}

const stage = (number, title) => console.log(`\n[${number}/8] ${title}`);
const outcome = (message) => console.log(`  OK  ${message}`);

const requireCondition = (condition, message) => {
  if (!condition) throw new DemoError(message);
};

const loopbackUrl = (rawValue, label) => {
  let url;
  try {
    url = new URL(rawValue);
  } catch {
    throw new DemoError(`${label} must be a valid absolute URL.`);
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  requireCondition(
    (url.protocol === 'http:' || url.protocol === 'https:') &&
      loopbackHosts.has(url.hostname),
    `${label} must use a loopback HTTP(S) URL for this local-only demo.`,
  );
  requireCondition(
    url.username === '' && url.password === '',
    `${label} must not contain credentials.`,
  );
  requireCondition(
    url.search === '' && url.hash === '',
    `${label} must not contain a query string or fragment.`,
  );
  return url.toString().replace(/\/$/, '');
};

const parseEnvFile = (text) => {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(
      rawLine,
    );
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
};

const loadLocalSupabaseConfig = async () => {
  let fileValues = {};
  try {
    fileValues = parseEnvFile(await readFile('.env.local', 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new DemoError('Could not read the local Supabase configuration.');
    }
  }

  const rawUrl =
    process.env.VITE_SUPABASE_URL || fileValues.VITE_SUPABASE_URL;
  const publishableKey =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    fileValues.VITE_SUPABASE_PUBLISHABLE_KEY;

  requireCondition(
    typeof rawUrl === 'string' && rawUrl.length > 0,
    'Missing VITE_SUPABASE_URL. Run `npm run db:start && npm run db:env` first.',
  );
  requireCondition(
    typeof publishableKey === 'string' && publishableKey.length > 0,
    'Missing VITE_SUPABASE_PUBLISHABLE_KEY. Run `npm run db:start && npm run db:env` first.',
  );

  return {
    url: loopbackUrl(rawUrl, 'VITE_SUPABASE_URL'),
    publishableKey,
  };
};

const checkHealth = async (apiBaseUrl) => {
  let response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new DemoError(
      'The local Project S app is not reachable. In another terminal run `npm run dev`, then retry.',
    );
  }
  requireCondition(
    response.ok,
    'The local Project S health check failed. Confirm the local database and app are running.',
  );

  let body;
  try {
    body = await response.json();
  } catch {
    throw new DemoError('The local Project S health response was not valid JSON.');
  }
  requireCondition(
    body?.status === 'ok' && body?.contractVersion === 1,
    'The local Project S health response did not match contract version 1.',
  );
};

const startOrReuseLocalApp = async (apiBaseUrl) => {
  try {
    await checkHealth(apiBaseUrl);
    return undefined;
  } catch (healthError) {
    const apiUrl = new URL(apiBaseUrl);
    const supportedOrigin =
      apiUrl.protocol === 'http:' &&
      (apiUrl.hostname === '127.0.0.1' || apiUrl.hostname === 'localhost') &&
      apiUrl.port === '8080' &&
      apiUrl.pathname === '/';
    if (!supportedOrigin) throw healthError;

    let server;
    try {
      server = await createViteServer({
        configFile: 'vite.config.ts',
        logLevel: 'silent',
        server: {
          host: '127.0.0.1',
          port: 8080,
          strictPort: true,
        },
      });
      await server.listen();
      await checkHealth(apiBaseUrl);
      return server;
    } catch {
      await server?.close().catch(() => {});
      throw new DemoError(
        'Could not start the temporary local app. Confirm the local database is running with `npm run db:start`.',
      );
    }
  }
};

const addDays = (dateKey, days) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

const dateKeyIn = (timeZone) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const displayInstant = (instant, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(instant));

const problemCode = (result) => {
  const code = result?.structuredContent?.error?.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
    ? code
    : 'UNKNOWN_ERROR';
};

const successfulData = (result, action) => {
  requireCondition(
    result?.resultType === 'complete',
    `${action} returned an incomplete MCP response.`,
  );
  if (result.isError !== false) {
    throw new DemoError(`${action} failed (${problemCode(result)}).`);
  }
  requireCondition(
    result.structuredContent?.data,
    `${action} returned no contract data.`,
  );
  return result.structuredContent.data;
};

const verifiedConfirmationUrl = (prepared) => {
  let url;
  try {
    url = new URL(prepared.confirmationUrl);
  } catch {
    throw new DemoError('Prepare returned an invalid browser confirmation URL.');
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const fragment = new URLSearchParams(url.hash.slice(1));
  requireCondition(
    (url.protocol === 'http:' || url.protocol === 'https:') &&
      loopbackHosts.has(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/booking/confirm' &&
      url.search === '' &&
      fragment.size === 1 &&
      fragment.get('preparation') === prepared.preparationToken,
    'Prepare did not return the expected local fragment-only confirmation URL.',
  );
  return url.toString();
};

const openDefaultBrowser = async (url) => {
  const command =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args =
    process.platform === 'win32'
      ? ['url.dll,FileProtocolHandler', url]
      : [url];

  await new Promise((resolve, reject) => {
    const opener = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    opener.once('error', () =>
      reject(
        new DemoError(
          'Could not open the default browser. Run this demo from a local desktop session.',
        ),
      ),
    );
    opener.once('spawn', () => {
      opener.unref();
      resolve();
    });
  });
};

const cancelAsSeededHost = async ({
  confirmationCode,
  idempotencyKey,
  localSupabase,
}) => {
  const supabase = createClient(
    localSupabase.url,
    localSupabase.publishableKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );

  try {
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: FIXTURE.hostEmail,
        password: FIXTURE.hostPassword,
      });
    requireCondition(
      !authError && authData.user?.id === FIXTURE.hostId,
      'Could not authenticate the fictional seeded host against local Supabase.',
    );

    const {
      count: bookingCount,
      data: booking,
      error: bookingError,
    } = await supabase
      .from('bookings')
      .select('id,status,version,confirmation_code,idempotency_key', {
        count: 'exact',
      })
      .eq('confirmation_code', confirmationCode)
      .eq('idempotency_key', idempotencyKey)
      .single();
    requireCondition(
      !bookingError &&
        bookingCount === 1 &&
        booking?.status === 'confirmed' &&
        booking.idempotency_key === idempotencyKey &&
        Number.isInteger(booking.version),
      'The authenticated host did not resolve exactly one replay-safe booking through RLS.',
    );

    const { data: cancellation, error: cancellationError } = await supabase.rpc(
      'cancel_booking_v1',
      {
        p_booking_id: booking.id,
        p_expected_version: booking.version,
      },
    );
    requireCondition(
      !cancellationError &&
        cancellation?.bookingId === booking.id &&
        cancellation?.status === 'cancelled' &&
        cancellation?.version === booking.version + 1 &&
        typeof cancellation?.canceledAt === 'string',
      'The authenticated host cancellation RPC did not return the expected versioned result.',
    );
    return { bookingCount, cancellation };
  } finally {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }
};

const run = async () => {
  requireCondition(
    process.stdin.isTTY && process.stdout.isTTY,
    'This guided demo requires an interactive terminal and a person in a browser. For automation, run `npm run test:e2e -- tests/e2e/authority-boundary-demo.spec.ts`.',
  );

  const apiBaseUrl = loopbackUrl(
    process.env.PROJECT_S_DEMO_API_BASE_URL ||
      process.env.PROJECT_S_API_BASE_URL ||
      'http://127.0.0.1:8080',
    'Project S demo API URL',
  );
  const localSupabase = await loadLocalSupabaseConfig();
  let mcp;
  let terminal;
  let ownedAppServer;
  let createdConfirmationCode;
  let createdIdempotencyKey;
  let cancellationComplete = false;
  let runError;
  let closeFailed = false;

  console.log('Project S — Authority Boundary Demo');
  console.log(
    'A real MCP client may discover, inspect, and prepare. A person must approve in the browser before Project S can commit.',
  );
  console.log('All fixture data and credentials are local and fictional.');

  try {
    stage(1, 'Verify the local authority service');
    ownedAppServer = await startOrReuseLocalApp(apiBaseUrl);
    outcome(
      ownedAppServer
        ? 'Started an owned temporary app; local API contract v1 is healthy.'
        : 'Reused the running app; local API contract v1 is healthy.',
    );

    mcp = createProjectSMcpClient({
      baseUrl: apiBaseUrl,
      clientName: 'project-s-authority-boundary-demo',
    });

    stage(2, 'Discover the real MCP surface');
    const discovery = await mcp.discover();
    requireCondition(
      isDeepStrictEqual(discovery.supportedVersions, [
        PROJECT_S_MCP_PROTOCOL_VERSION,
      ]),
      'MCP discovery returned an unexpected protocol version.',
    );
    const toolList = await mcp.listTools();
    const toolNames = toolList.tools?.map((tool) => tool.name);
    requireCondition(
      isDeepStrictEqual(toolNames, PROJECT_S_MCP_TOOL_NAMES),
      'MCP did not expose exactly the four approved Project S v1 tools.',
    );
    outcome(`Discovered ${toolNames.length} approved public tools:`);
    for (const name of toolNames) console.log(`      ${name}`);

    stage(3, 'Read availability through MCP');
    const page = successfulData(
      await mcp.callTool('project_s_get_booking_page_v1', {
        username: FIXTURE.username,
      }),
      'Booking-page discovery',
    );
    requireCondition(
      page.username === FIXTURE.username &&
        page.hostTimeZone === FIXTURE.hostTimeZone,
      'The local demo-host fixture is missing or does not match the seed.',
    );
    const meetingType = page.meetingTypes.find(
      (candidate) => candidate.meetingTypeId === FIXTURE.meetingTypeId,
    );
    requireCondition(
      meetingType,
      'The fictional Intro call meeting type is missing. Run `npm run db:reset`.',
    );

    const today = dateKeyIn(page.hostTimeZone);
    let selectedDate;
    let selectedSlot;
    for (let offset = 1; offset <= 14 && !selectedSlot; offset += 1) {
      const date = addDays(today, offset);
      const available = successfulData(
        await mcp.callTool('project_s_list_free_slots_v1', {
          username: page.username,
          meetingTypeId: meetingType.meetingTypeId,
          date,
          displayTimeZone: page.hostTimeZone,
        }),
        'Availability lookup',
      );
      if (available.slots.length > 0) {
        selectedDate = date;
        selectedSlot = available.slots.at(-1);
      }
    }
    requireCondition(
      selectedSlot,
      'No seeded slot was available in the next 14 days. Run `npm run db:reset` and retry.',
    );
    outcome(
      `Selected a real ${meetingType.title} slot on ${selectedDate}: ${displayInstant(
        selectedSlot.startAt,
        page.hostTimeZone,
      )}.`,
    );

    stage(4, 'Prepare, without holding or booking');
    const prepared = successfulData(
      await mcp.callTool('project_s_prepare_booking_v1', {
        username: page.username,
        meetingTypeId: meetingType.meetingTypeId,
        startAt: selectedSlot.startAt,
        guestTimeZone: FIXTURE.hostTimeZone,
        booker: FIXTURE.guest,
      }),
      'Booking preparation',
    );
    requireCondition(
      prepared.notHeld === true,
      'Prepare did not preserve the required not-held contract.',
    );
    const confirmationUrl = verifiedConfirmationUrl(prepared);
    outcome('Prepared request returned notHeld=true and a fragment-only browser handoff.');
    console.log('      The preparation token and browser URL are intentionally not printed.');

    stage(5, 'Attempt to commit before human confirmation');
    const createArguments = {
      preparationToken: prepared.preparationToken,
      idempotencyKey: randomUUID(),
    };
    const blocked = await mcp.callTool(
      'project_s_create_booking_v1',
      createArguments,
    );
    requireCondition(
      blocked?.resultType === 'complete' &&
        blocked.isError === true &&
        problemCode(blocked) === 'CONFIRMATION_REQUIRED',
      'Critical boundary mismatch: the unconfirmed create request was not refused with CONFIRMATION_REQUIRED.',
    );
    console.log('  BLOCKED  CONFIRMATION_REQUIRED');
    console.log(
      '      The agent has a preparation and idempotency key, but no booking was committed.',
    );

    stage(6, 'Hand authority to a person in the browser');
    await openDefaultBrowser(confirmationUrl);
    outcome('Opened the real Project S review page in the default browser.');
    console.log(
      '      Review the fictional request and choose Approve booking. This script never calls the confirmation endpoint.',
    );
    terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal.question(
      '\n      After the browser says “Human authority recorded”, type APPROVED to retry: ',
    );
    requireCondition(
      answer.trim() === 'APPROVED',
      'No explicit browser approval was asserted; the demo stopped before create.',
    );
    terminal.close();
    terminal = undefined;
    console.log(
      '      Typing here grants nothing; the database will still refuse unless browser approval exists.',
    );

    stage(7, 'Commit under database authority, then replay');
    const created = successfulData(
      await mcp.callTool('project_s_create_booking_v1', createArguments),
      'Confirmed booking create',
    );
    requireCondition(
      created.status === 'confirmed' &&
        created.idempotencyKey === createArguments.idempotencyKey,
      'Create returned an unexpected committed-booking result.',
    );
    createdConfirmationCode = created.confirmationCode;
    createdIdempotencyKey = createArguments.idempotencyKey;
    outcome('The locked authority recheck returned status=confirmed.');

    const replayed = successfulData(
      await mcp.callTool('project_s_create_booking_v1', createArguments),
      'Idempotent create replay',
    );
    requireCondition(
      isDeepStrictEqual(replayed, created),
      'The identical create replay did not return the original booking result.',
    );
    outcome(
      'Identical request replay returned the same result; no duplicate booking was created.',
    );

    stage(8, 'Cancel through authenticated host authority');
    console.log(
      '      Role switch: cancellation is not a fifth MCP tool. The fictional seeded host now authenticates.',
    );
    const { bookingCount, cancellation } = await cancelAsSeededHost({
      confirmationCode: created.confirmationCode,
      idempotencyKey: createArguments.idempotencyKey,
      localSupabase,
    });
    cancellationComplete = true;
    outcome(`Authenticated host RLS resolved exactly ${bookingCount} booking.`);
    outcome(
      `Host-only cancel_booking_v1 returned status=${cancellation.status}, version=${cancellation.version}.`,
    );

    console.log('\nAuthority Boundary Demo complete.');
    console.log(
      'Agent preparation, human approval, locked deterministic commit, exact replay, and host cancellation all used real Project S contracts.',
    );
  } catch (error) {
    runError = error;
    if (createdConfirmationCode && !cancellationComplete) {
      console.error(
        '\nCleanup: attempting authenticated cancellation of the committed fictional booking.',
      );
      try {
        await cancelAsSeededHost({
          confirmationCode: createdConfirmationCode,
          idempotencyKey: createdIdempotencyKey,
          localSupabase,
        });
        console.error('Cleanup: the fictional booking was cancelled.');
      } catch {
        console.error(
          'Cleanup failed. Sign in as the local demo host and cancel the fictional booking manually.',
        );
      }
    }
    throw error;
  } finally {
    terminal?.close();
    if (mcp) {
      try {
        await mcp.close();
      } catch {
        closeFailed = true;
      }
    }
    if (ownedAppServer) {
      try {
        await ownedAppServer.close();
      } catch {
        closeFailed = true;
      }
    }
  }

  if (closeFailed && !runError) {
    throw new DemoError('The Project S MCP subprocess did not shut down cleanly.');
  }
};

try {
  await run();
} catch (error) {
  const message =
    error instanceof DemoError
      ? error.message
      : 'The demo stopped on an unexpected local error. Review the local service logs and retry.';
  console.error(`\nDemo stopped: ${message}`);
  process.exitCode = 1;
}
