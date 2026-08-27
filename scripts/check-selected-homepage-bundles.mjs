#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const repositoryRoot = process.cwd();
const testResultsRoot = resolve(repositoryRoot, 'test-results');
const bundleRoot = resolve(testResultsRoot, 'selected-homepage-bundles');

if (dirname(bundleRoot) !== testResultsRoot) {
  throw new Error('Refusing to clear bundle evidence outside test-results.');
}

const originalConceptHashes = new Map([
  ['src/pages/design-lab/AuthorityPipeline.tsx', 'dea6aef608c0620ece0b17840d2c84bcac23e7e8'],
  ['src/pages/design-lab/SchedulingKernel.tsx', '36832f105b14892f1a6870c217f7f5847036bb85'],
  ['src/pages/design-lab/OwnBookingFlow.tsx', '6981e0fd13c9615de174510570557be4a6da7e9c'],
]);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runViteBuild = (audience, outputDirectory) => new Promise((resolveRun, rejectRun) => {
  const viteExecutable = fileURLToPath(new URL('../../bin/vite.js', import.meta.resolve('vite')));
  const child = spawn(
    process.execPath,
    [viteExecutable, 'build', '--outDir', relative(repositoryRoot, outputDirectory), '--emptyOutDir'],
    {
      cwd: repositoryRoot,
      env: { ...process.env, VITE_PROJECT_S_DEPLOYMENT_AUDIENCE: audience },
      shell: false,
      stdio: 'inherit',
    },
  );
  child.once('error', rejectRun);
  child.once('exit', (code, signal) => {
    if (code === 0) {
      resolveRun();
      return;
    }
    rejectRun(new Error(signal ? `Vite stopped after ${signal}.` : `Vite exited with code ${code ?? 'unknown'}.`));
  });
});

const listFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
};

for (const [path, expectedHash] of originalConceptHashes) {
  const { stdout } = await execFile('git', ['hash-object', path], { cwd: repositoryRoot });
  assert(stdout.trim() === expectedHash, `${path} changed from the approved design-lab base.`);
}

await rm(bundleRoot, { recursive: true, force: true });
const hostedDirectory = resolve(bundleRoot, 'hosted');
const selfHostedDirectory = resolve(bundleRoot, 'self-hosted');

await runViteBuild('hosted', hostedDirectory);
await runViteBuild('self-hosted', selfHostedDirectory);

const hostedFiles = await listFiles(hostedDirectory);
const selfHostedFiles = await listFiles(selfHostedDirectory);
const hostedNames = hostedFiles.map((path) => relative(hostedDirectory, path));
const selfHostedNames = selfHostedFiles.map((path) => relative(selfHostedDirectory, path));
const hostedSource = (await Promise.all(hostedFiles.filter((path) => /\.(?:html|js|css)$/.test(path)).map((path) => readFile(path, 'utf8')))).join('\n');
const selfHostedSource = (await Promise.all(selfHostedFiles.filter((path) => /\.(?:html|js|css)$/.test(path)).map((path) => readFile(path, 'utf8')))).join('\n');

assert(hostedNames.some((name) => /SelectedDirection-.*\.js$/.test(name)), 'Hosted build is missing the selected-direction chunk.');
for (const concept of ['AuthorityPipeline', 'SchedulingKernel', 'OwnBookingFlow']) {
  assert(hostedNames.some((name) => new RegExp(`${concept}-.*\\.js$`).test(name)), `Hosted build is missing ${concept}.`);
}
assert(hostedSource.includes('People define authority'), 'Hosted bundle is missing the selected north-star claim.');

for (const chunk of ['SelectedDirection', 'AuthorityPipeline', 'SchedulingKernel', 'OwnBookingFlow', 'Index-', 'Features-', 'About-', 'Navbar-', 'Footer-']) {
  assert(!selfHostedNames.some((name) => name.includes(chunk)), `Self-hosted build leaked hosted-only chunk ${chunk}.`);
}
for (const claim of [
  'People define authority',
  'Selected concept navigation',
  'Future direction · not available today',
  'Project S Cloud',
]) {
  assert(!selfHostedSource.includes(claim), `Self-hosted bundle leaked hosted-only copy: ${claim}`);
}

console.log(`Hosted bundle files: ${hostedNames.length}`);
console.log(`Self-hosted bundle files: ${selfHostedNames.length}`);
console.log('Selected homepage is present only in the hosted bundle; approved Project S concept hashes are unchanged.');
