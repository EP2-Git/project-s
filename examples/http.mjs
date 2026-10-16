import {
  operationRegistryById, PROJECT_S_CONTRACT_MEDIA_TYPE, PROJECT_S_PROBLEM_MEDIA_TYPE,
} from '@project-s/contracts';
import { bindings } from './fixture.mjs';
import { ExampleProblem, localApiBaseUrl, runCli } from './shared.mjs';

export function createHttpTransport(baseUrl) {
  const origin = localApiBaseUrl(baseUrl);
  return Object.fromEntries(Object.entries(bindings).map(([name, binding]) => [name, async (input) => {
    const operation = operationRegistryById[binding.id];
    const parsed = operation.inputSchema.parse(input);
    const path = binding.path.replace('{username}', encodeURIComponent(parsed.username ?? ''));
    const response = await fetch(`${origin}${path}`, {
      method: binding.method, credentials: 'omit', signal: AbortSignal.timeout(20_000),
      headers: {
        accept: `${PROJECT_S_CONTRACT_MEDIA_TYPE}, ${PROJECT_S_PROBLEM_MEDIA_TYPE}`,
        ...(binding.method === 'POST' ? { 'content-type': PROJECT_S_CONTRACT_MEDIA_TYPE } : {}),
      },
      ...(binding.method === 'POST' ? { body: JSON.stringify(parsed) } : {}),
    });
    const body = await response.json();
    if (!response.ok) {
      const failure = new ExampleProblem(body);
      if (failure.problem.status !== response.status) throw new Error('Problem status mismatch.');
      throw failure;
    }
    if (response.status !== operation.http.successStatus) throw new Error('Unexpected success status.');
    return operation.successSchema.parse(body);
  }]));
}

await runCli(import.meta.url, createHttpTransport);
