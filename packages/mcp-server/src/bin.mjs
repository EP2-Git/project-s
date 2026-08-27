#!/usr/bin/env node

import { loadProjectSMcpRuntime } from './runtime.mjs';
import { createProjectSMcpServer } from './server.mjs';
import { runStdioServer } from './stdio.mjs';

try {
  const runtime = await loadProjectSMcpRuntime();
  const server = createProjectSMcpServer({
    tools: runtime.tools,
    diagnostics(event) {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
  });
  await runStdioServer({ server });
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Project S MCP failed to start: ${message}\n`);
  process.exitCode = 1;
}
