import { createInterface } from 'node:readline';
import { jsonRpcError } from './server.mjs';

const MAX_MESSAGE_BYTES = 1024 * 1024;

export const runStdioServer = async ({
  server,
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
}) => {
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  let writes = Promise.resolve();

  const writeMessage = (message) => {
    if (message === null) return;
    const payload = `${JSON.stringify(message)}\n`;
    writes = writes.then(
      () =>
        new Promise((resolve, reject) => {
          output.write(payload, (error) => (error ? reject(error) : resolve()));
        }),
    );
  };

  for await (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
      writeMessage(jsonRpcError(undefined, -32600, 'Invalid Request'));
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeMessage(jsonRpcError(undefined, -32700, 'Parse error'));
      continue;
    }

    const work = server
      .handle(message)
      .then(writeMessage)
      .catch(() => {
        try {
          diagnostics.write('Project S MCP failed to process a protocol message.\n');
        } catch {
          // Diagnostics must not affect the protocol response.
        }
        writeMessage(jsonRpcError(message?.id, -32603, 'Internal error'));
      })
      .finally(() => pending.delete(work));
    pending.add(work);
  }

  server.cancelAll();
  await Promise.allSettled(pending);
  await writes;
};
