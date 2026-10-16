import { createProjectSClient, type ProjectSPublicClient } from '@project-s/sdk';
import { localApiBaseUrl, runCli } from './shared.mjs';

export function createSdkTransport(baseUrl: string): ProjectSPublicClient {
  const client = createProjectSClient({
    baseUrl: localApiBaseUrl(baseUrl), credentials: 'omit',
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
  });
  // Shared workflow calls client.public.getBookingPage, listFreeSlots,
  // prepareBooking and createBooking. SDK failures expose a canonical .problem.
  return client.public;
}

await runCli(import.meta.url, createSdkTransport);
