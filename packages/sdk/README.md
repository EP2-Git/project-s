# `@project-s/sdk`

Typed HTTP access to the four current Project S Core pre-alpha public booking
operations. The `v1` suffix identifies the current wire contract; no
compatibility guarantee is made.

```ts
import { createProjectSClient, ProjectSApiError } from '@project-s/sdk';

const projectS = createProjectSClient({ baseUrl: 'https://project-s.example' });

try {
  const result = await projectS.public.getBookingPage({ username: 'demo-host' });
  console.log(result.requestId, result.data.meetingTypes);
} catch (error) {
  if (error instanceof ProjectSApiError) console.error(error.problem.code);
}
```

Methods retain the versioned success envelope. Canonical server failures throw `ProjectSApiError`; malformed responses throw `ProjectSProtocolError`; network failures throw `ProjectSTransportError`. The client never calls Supabase or a database RPC.
