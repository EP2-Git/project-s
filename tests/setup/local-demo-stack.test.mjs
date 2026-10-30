import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { assertLocalDemoStack, prepareLocalDemoStack } from '../../scripts/lib/local-demo-stack.mjs';

function fixture(t, overrides = {}) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(resolve(parent, 'project-s-demo-stack-'));
  const projectId = `project-s-demo-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
  const workdir = resolve(root, '.cache/local-demo-stack');
  const write = (name, text) => { mkdirSync(dirname(resolve(root, name)), { recursive: true }); writeFileSync(resolve(root, name), text); };
  write('package.json', '{"name":"project-s"}');
  write('node_modules/supabase/dist/supabase.js', '');
  write('supabase/config.toml', 'project_id = "project-s-local"\n[api]\nport = 54321\n[db]\nport = 54322\n');
  write('supabase/seed.sql', 'select 1;\n');
  write('supabase/migrations/20260101000000_fixture.sql', 'select 1;\n');
  write('supabase/functions/api-v1/index.ts', 'export {};\n');
  write('supabase/functions/_shared/.generated/contracts/dist/index.js', 'export {};\n');
  t.after(() => {
    const child = relative(parent, root);
    assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && basename(root).startsWith('project-s-demo-stack-'));
    assert.equal(realpathSync(root), root);
    rmSync(root, { recursive: true, force: true });
  });
  let started = false;
  let reset = false;
  let networkCreated = false;
  let dbId = 'a'.repeat(64);
  const calls = [];
  const ok = (stdout = '') => ({ status: 0, stdout });
  const run = (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd });
    if (overrides.failCommand?.(command, args)) return { status: 1, stderr: 'private-secret-output' };
    if (command === 'git') return ok(root);
    if (command === 'docker') {
      if (args[0] === 'context') return ok(JSON.stringify(overrides.endpoint ?? 'unix:///var/run/docker.sock'));
      if (args[0] === 'info') return ok('28.0.4');
      if (args[0] === 'ps') return ok((overrides.containers ?? (started ? [{ Names: `supabase_kong_${projectId}`, Ports: '127.0.0.1:54321->8000/tcp', Status: 'Up 1 minute' }] : [])).map((entry) => JSON.stringify(entry)).join('\n'));
      if (args[0] === 'volume') return ok(overrides.volumes ?? 'supabase_db_project-s-local\nsupabase_edge_runtime_project-s-local');
      if (args[0] === 'network') {
        if (args[1] === 'ls') return ok(networkCreated ? `${projectId}-loopback` : 'bridge');
        if (args[1] === 'create') { networkCreated = true; return ok('d'.repeat(64)); }
        if (args[1] === 'inspect') return ok(JSON.stringify({
          Id: 'd'.repeat(64), Name: `${projectId}-loopback`, Driver: 'bridge',
          Options: { 'com.docker.network.bridge.host_binding_ipv4': overrides.foreignNetwork ? '0.0.0.0' : '127.0.0.1' },
          Labels: { 'com.project-s.demo.root': createHash('sha256').update(root).digest('hex') },
        }));
      }
      if (args[0] === 'inspect' && args.includes('{{json .NetworkSettings}}')) return ok(JSON.stringify({
        Networks: { [`${projectId}-loopback`]: { NetworkID: 'd'.repeat(64) } },
        Ports: { '8000/tcp': [{ HostIp: overrides.wildcardPort ? '0.0.0.0' : '127.0.0.1', HostPort: '54321' }] },
      }));
      if (args[0] === 'inspect') return ok(JSON.stringify({
        Id: dbId, Name: `/supabase_db_${projectId}`, State: { Running: true },
        Config: { Labels: { 'com.supabase.cli.project': projectId,
          'com.supabase.cli.workdir': reset && overrides.foreignResetWorkdir ? 'foreign' : workdir } },
        Mounts: [{ Destination: '/var/lib/postgresql/data', Type: 'volume',
          Name: reset && overrides.foreignResetVolume ? 'foreign' : `supabase_db_${projectId}` }],
      }));
    }
    if (args[0]?.endsWith('write-local-edge-env.mjs')) {
      write('.cache/local-demo-stack/supabase/functions/.env', 'PROJECT_S_ENVIRONMENT=development\nPROJECT_S_RATE_LIMIT_HMAC_SECRET=fixture-private\n');
      return ok();
    }
    if (args.includes('start')) started = true;
    if (args.includes('reset')) { reset = true; dbId = 'b'.repeat(64); }
    if (args.includes('status')) return ok('API_URL="http://127.0.0.1:54321"\nANON_KEY="public-fixture-key"\nSERVICE_ROLE_KEY="private-fixture-service-key"\n');
    return ok();
  };
  const options = { root, env: {}, run, probe: async () => true, lock: () => () => {}, log: () => {} };
  return { root, workdir, projectId, write, calls, options, setDbId: (value) => { dbId = value; } };
}

test('fresh demo uses a separate project, preserves standard-project volumes and returns only the public key', async (t) => {
  const f = fixture(t);
  const context = await prepareLocalDemoStack(f.options);
  assert.equal(context.projectId, f.projectId);
  assert.equal(context.containerName, `supabase_db_${f.projectId}`);
  assert.equal(context.apiUrl, 'http://127.0.0.1:54321');
  assert.equal(context.anonKey, 'public-fixture-key');
  assert.equal(context.dbId, 'b'.repeat(64), 'The controlled reset may recreate only its bound database container.');
  assert.equal(JSON.stringify(context).includes('private-fixture'), false);
  assert.equal(readFileSync(resolve(f.root, 'supabase/config.toml'), 'utf8').includes('"project-s-local"'), true);
  assert.equal(readFileSync(resolve(f.workdir, 'supabase/config.toml'), 'utf8').includes(`"${f.projectId}"`), true);
  assert.equal(existsSync(resolve(f.root, 'supabase/functions/.env')), false);
  const reset = f.calls.find((call) => call.args.includes('reset'));
  assert.ok(reset.args.includes(f.workdir));
  assert.ok(!f.calls.some((call) => call.args.some((arg) => ['rm', 'prune', 'stop'].includes(arg))));
});

test('verified reuse makes no start, reset, source or secret writes', async (t) => {
  const f = fixture(t); await prepareLocalDemoStack(f.options);
  const publicBefore = readFileSync(resolve(f.root, '.env.local'));
  const edgeBefore = readFileSync(resolve(f.workdir, 'supabase/functions/.env'));
  f.calls.length = 0;
  await prepareLocalDemoStack(f.options);
  await assertLocalDemoStack(f.options);
  assert.ok(!f.calls.some((call) => call.args.some((arg) => ['start', 'reset'].includes(arg))));
  assert.ok(publicBefore.equals(readFileSync(resolve(f.root, '.env.local'))));
  assert.ok(edgeBefore.equals(readFileSync(resolve(f.workdir, 'supabase/functions/.env'))));
});

test('preexisting demo volumes without ownership marker are refused before staging writes', async (t) => {
  const f = fixture(t);
  f.options.run = fixtureRunnerWithVolume(f);
  await assert.rejects(prepareLocalDemoStack(f.options), /existing demo data/);
  assert.equal(existsSync(f.workdir), false);
});

function fixtureRunnerWithVolume(f) {
  const original = f.options.run;
  return (command, args, options) => command === 'docker' && args[0] === 'volume'
    ? { status: 0, stdout: `supabase_db_${f.projectId}` } : original(command, args, options);
}

test('partial or foreign staging is preserved and never adopted', async (t) => {
  const f = fixture(t); f.write('.cache/local-demo-stack/sentinel', 'preserve');
  await assert.rejects(prepareLocalDemoStack(f.options), /missing ownership marker/);
  assert.equal(readFileSync(resolve(f.workdir, 'sentinel'), 'utf8'), 'preserve');
  assert.ok(!f.calls.some((call) => call.args.includes('reset')));
});

test('remote Docker endpoints are refused before daemon inspection or staging', async (t) => {
  const f = fixture(t, { endpoint: 'ssh://private-host' });
  await assert.rejects(prepareLocalDemoStack(f.options), /local Docker endpoint/);
  assert.ok(!f.calls.some((call) => call.command === 'docker' && call.args[0] === 'info'));
  assert.equal(existsSync(f.workdir), false);
});

test('occupied ports are refused without starting or writing a project', async (t) => {
  const f = fixture(t); f.options.probe = async (port) => port !== 54321;
  await assert.rejects(prepareLocalDemoStack(f.options), /occupied local port/);
  assert.equal(existsSync(f.workdir), false);
  assert.ok(!f.calls.some((call) => call.args.includes('start')));
});

test('hosted links and existing generated environment are preserved', async (t) => {
  for (const path of ['supabase/.temp/project-ref', '.env.local']) {
    const f = fixture(t); f.write(path, path.includes('project-ref') ? 'sensitive-ref' : 'VITE_SUPABASE_URL=http://127.0.0.1:54321\n');
    const before = readFileSync(resolve(f.root, path));
    await assert.rejects(prepareLocalDemoStack(f.options), /hosted link|existing generated environment/);
    assert.ok(before.equals(readFileSync(resolve(f.root, path))));
    assert.equal(existsSync(f.workdir), false);
  }
});

test('linked cache and environment paths are refused without touching targets', async (t) => {
  for (const path of ['.cache', '.env.local']) {
    const f = fixture(t); const unrelated = resolve(f.root, 'unrelated'); mkdirSync(unrelated);
    writeFileSync(resolve(unrelated, 'sentinel'), 'preserve');
    symlinkSync(unrelated, resolve(f.root, path), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareLocalDemoStack(f.options), /redirected path/);
    assert.equal(readFileSync(resolve(unrelated, 'sentinel'), 'utf8'), 'preserve');
  }
});

test('container recreation, source changes and changed public environment fail closed on reuse', async (t) => {
  for (const change of ['container', 'source', 'staged', 'environment', 'secret']) {
    const f = fixture(t); await prepareLocalDemoStack(f.options);
    if (change === 'container') f.setDbId('c'.repeat(64));
    if (change === 'source') f.write('supabase/migrations/new.sql', 'select 2;');
    if (change === 'staged') f.write('.cache/local-demo-stack/supabase/migrations/injected.sql', 'select 2;');
    if (change === 'environment') f.write('.env.local', 'VITE_SUPABASE_URL=http://127.0.0.1:54321\nVITE_SUPABASE_PUBLISHABLE_KEY=changed\n');
    if (change === 'secret') f.write('.cache/local-demo-stack/supabase/functions/.env', 'changed');
    f.calls.length = 0;
    await assert.rejects(assertLocalDemoStack(f.options), /ownership marker|source changed|environment changed/);
    assert.ok(!f.calls.some((call) => call.args.includes('reset')));
  }
});

test('failed child commands hide diagnostics and preserve partial owned data', async (t) => {
  const f = fixture(t, { failCommand: (_command, args) => args.includes('reset') });
  await assert.rejects(prepareLocalDemoStack(f.options), (error) => /local command/.test(error.message) && !error.message.includes('private-secret'));
  assert.equal(JSON.parse(readFileSync(resolve(f.workdir, 'marker.json'), 'utf8')).phase, 'initializing');
  assert.equal(existsSync(resolve(f.root, '.env.local')), false);
});

test('unsafe process environment is refused before commands and missing ownership never enables cleanup', async (t) => {
  const f = fixture(t); f.options.env = { VITE_SUPABASE_URL: 'https://hosted.invalid' };
  await assert.rejects(prepareLocalDemoStack(f.options), /process environment/);
  assert.equal(f.calls.length, 0);
  assert.equal(existsSync(f.workdir), false);
});

test('Vite process overrides cannot redirect the demo to another local service or key', async (t) => {
  for (const env of [
    { VITE_SUPABASE_URL: 'http://127.0.0.1:9999' },
    { VITE_SUPABASE_URL: '' },
    { VITE_PROJECT_S_API_URL: 'http://127.0.0.1:54321/functions/v1/api-v1' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: 'unrelated-public-key' },
    { VITE_SUPABASE_PUBLISHABLE_KEY: '' },
    { VITE_SUPABASE_URL: 'http://127.0.0.1:54321' },
    { VITE_PROJECT_S_API_URL: '' },
    { VITE_UNREVIEWED_SETTING: 'value' },
  ]) {
    const f = fixture(t); f.options.env = env;
    await assert.rejects(prepareLocalDemoStack(f.options), /process environment/);
    assert.equal(f.calls.length, 0);
    assert.equal(existsSync(f.workdir), false);
  }
});

test('alternate Vite environment files cannot override owned configuration before setup or on reuse', async (t) => {
  for (const reused of [false, true]) {
    for (const path of ['.env', '.env.development', '.env.development.local']) {
      const f = fixture(t); if (reused) await prepareLocalDemoStack(f.options);
      f.write(path, 'VITE_SUPABASE_URL=http://127.0.0.1:9999\n'); f.calls.length = 0;
      await assert.rejects(reused ? assertLocalDemoStack(f.options) : prepareLocalDemoStack(f.options), /alternate Vite environment/);
      assert.equal(f.calls.length, 0);
      if (!reused) assert.equal(existsSync(f.workdir), false);
    }
  }
});

test('a fresh reset never accepts foreign workdir labels or database volume bindings', async (t) => {
  for (const options of [{ foreignResetWorkdir: true }, { foreignResetVolume: true }]) {
    const f = fixture(t, options);
    await assert.rejects(prepareLocalDemoStack(f.options), /database identity/);
    assert.equal(JSON.parse(readFileSync(resolve(f.workdir, 'marker.json'), 'utf8')).phase, 'initializing');
    assert.equal(existsSync(resolve(f.root, '.env.local')), false);
  }
});

test('foreign bridge options and wildcard published ports never produce a usable context', async (t) => {
  for (const options of [{ foreignNetwork: true }, { wildcardPort: true }]) {
    const f = fixture(t, options);
    await assert.rejects(prepareLocalDemoStack(f.options), /owned loopback network|non-loopback published port/);
    assert.equal(existsSync(resolve(f.root, '.env.local')), false);
  }
});

test('foreign marker roots and unexpected marker fields never authorize reuse', async (t) => {
  for (const change of ['root', 'extra']) {
    const f = fixture(t); await prepareLocalDemoStack(f.options);
    const path = resolve(f.workdir, 'marker.json');
    const marker = JSON.parse(readFileSync(path, 'utf8'));
    if (change === 'root') marker.root = resolve(f.root, 'foreign');
    else marker.extra = true;
    writeFileSync(path, JSON.stringify(marker));
    f.calls.length = 0;
    await assert.rejects(assertLocalDemoStack(f.options), /ownership marker/);
    assert.ok(!f.calls.some((call) => call.args.includes('reset')));
  }
});

test('a foreign service holding the API port is not accepted as the demo gateway', async (t) => {
  const f = fixture(t); await prepareLocalDemoStack(f.options);
  const original = f.options.run;
  f.options.run = (command, args, options) => command === 'docker' && args[0] === 'ps'
    ? { status: 0, stdout: JSON.stringify({ Names: 'foreign', Ports: '127.0.0.1:54321->8000/tcp', Status: 'Up 1 minute' }) }
    : original(command, args, options);
  await assert.rejects(assertLocalDemoStack(f.options), /owned local API port/);
});
