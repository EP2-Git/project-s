import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { acquireBootstrapLock, configuredPorts, environmentProblems, parseEnv, portAvailable } from './local-setup.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (stage) => { throw new Error(`Local demo stack refused at: ${stage}. Existing data was not removed; child diagnostics are withheld.`); };
const runDefault = (command, args, options) => spawnSync(command, args, {
  ...options, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024,
});
const successful = (result) => !result.error && result.status === 0;
const samePath = (a, b) => process.platform === 'win32'
  ? a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase()
  : a === b;

function ownedPath(root, path) {
  const child = relative(root, path);
  if (child === '..' || child.startsWith(`..${sep}`)) fail('owned path');
  let current = root;
  for (const part of ['', ...child.split(sep).filter(Boolean)]) {
    if (part) current = resolve(current, part);
    if (!existsSync(current)) continue;
    if (lstatSync(current).isSymbolicLink() || !samePath(realpathSync(current), current)) fail('redirected path');
  }
}

function files(root, projectId) {
  const base = resolve(root, 'supabase');
  const entries = [];
  const visit = (name) => {
    const path = resolve(base, name);
    ownedPath(root, path);
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path).sort()) {
        if (['.env', '.temp', '.branches'].includes(child)) continue;
        visit(`${name}/${child}`);
      }
    } else if (stat.isFile()) {
      let bytes = readFileSync(path);
      if (name === 'config.toml' && projectId) {
        const text = bytes.toString('utf8');
        if (!/^project_id\s*=\s*"project-s-local"\s*$/m.test(text)) fail('canonical source project');
        bytes = Buffer.from(text.replace(/^project_id\s*=\s*"project-s-local"\s*$/m, `project_id = "${projectId}"`));
      }
      entries.push([name, bytes]);
    } else fail('source file type');
  };
  for (const name of ['config.toml', 'seed.sql', 'migrations', 'functions']) visit(name);
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

const fingerprint = (entries) => {
  const digest = createHash('sha256');
  for (const [name, bytes] of entries) digest.update(name).update('\0').update(bytes).update('\0');
  return digest.digest('hex');
};

