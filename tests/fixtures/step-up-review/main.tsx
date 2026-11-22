import { createRoot } from 'react-dom/client';
import StepUpReview from '@/features/step-up-review/StepUpReview';
import { createStepUpReviewClient } from '@/services/stepUpReviewClient';
import '@/index.css';

// Test-only entry: it is not imported by App or a production build entry.
// Playwright supplies synthetic HTTP responses, not a real account or SQL.
const client = createStepUpReviewClient({
  baseUrl: window.location.origin,
  accessToken: 'synthetic-component-account-token',
});

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10">
    <aside className="mx-auto mb-6 max-w-2xl rounded-lg border border-dashed p-4 text-sm">
      <p className="font-semibold">Synthetic component/client test</p>
      <p className="mt-1 text-muted-foreground">
        Test data and mocked HTTP only. This does not authenticate a person, create a booking,
        or enable the public approval link.
      </p>
    </aside>
    <StepUpReview
      reviewId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      sessionKey="synthetic-test-session"
      client={client}
    />
  </main>,
);
