import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { arch, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import net from 'node:net';

const projectId = 'project-s-local';
const markerFile = '.cache/local-bootstrap.json';
const cliFile = 'node_modules/supabase/dist/supabase.js';
const minimum = (value, floor) => {
  const parts = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/);
  if (!parts) return false;
  const actual = parts.slice(1).map(Number);
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== floor[i]) return actual[i] > floor[i];
  }
  return true;
};
const readOptional = (path) => {
  try { return readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
};
const json = (text) => { try { return JSON.parse(text); } catch { return undefined; } };

export const runCommand = (command, args, { cwd, timeout = 10_000, quiet = false } = {}) =>
  spawnSync(command, args, { cwd, timeout, encoding: 'utf8', shell: false, stdio: quiet ? 'ignore' : 'pipe' });

export const npmInvocation = (env = process.env, platform = process.platform) => {
  const executable = env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (existsSync(executable)) return [process.execPath, [executable]];
  return platform === 'win32' ? undefined : ['npm', []];
};

export const portAvailable = (port) => new Promise((done) => {
  const server = net.createServer();
  server.once('error', () => done(false));
  server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => done(true)));
});

export const parseEnv = (text = '') => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
  const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (!match) return [];
  let value = match[2];
  if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
  else value = value.replace(/\s+#.*$/, '').trim();
  return [[match[1], value]];
}));

export const isLoopbackUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
};

const privilegedKey = (value = '') => {
  if (value.startsWith('sb_secret_')) return true;
  const payload = json(Buffer.from(value.split('.')[1] ?? '', 'base64url').toString());
  return payload?.role === 'service_role';
};

export const environmentProblems = (values) => {
  const problems = [];
  for (const name of ['VITE_SUPABASE_URL', 'VITE_PROJECT_S_API_URL', 'PROJECT_S_PUBLIC_APP_URL']) {
    if (values[name] && !isLoopbackUrl(values[name])) problems.push('remote-url');
  }
  if (values.PROJECT_S_ALLOWED_ORIGINS?.split(',').some((origin) => !isLoopbackUrl(origin.trim()))) problems.push('remote-origin');
  if (Object.keys(values).some((name) => /^VITE_.*(?:SERVICE_ROLE|SECRET|ACCESS_TOKEN|PASSWORD)/.test(name))) problems.push('browser-secret');
  if (privilegedKey(values.VITE_SUPABASE_PUBLISHABLE_KEY)) problems.push('browser-secret');
  for (const name of ['DATABASE_URL', 'DB_URL', 'SUPABASE_DB_URL']) {
    if (!values[name]) continue;
    try {
      const url = new URL(values[name]);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) problems.push('remote-database');
    } catch { problems.push('remote-database'); }
  }
  if (values.SUPABASE_URL && !isLoopbackUrl(values.SUPABASE_URL)) problems.push('remote-url');
  if (values.SUPABASE_PROJECT_REF || values.SUPABASE_PROJECT_ID) problems.push('project-override');
  if (values.SUPABASE_CLI_BINARY_OVERRIDE) problems.push('binary-override');
  if (values.PROJECT_S_ENVIRONMENT && values.PROJECT_S_ENVIRONMENT !== 'development') problems.push('production-mode');
  if (values.PROJECT_S_CHALLENGE_PROVIDER && values.PROJECT_S_CHALLENGE_PROVIDER !== 'development') problems.push('challenge-mode');
  if (values.PROJECT_S_TRUST_PROXY_HEADERS && values.PROJECT_S_TRUST_PROXY_HEADERS !== 'false') problems.push('proxy-mode');
  return [...new Set(problems)];
};