function setup({ root = process.cwd(), env = process.env, run = runDefault, probe = portAvailable } = {}) {
  root = resolve(root);
  ownedPath(root, root);
  const workdir = resolve(root, '.cache/local-demo-stack');
  const markerPath = resolve(workdir, 'marker.json');
  const publicPath = resolve(root, '.env.local');
  const projectId = `project-s-demo-${hash(root).slice(0, 12)}`;
  const containerName = `supabase_db_${projectId}`;
  const networkName = `${projectId}-loopback`;
  for (const path of [workdir, markerPath, publicPath, resolve(root, 'supabase/functions/.env'), resolve(workdir, 'supabase/functions/.env')]) ownedPath(root, path);
  const invoke = (command, args, { cwd = root, timeout = 20_000 } = {}) => {
    const result = run(command, args, { cwd, timeout, env });
    if (!successful(result)) fail('local command');
    return String(result.stdout ?? '').trim();
  };
  if (environmentProblems(env).length || Object.entries(env).some(([key, value]) => key.startsWith('VITE_')
    && !(key === 'VITE_PROJECT_S_DEPLOYMENT_AUDIENCE' && value === 'self-hosted'))) fail('process environment');
  for (const path of ['supabase/.temp/project-ref', '.supabase/project-ref']) {
    if (existsSync(resolve(root, path))) fail('hosted link');
  }
  for (const path of ['.env', '.env.local', '.env.development', '.env.development.local', 'supabase/functions/.env']) {
    const full = resolve(root, path);
    ownedPath(root, full);
    if (existsSync(full) && environmentProblems(parseEnv(readFileSync(full, 'utf8'))).length) fail('checkout environment');
    if (['.env', '.env.development', '.env.development.local'].includes(path) && existsSync(full)) fail('alternate Vite environment');
  }
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'project-s' || !samePath(invoke('git', ['rev-parse', '--show-toplevel']), root)) fail('checkout');
  if (!existsSync(resolve(root, 'node_modules/supabase/dist/supabase.js'))) fail('installed CLI');
  if (!existsSync(resolve(root, 'supabase/functions/_shared/.generated/contracts/dist/index.js'))) fail('built Edge packages');
  const endpoint = env.DOCKER_HOST && !env.DOCKER_CONTEXT ? env.DOCKER_HOST
    : JSON.parse(invoke('docker', ['context', 'inspect', ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), '--format', '{{json .Endpoints.docker.Host}}']));
  if (typeof endpoint !== 'string' || (!/^unix:\/\/\//.test(endpoint) && !/^npipe:\/\/\/\/\.\/pipe\/[^/]+$/.test(endpoint))) fail('local Docker endpoint');
  if (!/^\d+\.\d+\.\d+/.test(invoke('docker', ['info', '--format', '{{.ServerVersion}}']))) fail('Docker readiness');
  const source = files(root, projectId);
  const sourceDigest = fingerprint(source);
  const cli = (args, options) => invoke(process.execPath,
    [resolve(root, 'node_modules/supabase/dist/supabase.js'), '--workdir', workdir, '--network-id', networkName, ...args], options);
  const containers = () => invoke('docker', ['ps', '-a', '--format', '{{json .}}']).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const volumes = () => invoke('docker', ['volume', 'ls', '--format', '{{.Name}}']).split(/\r?\n/).filter(Boolean);
  const networkNames = () => invoke('docker', ['network', 'ls', '--format', '{{.Name}}']).split(/\r?\n/).filter(Boolean);
  const inspectNetwork = (expectedId) => {
    const item = JSON.parse(invoke('docker', ['network', 'inspect', '--format', '{{json .}}', networkName]));
    if (!/^[a-f0-9]{64}$/.test(item.Id) || (expectedId && item.Id !== expectedId)
      || item.Name !== networkName || item.Driver !== 'bridge'
      || item.Options?.['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1'
      || item.Labels?.['com.project-s.demo.root'] !== hash(root)) fail('owned loopback network');
    return item.Id;
  };
  const inspectDbDetails = () => {
    const item = JSON.parse(invoke('docker', ['inspect', '--format', '{{json .}}', containerName]));
    const data = item.Mounts?.filter((mount) => mount.Destination === '/var/lib/postgresql/data');
    if (!/^[a-f0-9]{64}$/.test(item.Id) || item.Name !== `/${containerName}` || item.State?.Running !== true
      || item.Config?.Labels?.['com.supabase.cli.project'] !== projectId
      || !samePath(item.Config?.Labels?.['com.supabase.cli.workdir'] ?? '', workdir)
      || item.Mounts?.length !== 1 || data?.length !== 1 || data[0].Type !== 'volume' || data[0].Name !== `supabase_db_${projectId}`) fail('database identity');
    return { id: item.Id, volume: data[0].Name };
  };
  const inspectDb = () => inspectDbDetails().id;
  const assertNetworkBindings = (marker) => {
    inspectNetwork(marker.networkId);
    const owned = containers().filter((entry) => typeof entry.Names === 'string' && entry.Names.endsWith(`_${projectId}`));
    if (!owned.some((entry) => typeof entry.Ports === 'string' && /:54321->/.test(entry.Ports) && /^Up\b/.test(entry.Status))) fail('owned local API port');
    for (const container of owned) {
      const item = JSON.parse(invoke('docker', ['inspect', '--format', '{{json .NetworkSettings}}', container.Names]));
      if (item.Networks?.[networkName]?.NetworkID !== marker.networkId) fail('container network binding');
      for (const bindings of Object.values(item.Ports ?? {})) {
        if (bindings !== null && (!Array.isArray(bindings) || bindings.some((binding) => binding.HostIp !== '127.0.0.1'))) fail('non-loopback published port');
      }
    }
  };
  const context = (marker) => {
    assertNetworkBindings(marker);
    const values = parseEnv(cli(['status', '-o', 'env']));
    if (values.API_URL !== 'http://127.0.0.1:54321' || !values.ANON_KEY || /[\r\n]/.test(values.ANON_KEY)) fail('local API status');
    const publicValues = parseEnv(readFileSync(publicPath, 'utf8'));
    if (Object.keys(publicValues).sort().join(',') !== 'VITE_SUPABASE_PUBLISHABLE_KEY,VITE_SUPABASE_URL'
      || publicValues.VITE_SUPABASE_URL !== values.API_URL || publicValues.VITE_SUPABASE_PUBLISHABLE_KEY !== values.ANON_KEY
      || environmentProblems(publicValues).length) fail('browser configuration');
    return { root, workdir, projectId, containerName, dbId: marker.databaseContainerId, networkId: marker.networkId, sourceDigest,
      apiUrl: values.API_URL, anonKey: values.ANON_KEY };
  };
  const readMarker = () => {
    if (!existsSync(markerPath)) fail('missing ownership marker');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    const names = ['version', 'phase', 'root', 'projectId', 'databaseContainerId', 'networkId', 'sourceDigest', 'publicEnvDigest', 'edgeEnvDigest'];
    if (Object.keys(marker).sort().join(',') !== names.sort().join(',') || marker.version !== 1 || marker.phase !== 'ready'
      || marker.root !== root || marker.projectId !== projectId || marker.sourceDigest !== sourceDigest
      || !/^[a-f0-9]{64}$/.test(marker.databaseContainerId) || !/^[a-f0-9]{64}$/.test(marker.networkId)
      || inspectDb() !== marker.databaseContainerId) fail('ownership marker');
    inspectNetwork(marker.networkId);
    if (fingerprint(files(workdir)) !== sourceDigest) fail('staged source changed');
    if (!existsSync(publicPath) || hash(readFileSync(publicPath)) !== marker.publicEnvDigest
      || hash(readFileSync(resolve(workdir, 'supabase/functions/.env'))) !== marker.edgeEnvDigest) fail('generated environment changed');
    return marker;
  };
  return { root, workdir, markerPath, publicPath, projectId, containerName, networkName, source, sourceDigest, invoke, cli,
    containers, volumes, networkNames, inspectNetwork, inspectDb, inspectDbDetails, assertNetworkBindings, context, readMarker, probe };
}

export async function assertLocalDemoStack(options = {}) {
  try {
    const state = setup(options);
    const marker = state.readMarker();
    return state.context(marker);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Local demo stack refused at:')) throw error;
    fail('configuration or command');
  }
}

export async function prepareLocalDemoStack({ log = console.log, lock = acquireBootstrapLock, ...options } = {}) {
  const release = lock();
  try {
    const state = setup(options);
    const { root, workdir, markerPath, publicPath, projectId, source, sourceDigest } = state;
    if (existsSync(workdir)) {
      const marker = state.readMarker();
      log('Reusing the verified demo database without resetting data or regenerating secrets.');
      return state.context(marker);
    }
    if (existsSync(publicPath) || existsSync(resolve(root, 'supabase/functions/.env'))) fail('existing generated environment');
    if (state.containers().some((entry) => typeof entry.Names !== 'string' || entry.Names.endsWith(`_${projectId}`))
      || state.volumes().some((name) => name.endsWith(`_${projectId}`)) || state.networkNames().includes(state.networkName)) fail('existing demo data');
    for (const port of [...configuredPorts(readFileSync(resolve(root, 'supabase/config.toml'), 'utf8')), 4173]) {
      if (!await state.probe(port)) fail('occupied local port');
    }
    mkdirSync(workdir, { recursive: true, mode: 0o700 });
    for (const [name, bytes] of source) {
      const destination = resolve(workdir, 'supabase', name);
      ownedPath(root, destination);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: 'wx' });
    }
    const marker = { version: 1, phase: 'starting', root, projectId, databaseContainerId: null,
      networkId: null, sourceDigest, publicEnvDigest: null, edgeEnvDigest: null };
    const save = () => writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    save();
    const createdNetwork = state.invoke('docker', ['network', 'create', '--driver', 'bridge',
      '--label', `com.project-s.demo.root=${hash(root)}`, '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', state.networkName]);
    marker.networkId = state.inspectNetwork(createdNetwork); save();
    state.invoke(process.execPath, [resolve(root, 'scripts/write-local-edge-env.mjs')], { cwd: workdir });
    log('Starting a separate disposable demo project; existing Project S volumes remain untouched.');
    state.cli(['start'], { timeout: 600_000 });
    const freshDatabase = state.inspectDbDetails();
    marker.databaseContainerId = freshDatabase.id;
    marker.phase = 'initializing'; save();
    if (fingerprint(files(workdir)) !== sourceDigest || state.inspectDb() !== marker.databaseContainerId) fail('new database ownership');
    log('Applying migrations only to the newly created, verified demo database.');
    state.cli(['db', 'reset', '--local'], { timeout: 600_000 });
    const initializedDatabase = state.inspectDbDetails();
    if (initializedDatabase.volume !== freshDatabase.volume) fail('database identity after initialization');
    // Supabase may recreate its DB container during the controlled fresh reset.
    // Only this first reset may update the ID; ready reuse never adopts a new ID.
    marker.databaseContainerId = initializedDatabase.id;
    state.assertNetworkBindings(marker);
    state.invoke(process.execPath, [resolve(root, 'scripts/wait-for-local-db.mjs')], { cwd: workdir, timeout: 90_000 });
    const values = parseEnv(state.cli(['status', '-o', 'env']));
    if (values.API_URL !== 'http://127.0.0.1:54321' || !values.ANON_KEY || /[\r\n]/.test(values.ANON_KEY)) fail('local API status');
    const publicText = `# Generated for this owned local demo stack.\nVITE_SUPABASE_URL=${values.API_URL}\nVITE_SUPABASE_PUBLISHABLE_KEY=${values.ANON_KEY}\n`;
    if (environmentProblems(parseEnv(publicText)).length) fail('public API credential');
    writeFileSync(publicPath, publicText, { flag: 'wx', mode: 0o600 });
    marker.publicEnvDigest = hash(readFileSync(publicPath));
    marker.edgeEnvDigest = hash(readFileSync(resolve(workdir, 'supabase/functions/.env')));
    marker.phase = 'ready'; save();
    return state.context(state.readMarker());
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Local demo stack refused at:')) throw error;
    fail('configuration or command');
  } finally { release(); }
}
