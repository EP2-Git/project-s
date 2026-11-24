import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildStepUpBrowserAssets } from '../../scripts/lib/step-up-browser-assets.mjs';

// Compilation-only fixtures; none of these keys authenticates a test account.
const jwt = (role) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic`;
const publicKey = jwt('anon');
const options = { supabaseUrl: 'http://127.0.0.1:54321', supabasePublishableKey: publicKey };
const origin = 'http://127.0.0.1:4173';

test('browser assets reject nonlocal endpoints and nonpublic credentials before bundling', async () => {
  for (const supabaseUrl of [undefined, 'https://example.invalid', 'http://localhost:54321',
    'http://127.0.0.1:54322', 'http://127.0.0.1:54321/', 'http://127.0.0.1:54321?local']) {
    await assert.rejects(buildStepUpBrowserAssets({ ...options, supabaseUrl }), {
      name: 'TypeError', message: 'Invalid synthetic browser asset options.',
    });
  }
  for (const supabasePublishableKey of [undefined, '', ' ', 'not-a-public-key', jwt('service_role'),
    jwt('authenticated'), 'sb_secret_synthetic', `${publicKey}\n`]) {
    await assert.rejects(buildStepUpBrowserAssets({ ...options, supabasePublishableKey }), {
      name: 'TypeError', message: 'Invalid synthetic browser asset options.',
    });
  }
});

test('actual browser bundle serves only fixture routes and emitted allowlisted assets', async () => {
  const privateMarker = 'synthetic-env-secret-must-not-enter-this-bundle';
  const names = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_PROJECT_S_API_URL', 'VITE_PRIVATE_PROOF_MARKER'];
  const previous = names.map((name) => [name, process.env[name]]);
  for (const name of names) process.env[name] = privateMarker;
  let assets;
  try {
    assets = await buildStepUpBrowserAssets(options);
    const review = assets.handle(new Request(`${origin}/authority/review`));
    assert.equal(review.status, 200);
    assert.equal(review.headers.get('cache-control'), 'no-store');
    assert.equal(review.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(review.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(review.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(review.headers.get('access-control-allow-origin'), null);
    const html = await review.text();
    const login = assets.handle(new Request(`${origin}/login?returnTo=%2Fauthority%2Freview%23review%3Dbbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`));
    assert.equal(await login.text(), html);
    const paths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    assert(paths.some((path) => /^\/assets\/live-approval-[A-Za-z0-9_.-]+\.js$/.test(path)));
    assert(paths.some((path) => /^\/assets\/live-approval-[A-Za-z0-9_.-]+\.css$/.test(path)));
    assert(paths.every((path) => path === '/favicon.svg' || /^\/assets\/live-approval-[A-Za-z0-9_.-]+$/.test(path)));
    let scripts = '';
    for (const path of paths) {
      const response = assets.handle(new Request(`${origin}${path}`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      if (path.endsWith('.js')) scripts += await response.text();
    }
    assert(scripts.includes('Synthetic local browser proof'));
    assert(scripts.includes('Review this meeting'));
    assert(scripts.includes('Welcome back'));
    assert(scripts.includes(publicKey));
    assert(!scripts.includes(privateMarker));
    assert.equal(await assets.handle(new Request(`${origin}/authority/review`, { method: 'HEAD' })).text(), '');
    for (const path of ['/authority/review?principal=override', '/authority/review?', '/signup', '/', '/dashboard',
      '/.env', '/src/main.tsx', '/@fs/C:/private', '/tests/fixtures/live-step-up-review/index.html',
      '/assets/unknown.js', '/assets/unknown.js.map', '/api/v2/authority/step-ups/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      `${paths[0]}?anything=1`]) {
      assert.equal(assets.handle(new Request(`${origin}${path}`)), null, `Unexpected asset route: ${path}`);
    }
    assert.equal(assets.handle(new Request(`${origin}/authority/review`, { method: 'POST', body: 'private' })), null);
    assert.equal(assets.handle(new Request('https://example.invalid/login')), null);
    await assets.close();
    assert.equal(assets.handle(new Request(`${origin}/login`)), null);
    assert.equal(assets.handle(new Request(`${origin}${paths[0]}`)), null);
  } finally {
    await assets?.close();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('the fixture stays separate from normal application and Vite entrypoints', async () => {
  for (const path of ['../../src/main.tsx', '../../src/App.tsx', '../../vite.config.ts', '../../index.html']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert(!source.includes('live-step-up-review'));
    assert(!source.includes('step-up-browser-assets'));
  }
  const app = await readFile(new URL('../../src/App.tsx', import.meta.url), 'utf8');
  assert(!app.includes('path="/authority/review"'));
});
