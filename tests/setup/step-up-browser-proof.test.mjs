import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
import { startStepUpBrowserProof } from '../../scripts/lib/step-up-browser-proof.mjs';

// Lifecycle unit tests only. These do not claim real Auth, browser UI or SQL
// evidence; the guarded live proof must use the actual unpatched launcher.
const failure = 'Synthetic approval browser assertion failed.';
const options = {
  origin: 'http://127.0.0.1:54321',
  owner: { email: 'owner@example.invalid', password: 'synthetic-only' },
  other: { email: 'other@example.invalid', password: 'synthetic-only' },
};
const withLauncher = async (browser, operation) => {
  const launch = chromium.launch;
  chromium.launch = async () => browser;
  try { await operation(); }
  finally { chromium.launch = launch; }
};

test('browser proof requires successful browser.close even when transport bookkeeping is empty', async () => {
  let calls = 0;
  await withLauncher({
    isConnected: () => false,
    contexts: () => [],
    close: async () => { calls++; throw new Error('private underlying diagnostic'); },
  }, async () => {
    const proof = await startStepUpBrowserProof(options);
    const closing = proof.close();
    assert.equal(proof.close(), closing);
    await assert.rejects(closing, { message: failure });
    assert.equal(proof.close(), closing, 'A failed close must not later claim success');
    assert.equal(calls, 1);
  });
});

test('browser proof close remains pending until successful shutdown and is idempotent', async () => {
  let release;
  let connected = true;
  let calls = 0;
  const completion = new Promise((resolve) => { release = resolve; });
  await withLauncher({
    isConnected: () => connected,
    contexts: () => [],
    close: async () => { calls++; await completion; connected = false; },
  }, async () => {
    const proof = await startStepUpBrowserProof(options);
    let returned = false;
    const closing = proof.close();
    const result = closing.then(() => { returned = true; });
    assert.equal(proof.close(), closing);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(returned, false);
    release();
    await result;
    assert.equal(returned, true);
    assert.equal(connected, false);
    assert.equal(calls, 1);
  });
});

test('browser proof accepts a settled context-close race only after successful browser shutdown and cleared pages', async () => {
  const context = {
    close: async () => { throw new Error('Synthetic already closed context'); },
    pages: () => [],
  };
  let connected = true;
  let owned = [context];
  await withLauncher({
    isConnected: () => connected,
    contexts: () => owned,
    close: async () => { connected = false; owned = []; },
  }, async () => {
    const proof = await startStepUpBrowserProof(options);
    await proof.close();
    assert.equal(connected, false);
    assert.equal(owned.length, 0);
  });
});

test('browser proof close rejects within its fixed deadline if shutdown never completes', async () => {
  await withLauncher({
    isConnected: () => false,
    contexts: () => [],
    close: async () => new Promise(() => undefined),
  }, async () => {
    const proof = await startStepUpBrowserProof(options);
    const started = performance.now();
    const closing = proof.close();
    await assert.rejects(closing, { message: failure });
    assert(performance.now() - started < 15_000);
    assert.equal(proof.close(), closing);
  });
});
