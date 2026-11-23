import { once } from 'node:events';
import { createServer } from 'node:http';

// Disposable proof adapter only. It has no authority configuration, credentials,
// routes or default handler; the guarded caller supplies the actual factories.
const failure = 'Synthetic HTTP proof request failed.';
const ignore = () => undefined;
const requestBody = (incoming) => {
  let dispose = ignore;
  return new ReadableStream({
    start(controller) {
      incoming.pause();
      const clean = () => {
        incoming.off('data', data);
        incoming.off('end', end);
        incoming.off('error', error);
      };
      const data = (chunk) => {
        controller.enqueue(chunk);
        if (controller.desiredSize <= 0) incoming.pause();
      };
      const end = () => { clean(); controller.close(); };
      const error = () => { clean(); controller.error(new Error(failure)); };
      incoming.on('data', data);
      incoming.once('end', end);
      incoming.once('error', error);
      // Store only stream-local disposal, never buffered request contents.
      dispose = () => { clean(); incoming.pause(); };
    },
    pull() { incoming.resume(); },
    cancel() {
      // A bounded parser may deliberately cancel before returning 413. Destroying
      // IncomingMessage here would also destroy its outgoing refusal response.
      dispose();
    },
  }, { highWaterMark: 0 });
};
const endResponse = (response, body) => new Promise((resolve) => {
  const done = () => { response.off('close', done); resolve(); };
  response.once('close', done);
  response.end(body, done);
});
const fixedResponse = async (response, status) => {
  if (response.destroyed || response.headersSent) { response.destroy(); return; }
  response.writeHead(status, {
    'content-type': 'application/json', 'cache-control': 'no-store',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', connection: 'close',
  });
  await endResponse(response, JSON.stringify({ error: failure }));
};

const sendResponse = async (outgoing, response, signal, method) => {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) {
    // This proof listener never grants CORS or upgrades a connection.
    if (!name.startsWith('access-control-') &&
        !['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'trailer'].includes(name)) {
      outgoing.setHeader(name, value);
    }
  }
  // Avoid idle pooled connections outliving this short, test-only listener.
  outgoing.setHeader('connection', 'close');
  if (!response.body || method === 'HEAD') {
    await response.body?.cancel();
    await endResponse(outgoing);
    return;
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) cancel();
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted || outgoing.destroyed) break;
      if (!outgoing.write(value)) await once(outgoing, 'drain', { signal });
    }
    if (!signal.aborted && !outgoing.destroyed) await endResponse(outgoing);
  } finally {
    signal.removeEventListener('abort', cancel);
    if (signal.aborted) cancel();
    reader.releaseLock();
  }
};

export const startStepUpHttpProof = async ({ handler, dropResponse, timeoutMs = 10_000 } = {}) => {
  if (typeof handler !== 'function' ||
      (dropResponse !== undefined && typeof dropResponse !== 'function') ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new TypeError('Invalid synthetic HTTP proof options.');
  }
  let origin;
  let closing;
  const sockets = new Set();
  const active = new Set();
  const tasks = new Set();
  const server = createServer({ maxHeaderSize: 16_384 }, (incoming, outgoing) => {
    const controller = new AbortController();
    active.add(controller);
    const cancel = () => controller.abort();
    const onClose = () => { if (!outgoing.writableFinished) cancel(); };
    const timeout = setTimeout(cancel, timeoutMs);
    timeout.unref();
    const onAbort = () => { clearTimeout(timeout); outgoing.destroy(); };
    controller.signal.addEventListener('abort', onAbort, { once: true });
    incoming.once('aborted', cancel);
    // Closing after an intentionally unread body can report an input error;
    // its diagnostics must not be logged or become an unhandled emitter error.
    incoming.on('error', ignore);
    outgoing.once('close', onClose);
    let request;
    const task = (async () => {
      try {
        const target = incoming.url ?? '';
        if (closing || !origin) { await fixedResponse(outgoing, 503); return; }
        if (incoming.socket.remoteAddress !== '127.0.0.1' || incoming.headers.host !== new URL(origin).host ||
            !target.startsWith('/') || target.startsWith('//') || target.includes('#')) {
          await fixedResponse(outgoing, 400); return;
        }
        const url = new URL(target, origin);
        if (url.href !== `${origin}${target}`) { await fixedResponse(outgoing, 400); return; }
        const noBody = incoming.method === 'GET' || incoming.method === 'HEAD';
        if (noBody && ((incoming.headers['content-length'] !== undefined && incoming.headers['content-length'] !== '0') ||
            incoming.headers['transfer-encoding'] !== undefined)) {
          await fixedResponse(outgoing, 400); return;
        }
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        }
        request = new Request(url, {
          method: incoming.method, headers, signal: controller.signal,
          ...(noBody ? {} : { body: requestBody(incoming), duplex: 'half' }),
        });
        const response = await handler(request);
        if (!(response instanceof Response)) throw new TypeError(failure);
        if (controller.signal.aborted || outgoing.destroyed) {
          await response.body?.cancel().catch(() => undefined); return;
        }
        // Deliberately lose bytes only AFTER the awaited handler completed.
        // The guarded live caller selects the successful SQL-backed response.
        if (dropResponse?.(request, response)) {
          await response.body?.cancel().catch(() => undefined);
          outgoing.destroy();
          return;
        }
        await sendResponse(outgoing, response, controller.signal, incoming.method);
      } catch {
        await fixedResponse(outgoing, 500);
      } finally {
        clearTimeout(timeout);
        incoming.off('aborted', cancel);
        outgoing.off('close', onClose);
        controller.signal.removeEventListener('abort', onAbort);
        active.delete(controller);
        // Rejected-before-body actions must release the bridge's input stream
        // after the fixed response has finished; never buffer it to dispatch.
        if (request?.body && !request.body.locked) {
          void request.body.cancel().catch(() => undefined);
        }
      }
    })();
    tasks.add(task);
    // Track actual completion, not just whether the request was signalled.
    // Supplied Auth/RPC work may continue after its HTTP caller disconnects.
    void task.then(() => tasks.delete(task), () => tasks.delete(task));
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = timeoutMs;
  server.keepAliveTimeout = 1;
  server.on('connection', (socket) => {
    sockets.add(socket);
    // Node checks headersTimeout periodically; impose our own absolute limit
    // so a partial-header peer cannot outlive this disposable proof deadline.
    const deadline = setTimeout(() => socket.destroy(), timeoutMs);
    deadline.unref();
    socket.once('close', () => { clearTimeout(deadline); sockets.delete(socket); });
    socket.on('error', () => undefined);
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    const fail = () => { reject(new Error(failure)); };
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail);
      const address = server.address();
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
  server.on('error', () => {
    for (const controller of active) controller.abort();
    for (const socket of sockets) socket.destroy();
  });
  return {
    origin,
    close: () => {
      if (closing) return closing;
      const transportClosed = new Promise((resolve, reject) => {
        for (const controller of active) controller.abort();
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(new Error(failure));
          else resolve();
        });
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
      const quiescent = async () => {
        await transportClosed;
        while (tasks.size > 0) await Promise.allSettled([...tasks]);
      };
      let deadline;
      const expired = new Promise((_resolve, reject) => {
        // Keep this timer referenced: closed sockets and an unresolved Promise
        // alone do not keep Node alive long enough to report a failed close.
        deadline = setTimeout(() => reject(new Error(failure)), timeoutMs + 1_000);
      });
      closing = Promise.race([quiescent(), expired]).finally(() => clearTimeout(deadline));
      return closing;
    },
  };
};
