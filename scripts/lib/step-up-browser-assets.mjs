import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react-swc';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const failure = 'Synthetic browser assets could not be prepared.';
const anonKey = (key) => {
  if (typeof key !== 'string' || key.length < 1 || key.length > 4_096 || /\s/.test(key)) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    // A bundling guard against accidentally exposing a service credential,
    // never JWT verification or an authenticated-user/authority decision.
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon';
  } catch { return false; }
};

const mimeType = (name) => name.endsWith('.js') ? 'application/javascript; charset=utf-8'
  : name.endsWith('.css') ? 'text/css; charset=utf-8'
  : name.endsWith('.svg') ? 'image/svg+xml'
  : name.endsWith('.png') ? 'image/png'
  : name.endsWith('.webp') ? 'image/webp'
  : name.endsWith('.woff2') ? 'font/woff2'
  : null;

/** Builds actual UI modules in memory; neither serves nor enables an App route. */
export const buildStepUpBrowserAssets = async ({ supabaseUrl, supabasePublishableKey } = {}) => {
  if (supabaseUrl !== 'http://127.0.0.1:54321' || !anonKey(supabasePublishableKey)) {
    throw new TypeError('Invalid synthetic browser asset options.');
  }
  const files = new Map();
  let html;
  try {
    const result = await build({
      configFile: false,
      envFile: false,
      envPrefix: '__PROJECT_S_BROWSER_PROOF_NO_ENV__',
      root,
      publicDir: false,
      logLevel: 'silent',
      plugins: [react()],
      resolve: { alias: { '@': resolve(root, 'src') } },
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
        'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(supabasePublishableKey),
        'import.meta.env.VITE_PROJECT_S_API_URL': 'undefined',
        'import.meta.env.VITE_PROJECT_S_TURNSTILE_SITE_KEY': 'undefined',
        'import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE': JSON.stringify('self-hosted'),
      },
      build: {
        write: false,
        emptyOutDir: false,
        sourcemap: false,
        assetsInlineLimit: 0,
        rolldownOptions: {
          input: resolve(root, 'tests/fixtures/live-step-up-review/index.html'),
          output: {
            entryFileNames: 'assets/live-approval-[hash].js',
            chunkFileNames: 'assets/live-approval-chunk-[hash].js',
            assetFileNames: 'assets/live-approval-[hash][extname]',
          },
        },
      },
    });
    if (Array.isArray(result) || !result || !Array.isArray(result.output)) throw new Error(failure);
    for (const item of result.output) {
      if (item.type === 'asset' && item.fileName === 'tests/fixtures/live-step-up-review/index.html') {
        if (html !== undefined) throw new Error(failure);
        html = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
        continue;
      }
      const type = mimeType(item.fileName);
      if (!type || !/^assets\/live-approval-[A-Za-z0-9_.-]+$/.test(item.fileName)) throw new Error(failure);
      files.set(`/${item.fileName}`, { type, body: item.type === 'chunk' ? item.code : item.source });
    }
    if (typeof html !== 'string' || !html.includes('/assets/live-approval-')) throw new Error(failure);
    files.set('/favicon.svg', { type: 'image/svg+xml', body: await readFile(resolve(root, 'public/favicon.svg')) });
  } catch {
    files.clear();
    throw new Error(failure);
  }
  let closed = false;
  return {
    handle(request) {
      if (closed || !['GET', 'HEAD'].includes(request.method)) return null;
      const url = new URL(request.url);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.hash) return null;
      const page = url.pathname === '/login' ||
        (url.pathname === '/authority/review' && !request.url.includes('?'));
      const file = page ? { type: 'text/html; charset=utf-8', body: html }
        : request.url.includes('?') ? undefined : files.get(url.pathname);
      if (!file) return null;
      return new Response(request.method === 'HEAD' ? null : file.body, { headers: {
        'content-type': file.type,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      } });
    },
    async close() { closed = true; html = undefined; files.clear(); },
  };
};
