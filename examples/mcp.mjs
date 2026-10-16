import { operationRegistryById, projectSProblemEnvelopeSchema } from '@project-s/contracts';
import { createProjectSMcpClient, PROJECT_S_MCP_PROTOCOL_VERSION } from '../scripts/lib/project-s-mcp-client.mjs';
import { bindings } from './fixture.mjs';
import { ExampleProblem, localApiBaseUrl, runCli } from './shared.mjs';

export async function createMcpTransport(baseUrl) {
  const client = createProjectSMcpClient({ baseUrl: localApiBaseUrl(baseUrl), clientName: 'project-s-local-example' });
  try {
    const discovery = await client.discover();
    if (!discovery.supportedVersions.includes(PROJECT_S_MCP_PROTOCOL_VERSION)) throw new Error('MCP version mismatch.');
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    if (JSON.stringify(names) !== JSON.stringify(Object.values(bindings).map((binding) => binding.tool).sort())) {
      throw new Error('MCP tool registry drift.');
    }
    return {
      ...Object.fromEntries(Object.entries(bindings).map(([name, binding]) => [name, async (input) => {
        const operation = operationRegistryById[binding.id];
        const result = await client.callTool(binding.tool, operation.inputSchema.parse(input));
        if (result.isError) throw new ExampleProblem(projectSProblemEnvelopeSchema.parse(result.structuredContent).error);
        return operation.successSchema.parse(result.structuredContent);
      }])),
      close: () => client.close(),
    };
  } catch (error) { await client.close(); throw error; }
}

await runCli(import.meta.url, createMcpTransport);
