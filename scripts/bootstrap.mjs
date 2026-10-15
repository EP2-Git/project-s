#!/usr/bin/env node
import { runBootstrap } from './lib/local-setup.mjs';

const args = process.argv.slice(2);
if (args.some((arg) => !['--reuse', '--skip-install'].includes(arg))) {
  console.error('Usage: npm run bootstrap -- [--reuse] [--skip-install]');
  process.exitCode = 1;
} else {
  try { await runBootstrap({ reuse: args.includes('--reuse'), skipInstall: args.includes('--skip-install') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
