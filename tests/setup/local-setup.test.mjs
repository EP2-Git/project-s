import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { arch, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { acquireBootstrapLock, bootstrapPlan, collectDoctor, configuredPorts, environmentProblems, isLoopbackUrl, npmInvocation, parseEnv, runBootstrap } from '../../scripts/lib/local-setup.mjs';

const fixtures = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'project-s-setup-'));
  fixtures.push(root);
  const write = (name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); };
  write('package.json', '{"name":"project-s"}');
  write('supabase/config.toml', 'project_id = "project-s-local"\n[api]\nport = 54321\n[db]\nport = 54322\n[analytics]\nenabled = false\nport = 54327\n');
  return { root, write };
};
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    const actual = realpathSync(root);
    assert.ok(actual.startsWith(realpathSync(tmpdir()) + sep));
    assert.ok(actual.includes('project-s-setup-'));
    rmSync(actual, { recursive: true, force: true });
  }
});
const ok = (stdout = '') => ({ status: 0, stdout });
const runner = (root, overrides = {}) => (command, args) => {
  if (command === 'git') return ok(args[0] === 'rev-parse' ? root : 'https://github.com/EP2-Git/project-s.git');
  if (command === 'docker') {
    if (args[0] === 'context') return ok(JSON.stringify(overrides.endpoint ?? 'unix:///var/run/docker.sock'));
    if (args[0] === 'info') return overrides.dockerUnavailable ? { status: 1, stderr: 'private-diagnostic' } : ok('28.0.0');
    if (args[0] === 'ps') return ok(overrides.containers ?? '');
    if (args[0] === 'volume') return overrides.volumeUnavailable ? { status: 1 } : ok(overrides.volumes ?? '');
    if (args[0] === 'inspect') return ok('a'.repeat(64));
  }
  if (args.at(-1) === '--version') return ok('10.9.2');
  return ok();
};
const inspectFixture = (f, overrides = {}, options = {}) => collectDoctor({ root: f.root, env: {}, nodeVersion: '22.14.0', run: runner(f.root, overrides), probe: async () => true, ...options });

test('fresh checkout doctor is read-only and allows missing generated files as warnings', async () => {
  const f = fixture();
  const config = readFileSync(join(f.root, 'supabase/config.toml'), 'utf8');
  const result = await inspectFixture(f);
  assert.equal(result.ok, true);
  assert.equal(result.state.hasStack, false);
  assert.equal(existsSync(join(f.root, '.env.local')), false);
  assert.equal(existsSync(join(f.root, '.cache')), false);
  assert.equal(readFileSync(join(f.root, 'supabase/config.toml'), 'utf8'), config);
  assert.ok(result.checks.some((check) => check.id === 'environment' && check.status === 'WARN'));
});

test('doctor inspects native CLI files without invoking its cache-writing version command', async () => {
  const f = fixture(); const calls = [];
  const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const prefix = `node_modules/@supabase/cli-${platform}-${arch()}`;
  f.write('node_modules/supabase/dist/supabase.js', '');
  f.write(`${prefix}/package.json`, '{}');
  f.write(`${prefix}/bin/supabase${process.platform === 'win32' ? '.exe' : ''}`, '');
  const base = runner(f.root);
  const result = await inspectFixture(f, {}, { run: (command, args) => { calls.push(args); return base(command, args); } });
  assert.equal(result.state.cliInstalled, true);
  assert.ok(!calls.flat().some((arg) => arg.includes('supabase.js')));
  assert.equal(existsSync(join(f.root, 'supabase/.temp')), false);
});
test('refuses linked checkout and never includes the project ref in diagnostics', async () => {
  const f = fixture(); f.write('supabase/.temp/project-ref', 'private-project-ref');
  const result = await inspectFixture(f);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result.checks).includes('private-project-ref'));
});
test('refuses remote Docker contexts before querying their daemon', async () => {
  const f = fixture(); const calls = [];
  const base = runner(f.root, { endpoint: 'ssh://private-host' });
  const result = await inspectFixture(f, {}, { run: (command, args) => { calls.push([command, ...args]); return base(command, args); } });
  assert.equal(result.ok, false);
  assert.ok(!calls.some((call) => call[0] === 'docker' && call[1] === 'info'));
  assert.ok(!JSON.stringify(result.checks).includes('private-host'));
});
test('accepts local Windows named-pipe Docker contexts', async () => {
  assert.equal((await inspectFixture(fixture(), { endpoint: 'npipe:////./pipe/dockerDesktopLinuxEngine' })).ok, true);
});

