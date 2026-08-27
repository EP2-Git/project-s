#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const repositoryRoot = process.cwd();
const captureRoot = resolve(
  repositoryRoot,
  'test-results',
  'authority-boundary-demo',
);
const expectedParent = resolve(repositoryRoot, 'test-results');

if (dirname(captureRoot) !== expectedParent) {
  throw new Error('Refusing to clear captures outside test-results.');
}

const executable = (name) =>
  process.platform === 'win32' ? `${name}.cmd` : name;

const run = (command, args, environment = process.env) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable(command), args, {
      cwd: repositoryRoot,
      env: environment,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          signal
            ? `${command} stopped after ${signal}.`
            : `${command} exited with code ${code ?? 'unknown'}.`,
        ),
      );
    });
  });

try {
  await rm(captureRoot, { recursive: true, force: true });
  await run('npm', ['run', 'db:reset']);
  await run(
    'npx',
    [
      'playwright',
      'test',
      'tests/e2e/authority-boundary-demo.spec.ts',
      '--project=chromium',
    ],
    { ...process.env, PROJECT_S_AUTHORITY_CAPTURE: '1' },
  );
  console.log(`Authority Boundary Demo captures: ${captureRoot}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
