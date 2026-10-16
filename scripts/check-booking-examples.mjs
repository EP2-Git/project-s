import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'vite';

// Real local Edge API proof, separate from the mocked transport contract tests.
// Use a temporary app proxy so CI doesn't need a separately managed Vite process.
const server = await createServer({
  configFile: 'vite.config.ts', logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
try {
  await server.listen();
  const address = server.httpServer.address();
  for (const entry of ['examples/http.mjs', '.cache/booking-examples/sdk.js', 'examples/mcp.mjs']) {
    try {
      const { stdout } = await promisify(execFile)(process.execPath, [entry], {
        env: { ...process.env, PROJECT_S_API_BASE_URL: `http://127.0.0.1:${address.port}` },
        windowsHide: true, timeout: 120_000, maxBuffer: 16_384,
      });
      if (!stdout.includes('Create refused: CONFIRMATION_REQUIRED (428)')
        || !stdout.includes('Stopped before browser approval; this example did not commit a booking.')) {
        throw new Error('Example exited without completing its assertions.');
      }
      console.log(`${entry}\n${stdout.trim()}`);
    } catch { throw new Error(`Live local example failed: ${entry}. Child diagnostics withheld.`); }
  }
} finally { await server.close(); }