test('refuses remote named pipes and honors Docker context precedence over DOCKER_HOST', async () => {
  const f = fixture(); const calls = [];
  const base = runner(f.root, { endpoint: 'npipe:////remote-host/pipe/docker_engine' });
  const result = await inspectFixture(f, {}, { env: { DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONTEXT: 'remote-context' }, run: (command, args) => { calls.push([command, ...args]); return base(command, args); } });
  assert.equal(result.ok, false);
  assert.ok(calls.some((call) => call.includes('remote-context')));
  assert.ok(!calls.some((call) => call[0] === 'docker' && call[1] === 'info'));
});

test('a successful Docker exit without a server version is not daemon readiness', async () => {
  const f = fixture(); const base = runner(f.root);
  const result = await inspectFixture(f, {}, { run: (command, args) => command === 'docker' && args[0] === 'info' ? ok('') : base(command, args) });
  assert.equal(result.ok, false);
});
test('Docker unavailable and occupied ports fail with remediation, without printing child errors', async () => {
  const result = await inspectFixture(fixture(), { dockerUnavailable: true }, { probe: async (port) => port !== 8080 });
  assert.equal(result.ok, false);
  assert.ok(result.checks.some((check) => check.id === 'port-8080' && check.status === 'FAIL'));
  assert.ok(!JSON.stringify(result.checks).includes('private-diagnostic'));
});
test('missing/old Node and npm versions refuse preflight', async () => {
  const f = fixture();
  assert.equal((await inspectFixture(f, {}, { nodeVersion: '21.0.0' })).ok, false);
  const base = runner(f.root);
  const result = await inspectFixture(f, {}, { run: (command, args) => args.at(-1) === '--version' ? ok('9.0.0') : base(command, args) });
  assert.equal(result.ok, false);
});
test('hosted URLs, privileged browser keys and wrong local project ports refuse setup', async () => {
  for (const contents of [
    'VITE_SUPABASE_URL=https://private.example\n',
    ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'private-secret\n'].join('='),
    'VITE_SUPABASE_PUBLISHABLE_KEY=sb_secret_private-secret\n',
    'VITE_SUPABASE_URL=http://127.0.0.1:9999\n',
  ]) {
    const f = fixture(); f.write('.env.local', contents);
    const result = await inspectFixture(f);
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result.checks).includes('private-secret'));
    assert.ok(!JSON.stringify(result.checks).includes('private.example'));
  }
});
test('environment parsing never evaluates content and only accepts loopback development endpoints', () => {
  assert.equal(parseEnv('export VITE_SUPABASE_URL="http://localhost:54321"').VITE_SUPABASE_URL, 'http://localhost:54321');
  assert.equal(isLoopbackUrl('http://localhost.evil.invalid:54321'), false);
  assert.equal(isLoopbackUrl('http://user:password@127.0.0.1:54321'), false);
  assert.ok(environmentProblems({ DATABASE_URL: 'postgresql://secret@example.invalid/db' }).length);
  assert.ok(environmentProblems({ PROJECT_S_ENVIRONMENT: 'production' }).length);
  const token = `x.${Buffer.from('{"role":"service_role"}').toString('base64url')}.x`;
  assert.ok(environmentProblems({ VITE_SUPABASE_PUBLISHABLE_KEY: token }).length);
});
test('port inventory skips disabled services and rejects invalid ports', () => {
  assert.deepEqual(configuredPorts('[api]\nport = 54321\n[analytics]\nenabled = false\nport = 54327'), [8080, 8083, 54321]);
  assert.throws(() => configuredPorts('[api]\nport = 99999'));
});
test('fresh bootstrap resets only with explicit --local; reuse preserves data and environment', () => {
  const fresh = bootstrapPlan({ hasStack: false });
  assert.ok(fresh.some((step) => step.args.join(' ').endsWith('db reset --local')));
  assert.throws(() => bootstrapPlan({ hasStack: true }), /refuses to reset/);
  assert.throws(() => bootstrapPlan({ hasStack: true, markerMatches: false }, { reuse: true }), /verified/);
  const reuse = bootstrapPlan({ hasStack: true, markerMatches: true, publicEnvExists: true, edgeEnvExists: true }, { reuse: true });
  assert.ok(!reuse.some((step) => step.args.includes('reset') || step.args.some((arg) => arg.includes('write-local'))));
});
test('npm uses Node directly when an npm CLI path is supplied, including spaces in paths', () => {
  const f = fixture(); f.write('npm path/npm-cli.js', '');
  assert.deepEqual(npmInvocation({ npm_execpath: join(f.root, 'npm path/npm-cli.js') }, 'win32'), [process.execPath, [join(f.root, 'npm path/npm-cli.js')]]);
});
test('bootstrap stops at the first failed step and withholds potentially secret child output', async () => {
  const f = fixture(); const calls = []; const logs = [];
  const before = { ok: true, checks: [], state: { hasStack: false } };
  await assert.rejects(runBootstrap({ root: f.root, env: {}, inspect: async () => before, log: (text) => logs.push(text), run: (command, args) => { calls.push(args); return { status: 1, stderr: 'private-secret' }; } }), /withheld/);
  assert.equal(calls.length, 1);
  assert.ok(!logs.join('').includes('private-secret'));
  assert.equal(existsSync(join(f.root, '.cache')), false);
});
test('failed preflight executes no setup commands', async () => {
  const calls = [];
  await assert.rejects(runBootstrap({ inspect: async () => ({ ok: false, checks: [] }), log: () => {}, run: (...args) => calls.push(args) }), /Preflight failed/);
  assert.equal(calls.length, 0);
});
test('existing published stack ports are recognized without claiming an unknown stack is reusable', async () => {
  const f = fixture();
  const result = await inspectFixture(f, { containers: JSON.stringify({ Names: 'supabase_db_project-s-local', Ports: '127.0.0.1:54322->5432/tcp' }) }, { probe: async (port) => port !== 54322 });
  assert.equal(result.ok, true);
  assert.equal(result.state.hasStack, true);
  assert.equal(result.state.markerMatches, false);
  assert.equal(result.checks.find((check) => check.id === 'port-54322').status, 'PASS');
  assert.throws(() => bootstrapPlan(result.state), /refuses to reset/);
});

