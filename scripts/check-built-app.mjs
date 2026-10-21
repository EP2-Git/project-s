#!/usr/bin/env node
import assert from 'node:assert/strict';
import { build, preview } from 'vite';
import { chromium, firefox, webkit } from '@playwright/test';

// Exercise the shipped module graph, not Vite's development dependency graph.
// All configuration is synthetic; this smoke test never authenticates or books.
const outDir = 'test-results/built-app-smoke';
await build({
  logLevel: 'warn',
  build: { outDir, emptyOutDir: true },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('synthetic-built-app-smoke'),
    'import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE': JSON.stringify('self-hosted'),
  },
});
const server = await preview({
  logLevel: 'warn',
  build: { outDir },
  preview: { host: '127.0.0.1', port: 4193, strictPort: true },
});

try {
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const [route, heading] of [
        ['/login', 'Welcome back'],
        ['/signup', 'Create your account'],
        ['/demo', 'Authority Boundary Demo'],
        ['/demo/mandates', 'Authority Lab'],
        ['/booking/confirm', 'Review a prepared booking'],
      ]) {
        await page.goto(`http://127.0.0.1:4193${route}`);
        await page.getByRole('heading', { name: heading, exact: true }).waitFor();
        assert.deepEqual(errors, [], `${name} ${route}: production module errors`);
      }
      console.log(`${name}: production login, signup, demo, Authority Lab and confirmation render without module errors.`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
}
