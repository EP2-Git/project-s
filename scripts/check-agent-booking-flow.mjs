import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createServer as createViteServer } from 'vite';

const protocolVersion = '2026-07-28';
let localProxy;
const startLocalProxy = async () => {
  const server = await createViteServer({
    configFile: 'vite.config.ts',
    logLevel: 'silent',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

if (!process.env.PROJECT_S_API_BASE_URL) localProxy = await startLocalProxy();
const apiBaseUrl = (
  process.env.PROJECT_S_API_BASE_URL ?? localProxy.baseUrl
).replace(/\/$/, '');
const syntheticName = `Agent flow ${randomUUID().slice(0, 8)}`;
const syntheticEmail = `agent-flow-${randomUUID()}@example.invalid`;

const child = spawn(process.execPath, ['packages/mcp-server/src/bin.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PROJECT_S_API_BASE_URL: apiBaseUrl },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

const pending = new Map();
let nextId = 1;
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timeout);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});

const metadata = () => ({
  'io.modelcontextprotocol/protocolVersion': protocolVersion,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': {
    name: 'project-s-agent-flow-check',
    version: '0.1.0-prealpha',
  },
});

const request = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for MCP ${method}`));
    }, 20_000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: { ...params, _meta: metadata() },
      })}\n`,
    );
  });

const callTool = async (name, args) => {
  const result = await request('tools/call', { name, arguments: args });
  assert.equal(result.resultType, 'complete');
  return result;
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
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const finish = async () => {
  child.stdin.end();
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(exitCode, 0, `MCP subprocess failed: ${stderr}`);
  assert.doesNotMatch(stderr, new RegExp(syntheticName, 'i'));
  assert.doesNotMatch(stderr, new RegExp(syntheticEmail, 'i'));
  if (localProxy) await localProxy.server.close();
};

try {
  const discovery = await request('server/discover');
  assert.deepEqual(discovery.supportedVersions, [protocolVersion]);

  const listed = await request('tools/list');
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      'project_s_get_booking_page_v1',
      'project_s_list_free_slots_v1',
      'project_s_prepare_booking_v1',
      'project_s_create_booking_v1',
    ],
  );

  const pageResult = await callTool('project_s_get_booking_page_v1', {
    username: 'demo-host',
  });
  assert.equal(pageResult.isError, false);
  const page = pageResult.structuredContent.data;
  const meetingType = page.meetingTypes[0];
  assert.ok(meetingType);

  const today = dateKeyIn('America/Halifax');
  let selectedSlot;
  let selectedDate;
  for (let offset = 1; offset <= 14 && !selectedSlot; offset += 1) {
    const date = addDays(today, offset);
    const slotsResult = await callTool('project_s_list_free_slots_v1', {
      username: page.username,
      meetingTypeId: meetingType.meetingTypeId,
      date,
      displayTimeZone: 'America/Halifax',
    });
    assert.equal(slotsResult.isError, false);
    const slots = slotsResult.structuredContent.data.slots;
    if (slots.length > 0) {
      selectedDate = date;
      selectedSlot = slots.at(-1);
    }
  }
  assert.ok(selectedSlot, 'Seeded host did not expose an available slot.');

  const preparedResult = await callTool('project_s_prepare_booking_v1', {
    username: page.username,
    meetingTypeId: meetingType.meetingTypeId,
    startAt: selectedSlot.startAt,
    guestTimeZone: 'America/Halifax',
    booker: {
      name: syntheticName,
      email: syntheticEmail,
      notes: 'Synthetic agent-native parity check.',
    },
  });
  assert.equal(preparedResult.isError, false);
  const prepared = preparedResult.structuredContent.data;
  assert.equal(prepared.notHeld, true);
  assert.match(prepared.confirmationUrl, /\/booking\/confirm#preparation=/);

  const idempotencyKey = randomUUID();
  const beforeConfirmation = await callTool('project_s_create_booking_v1', {
    preparationToken: prepared.preparationToken,
    idempotencyKey,
  });
  assert.equal(beforeConfirmation.isError, true);
  assert.equal(
    beforeConfirmation.structuredContent.error.code,
    'CONFIRMATION_REQUIRED',
  );

  const confirmationResponse = await fetch(
    `${apiBaseUrl}/api/v1/public/booking-preparations/confirm`,
    {
      method: 'POST',
      headers: {
        accept: 'application/vnd.project-s.v1+json',
        'content-type': 'application/vnd.project-s.v1+json',
        origin: 'http://127.0.0.1:8080',
        'x-project-s-source': 'project_s_ui',
        'x-project-s-client': 'project-s-web',
        'x-project-s-client-version': '0.1.0-prealpha',
      },
      body: JSON.stringify({
        preparationToken: prepared.preparationToken,
        challengeToken: 'project-s-local-confirmation',
      }),
    },
  );
  assert.equal(confirmationResponse.status, 200);
  const confirmation = await confirmationResponse.json();
  assert.equal(confirmation.data.preparationId, prepared.preparationId);

  const createdResult = await callTool('project_s_create_booking_v1', {
    preparationToken: prepared.preparationToken,
    idempotencyKey,
  });
  assert.equal(createdResult.isError, false);
  assert.equal(createdResult.structuredContent.data.status, 'confirmed');

  const replayResult = await callTool('project_s_create_booking_v1', {
    preparationToken: prepared.preparationToken,
    idempotencyKey,
  });
  assert.equal(replayResult.isError, false);
  assert.equal(
    replayResult.structuredContent.data.confirmationCode,
    createdResult.structuredContent.data.confirmationCode,
  );

  await finish();
  console.log(
    `Agent-native parity flow passed for ${selectedDate}: four tools, required confirmation, atomic create, and exact replay.`,
  );
} catch (error) {
  child.kill();
  void localProxy?.server.close();
  throw error;
}