export const configuredPorts = (config) => {
  const ports = new Set([8080, 8083]);
  for (const section of config.split(/^\s*\[[^\]]+\]\s*$/m)) {
    if (/^\s*enabled\s*=\s*false\s*$/m.test(section)) continue;
    for (const match of section.matchAll(/^\s*(?:port|shadow_port|smtp_port|pop3_port)\s*=\s*(\d+)\s*$/gm)) {
      const port = Number(match[1]);
      if (port < 1 || port > 65535) throw new Error('Invalid configured port');
      ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
};

export async function collectDoctor({ root = process.cwd(), env = process.env, run = runCommand, probe = portAvailable, nodeVersion = process.version } = {}) {
  root = resolve(root);
  const checks = [];
  const add = (id, status, message, remediation = '') => checks.push({ id, status, message, remediation });
  const invoke = (command, args) => run(command, args, { cwd: root });
  const success = (result) => !result.error && result.status === 0;
  let config = '';
  let publicEnvExists = false;
  let edgeEnvExists = false;
  let marker;
  try {
    const pkg = json(readOptional(resolve(root, 'package.json')));
    config = readOptional(resolve(root, 'supabase/config.toml')) ?? '';
    const top = invoke('git', ['rev-parse', '--show-toplevel']);
    const sameRoot = String(top.stdout ?? '').trim().replaceAll('\\', '/').toLowerCase() === root.replaceAll('\\', '/').toLowerCase();
    const safeProject = config.match(/^project_id\s*=\s*"([a-z0-9_-]+)"\s*$/m)?.[1] === projectId;
    add('checkout', pkg?.name === 'project-s' && success(top) && sameRoot && safeProject ? 'PASS' : 'FAIL',
      'Project S repository root and disposable project ID.', 'Run from the Project S root with the tracked supabase/config.toml.');
    const origin = invoke('git', ['remote', 'get-url', 'origin']);
    const canonical = /^(?:https:\/\/github\.com\/|git@github\.com:)EP2-Git\/project-s(?:\.git)?\s*$/i.test(origin.stdout ?? '');
    add('origin', success(origin) && canonical ? 'PASS' : 'WARN', 'Repository origin inspected without displaying its URL.', 'Verify that this fork or checkout is intentional.');
    const linked = ['supabase/.temp/project-ref', '.supabase/project-ref'].some((path) => existsSync(resolve(root, path)));
    add('linked-project', linked ? 'FAIL' : 'PASS', linked ? 'A hosted-project link marker exists.' : 'No hosted-project link marker found.', 'Use a fresh unlinked clone for the disposable local stack; preserve the linked checkout.');
    for (const path of ['.env', '.env.local', '.env.development', '.env.development.local', 'supabase/functions/.env']) {
      const text = readOptional(resolve(root, path));
      if (path === '.env.local') publicEnvExists = text !== undefined;
      if (path === 'supabase/functions/.env') edgeEnvExists = text !== undefined;
      if (text !== undefined && environmentProblems(parseEnv(text)).length) {
        add('environment', 'FAIL', 'Local environment files contain remote, privileged or non-development configuration.', 'Use a fresh clone or replace the configuration with reviewed local-only values. Values are never printed.');
      }
      const url = parseEnv(text).VITE_SUPABASE_URL;
      const apiPort = config.match(/\[api\]([^[]*)/)?.[1].match(/^\s*port\s*=\s*(\d+)\s*$/m)?.[1];
      if (url && isLoopbackUrl(url) && new URL(url).port !== apiPort) add('environment', 'FAIL', 'Browser Supabase URL targets a different local API port.', 'Use the API port in supabase/config.toml; do not reuse another project\'s configuration.');
    }
    if (environmentProblems(env).length) add('environment', 'FAIL', 'Process environment overrides are not local-only.', 'Clear remote or privileged overrides for this local command. Values are never printed.');
    const processUrl = env.VITE_SUPABASE_URL;
    const apiPort = config.match(/\[api\]([^[]*)/)?.[1].match(/^\s*port\s*=\s*(\d+)\s*$/m)?.[1];
    if (processUrl && isLoopbackUrl(processUrl) && new URL(processUrl).port !== apiPort) add('environment', 'FAIL', 'Process Supabase URL targets a different local API port.', 'Clear the override or use the API port in supabase/config.toml.');
    if (!checks.some((check) => check.id === 'environment')) add('environment', publicEnvExists && edgeEnvExists ? 'PASS' : 'WARN',
      publicEnvExists && edgeEnvExists ? 'Local environment configuration is loopback/development only.' : 'Generated local configuration is missing.', 'A fresh bootstrap generates local configuration; never copy production credentials.');
    marker = json(readOptional(resolve(root, markerFile)));
  } catch {
    add('configuration', 'FAIL', 'Local configuration could not be inspected safely.', 'Check file readability and tracked configuration; no file was changed.');
  }
  add('node', minimum(nodeVersion, [22, 12, 0]) ? 'PASS' : 'FAIL', 'Node.js minimum: 22.12.0.', 'Use the version in .nvmrc, then rerun.');
  const npm = npmInvocation(env);
  const npmVersion = npm ? invoke(npm[0], [...npm[1], '--version']) : { status: 1 };
  add('npm', success(npmVersion) && minimum(npmVersion.stdout, [10, 9, 0]) ? 'PASS' : 'FAIL', 'npm minimum: 10.9.0.', 'Run via npm run doctor using the project Node installation.');
  // Even `supabase --version` writes an update-check cache in the checkout.
  // Inspect the locked CLI wrapper and native package without invoking it.
  let cliInstalled = false;
  if (existsSync(resolve(root, cliFile))) {
    const require = createRequire(resolve(root, cliFile));
    const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
    for (const suffix of platform === 'linux' ? ['', '-musl'] : ['']) {
      try {
        const pkg = require.resolve(`@supabase/cli-${platform}-${arch()}${suffix}/package.json`);
        if (existsSync(resolve(dirname(pkg), 'bin', process.platform === 'win32' ? 'supabase.exe' : 'supabase'))) cliInstalled = true;
      } catch { /* Missing optional binary: bootstrap installs the lockfile. */ }
    }
  }
  add('supabase', cliInstalled ? 'PASS' : 'WARN', cliInstalled ? 'Repository Supabase CLI and native binary are installed.' : 'Repository Supabase CLI is not ready.', 'Run npm ci, or use the default bootstrap which installs dependencies.');

  let containers = [];
  let hasVolumes = false;
  let dbId;
  let dockerReady = false;
  const context = env.DOCKER_HOST && !env.DOCKER_CONTEXT
    ? { status: 0, stdout: JSON.stringify(env.DOCKER_HOST) }
    : invoke('docker', ['context', 'inspect', ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), '--format', '{{json .Endpoints.docker.Host}}']);
  const endpoint = json(context.stdout);
  if (!success(context) || typeof endpoint !== 'string') {
    add('docker', 'FAIL', 'Docker context is unavailable.', 'Install/start Docker Desktop or a local Docker engine, then rerun.');
  } else if (!/^unix:\/\/\//.test(endpoint) && !/^npipe:\/\/\/\/\.\/pipe\/[^/]+$/.test(endpoint)) {
    add('docker', 'FAIL', 'Remote or TCP Docker contexts are refused.', 'Select a local Unix-socket or named-pipe Docker context; do not change remote infrastructure.');
  } else {
    const info = invoke('docker', ['info', '--format', '{{.ServerVersion}}']);
    dockerReady = success(info) && /^\d+\.\d+\.\d+/.test(String(info.stdout ?? '').trim());
    add('docker', dockerReady ? 'PASS' : 'FAIL', dockerReady ? 'Local Docker daemon is running.' : 'Local Docker daemon is unavailable.', 'Start the local Docker engine and wait until it is ready.');
    if (dockerReady) {
      const volumes = invoke('docker', ['volume', 'ls', '--format', '{{.Name}}']);
      if (!success(volumes)) add('volumes', 'FAIL', 'Local data volumes could not be inspected.', 'Check Docker permissions; no volumes were changed.');
      else hasVolumes = String(volumes.stdout ?? '').split(/\r?\n/).some((name) => name.trim().endsWith(`_${projectId}`));
      const list = invoke('docker', ['ps', '-a', '--format', '{{json .}}']);
      if (!success(list)) add('containers', 'FAIL', 'Local containers could not be inspected.', 'Check Docker permissions; no containers were changed.');
      else {
        const lines = String(list.stdout ?? '').trim().split(/\r?\n/).filter(Boolean);
        const parsed = lines.map(json);
        if (parsed.some((item) => !item || typeof item.Names !== 'string')) add('containers', 'FAIL', 'Container metadata is invalid.', 'Check Docker CLI compatibility; no containers were changed.');
        containers = parsed.filter((item) => item?.Names?.endsWith(`_${projectId}`));
      }
      if (containers.length) {
        const identity = invoke('docker', ['inspect', '--format', '{{.Id}}', `supabase_db_${projectId}`]);
        if (success(identity) && /^[a-f0-9]{64}\s*$/.test(identity.stdout ?? '')) dbId = identity.stdout.trim();
      }
    }
  }
  const ownedPorts = new Set(containers.flatMap((item) => [...String(item.Ports ?? '').matchAll(/:(\d+)->/g)].map((match) => Number(match[1]))));
  try {
    for (const port of configuredPorts(config)) {
      const available = await probe(port);
      add(`port-${port}`, available || ownedPorts.has(port) ? 'PASS' : 'FAIL',
        available ? `Port ${port} is available.` : ownedPorts.has(port) ? `Port ${port} is published by this local stack.` : `Port ${port} is occupied or unavailable.`,
        'Stop the conflicting local service or inspect the existing local stack; the doctor never stops it.');
    }
  } catch { add('ports', 'FAIL', 'Configured ports could not be checked.', 'Review supabase/config.toml and local port permissions.'); }
  const markerMatches = Boolean(dbId && marker?.databaseContainerId === dbId && marker?.root === root && marker?.projectId === projectId);
  const hasStack = containers.length > 0 || hasVolumes;
  add('stack', hasStack ? 'WARN' : 'PASS', hasStack ? 'Existing disposable-project containers or retained data volumes were found.' : 'No existing disposable-project containers or data volumes found.', 'Default bootstrap refuses existing data. --reuse requires this checkout\'s verified bootstrap marker.');
  return { version: 1, ok: !checks.some((check) => check.status === 'FAIL'), checks,
    state: { root, hasStack, markerMatches, dbId, cliInstalled, publicEnvExists, edgeEnvExists, dockerReady } };
}

export const reportDoctor = (result, log = console.log) => {
  for (const check of result.checks) log(`${check.status} ${check.id}: ${check.message}${check.status !== 'PASS' && check.remediation ? ` ${check.remediation}` : ''}`);
};

export const bootstrapPlan = ({ hasStack, markerMatches, publicEnvExists, edgeEnvExists }, { reuse = false, skipInstall = false } = {}) => {
  if (hasStack && !reuse) throw new Error('Existing local data: default bootstrap refuses to reset it. Use --reuse only for a stack created by this checkout, or follow the manual local-development guide.');
  if (reuse && (!hasStack || !markerMatches || !edgeEnvExists || !publicEnvExists)) throw new Error('Reuse requires an existing stack and intact generated environment verified by this checkout\'s bootstrap marker. Follow the manual guide for older or foreign stacks.');
  return [
    ...(!skipInstall ? [{ label: 'Install locked dependencies', kind: 'npm', args: ['ci'] }] : []),
    { label: 'Build shared packages', kind: 'npm', args: ['run', 'build:packages'] },
    ...(!reuse ? [{ label: 'Generate local Edge configuration', kind: 'node', args: ['scripts/write-local-edge-env.mjs'] }] : []),
    { label: 'Start the local Supabase stack', kind: 'node', args: [cliFile, 'start'] },
    ...(!reuse ? [{ label: 'Reset the newly created disposable database', kind: 'node', args: [cliFile, 'db', 'reset', '--local'] }] : []),
    { label: 'Wait for the local database', kind: 'node', args: ['scripts/wait-for-local-db.mjs'] },
    ...(!reuse ? [{ label: 'Generate local browser configuration', kind: 'node', args: ['scripts/write-local-env.mjs'] }] : []),
  ];
};

// All checkouts use the same disposable project ID. Serialize our bootstraps
// across checkouts before inspecting data, rather than racing a fresh reset.
export const acquireBootstrapLock = (directory = tmpdir()) => {
  const path = resolve(directory, 'project-s-local-bootstrap.lock');
  let handle;
  try { handle = openSync(path, 'wx', 0o600); }
  catch { throw new Error('Another bootstrap may be running, or its lock remains after an interruption. Inspect local processes before removing project-s-local-bootstrap.lock from the system temporary directory.'); }
  return () => { closeSync(handle); unlinkSync(path); };
};

export async function runBootstrap({ root = process.cwd(), env = process.env, run = runCommand, probe = portAvailable, reuse = false, skipInstall = false, log = console.log, inspect = collectDoctor, lock = acquireBootstrapLock } = {}) {
  const release = lock();
  try {
    const before = await inspect({ root, env, run, probe });
    reportDoctor(before, log);
    if (!before.ok) throw new Error('Preflight failed. Follow the doctor remediation above; setup made no changes.');
    const plan = bootstrapPlan(before.state, { reuse, skipInstall });
    if (skipInstall && !before.state.cliInstalled) throw new Error('--skip-install requires npm ci to have completed first.');
    const npm = npmInvocation(env);
    if (!npm) throw new Error('Unable to locate npm. Run npm run bootstrap with the project Node installation.');
    for (const step of plan) {
      log(step.label);
      const command = step.kind === 'npm' ? npm[0] : process.execPath;
      const args = step.kind === 'npm' ? [...npm[1], ...step.args] : step.args;
      const result = run(command, args, { cwd: resolve(root), timeout: 600_000, quiet: true });
      if (result.error || result.status !== 0) throw new Error(`${step.label} failed. Child output is withheld to protect local credentials. Diagnose with the corresponding documented local-development command; setup stopped without cleanup or a retry.`);
    }
    const after = await inspect({ root, env, run, probe });
    reportDoctor(after, log);
    if (!after.ok || !after.state.dbId || !after.state.publicEnvExists || !after.state.edgeEnvExists) throw new Error('Postflight did not verify the generated local stack. Inspect it using the doctor; no cleanup or reset was attempted.');
    mkdirSync(resolve(root, '.cache'), { recursive: true });
    writeFileSync(resolve(root, markerFile), JSON.stringify({ root: resolve(root), projectId, databaseContainerId: after.state.dbId }) + '\n', { mode: 0o600 });
    log('Local stack ready. Run npm run dev, then open http://127.0.0.1:8080. No hosted project was provisioned.');
  } finally { release(); }
}
