#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = process.cwd();
const captureRoot = resolve(repositoryRoot, 'test-results', 'hosted-homepage-lab');
const expectedParent = resolve(repositoryRoot, 'test-results');

if (dirname(captureRoot) !== expectedParent) {
  throw new Error('Refusing to clear captures outside test-results.');
}

const playwrightCli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
const runPlaywright = (args, environment = process.env) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [playwrightCli, ...args], {
    cwd: repositoryRoot,
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  child.once('error', rejectRun);
  child.once('exit', (code, signal) => {
    if (code === 0) {
      resolveRun();
      return;
    }
    rejectRun(new Error(signal ? `Playwright stopped after ${signal}.` : `Playwright exited with code ${code ?? 'unknown'}.`));
  });
});

try {
  await rm(captureRoot, { recursive: true, force: true });
  await runPlaywright(
    ['test', '--config=playwright.design-lab.config.ts', '--project=chromium'],
    { ...process.env, PROJECT_S_HOMEPAGE_LAB_CAPTURE: '1' },
  );
  console.log(`Hosted homepage lab captures: ${captureRoot}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
