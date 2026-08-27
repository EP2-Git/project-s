import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runStdioServer } from '../src/stdio.mjs';

test('stdio emits only newline-delimited JSON-RPC and keeps diagnostics off stdout', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = new PassThrough();
  let stdout = '';
  let stderr = '';
  output.setEncoding('utf8');
  diagnostics.setEncoding('utf8');
  output.on('data', (chunk) => {
    stdout += chunk;
  });
  diagnostics.on('data', (chunk) => {
    stderr += chunk;
  });

  const server = {
    async handle(message) {
      if (message.method === 'explode') throw new Error('private diagnostics');
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { resultType: 'complete' },
      };
    },
    cancelAll() {},
  };

  const running = runStdioServer({ server, input, output, diagnostics });
  input.write('{not-json}\n');
  input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  input.write('{"jsonrpc":"2.0","id":2,"method":"explode"}\n');
  input.end();
  await running;

  const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((message) => message.error?.code ?? message.result?.resultType),
    [-32700, 'complete', -32603],
  );
  assert.match(stderr, /failed to process/);
  assert.doesNotMatch(stdout, /failed to process|private diagnostics/);
});
