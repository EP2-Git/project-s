#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [audience = 'self-hosted', port = '4173'] = process.argv.slice(2);

if (!['hosted', 'self-hosted'].includes(audience)) {
  throw new Error(`Unsupported deployment audience: ${audience}`);
}

if (!/^\d{2,5}$/.test(port)) {
  throw new Error(`Invalid Vite port: ${port}`);
}

const viteExecutable = fileURLToPath(
  new URL('../../bin/vite.js', import.meta.resolve('vite')),
);
const child = spawn(
  process.execPath,
  [viteExecutable, '--host', '127.0.0.1', '--port', port],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_PROJECT_S_DEPLOYMENT_AUDIENCE: audience,
    },
    shell: false,
    stdio: 'inherit',
  },
);

const forward = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.once('SIGINT', () => forward('SIGINT'));
process.once('SIGTERM', () => forward('SIGTERM'));
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