test('retained data volumes refuse fresh setup even after containers were removed', async () => {
  const result = await inspectFixture(fixture(), { volumes: 'unrelated_volume\nsupabase_db_project-s-local\n' });
  assert.equal(result.state.hasStack, true);
  assert.throws(() => bootstrapPlan(result.state), /Existing local data/);
  assert.throws(() => bootstrapPlan(result.state, { reuse: true }), /verified/);
});

test('volume-inspection failure cannot be treated as an empty disposable stack', async () => {
  assert.equal((await inspectFixture(fixture(), { volumeUnavailable: true })).ok, false);
});

test('bootstraps in separate checkouts cannot race the same disposable project', () => {
  const f = fixture();
  const release = acquireBootstrapLock(f.root);
  assert.throws(() => acquireBootstrapLock(f.root), /Another bootstrap/);
  release();
  acquireBootstrapLock(f.root)();
});

test('bootstrap releases its lock on failure so a corrected retry can proceed', async () => {
  let releases = 0;
  await assert.rejects(runBootstrap({ inspect: async () => ({ ok: false, checks: [] }), log: () => {}, lock: () => () => { releases++; } }), /Preflight failed/);
  assert.equal(releases, 1);
});

test('process environment cannot point at another local Supabase project', async () => {
  assert.equal((await inspectFixture(fixture(), {}, { env: { VITE_SUPABASE_URL: 'http://localhost:9999' } })).ok, false);
});

test('verified reuse preserves configuration and records only the verified database identity', async () => {
  const f = fixture(); const calls = [];
  f.write('.env.local', 'synthetic browser configuration');
  f.write('supabase/functions/.env', 'synthetic HMAC configuration');
  const state = { root: f.root, hasStack: true, markerMatches: true, dbId: 'a'.repeat(64), cliInstalled: true, publicEnvExists: true, edgeEnvExists: true };
  await runBootstrap({ root: f.root, env: {}, reuse: true, skipInstall: true, inspect: async () => ({ ok: true, checks: [], state }), run: (command, args) => { calls.push(args); return ok(); }, log: () => {}, lock: () => acquireBootstrapLock(f.root) });
  assert.ok(!calls.flat().some((arg) => arg === 'reset' || arg.includes('write-local')));
  assert.equal(readFileSync(join(f.root, '.env.local'), 'utf8'), 'synthetic browser configuration');
  assert.equal(readFileSync(join(f.root, 'supabase/functions/.env'), 'utf8'), 'synthetic HMAC configuration');
  assert.equal(JSON.parse(readFileSync(join(f.root, '.cache/local-bootstrap.json'), 'utf8')).databaseContainerId, state.dbId);
});
