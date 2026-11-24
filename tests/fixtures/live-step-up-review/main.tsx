import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { v2UuidSchema } from '@project-s/contracts/v2';
import { Button } from '@/components/ui/button';
import StepUpReview from '@/features/step-up-review/StepUpReview';
import { useAuth } from '@/hooks/useAuth';
import { authRoute } from '@/lib/auth';
import Login from '@/pages/Login';
import { createStepUpReviewClient } from '@/services/stepUpReviewClient';
import '@/index.css';

// This entry is built and served only by the guarded disposable browser proof.
// Ordinary App routes and the production build never import it.
export function LiveReview() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, user, loading, handleSignOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const token = session?.access_token;
  const principalId = user?.id;
  const nonAnonymous = user?.is_anonymous === false && session?.user.id === principalId;
  const client = useMemo(() => (
    token && principalId && nonAnonymous
      ? createStepUpReviewClient({ baseUrl: window.location.origin, accessToken: token })
      : null
  ), [token, principalId, nonAnonymous]);
  const match = /^#review=([0-9a-f-]{36})$/.exec(location.hash);
  const reference = v2UuidSchema.safeParse(match?.[1]);
  const reviewId = !location.search && reference.success ? reference.data : '';
  const destination = location.pathname + location.search + location.hash;
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try { await handleSignOut(); } finally { setSigningOut(false); }
  };

  return (
    <>
      {client && !loading && !signingOut && (
        <div className="mx-auto flex max-w-2xl justify-end px-4 sm:px-6">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void signOut()}>Sign out</Button>
        </div>
      )}
      {loading ? <p role="status" className="mx-auto max-w-2xl p-6">Checking your sign-in…</p> : (
        <StepUpReview
          reviewId={reviewId}
          sessionKey={!signingOut && client && principalId ? principalId : null}
          client={signingOut ? null : client}
          onSignIn={() => navigate(authRoute('/login', destination))}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <main className="min-h-screen bg-background py-6 text-foreground sm:py-10">
      <aside aria-label="Synthetic local browser proof" className="mx-auto mb-6 max-w-2xl rounded-lg border border-dashed p-4 text-sm">
        <p className="font-semibold">Synthetic local browser proof</p>
        <p className="mt-1 text-muted-foreground">Disposable accounts and local test data. This records permission decisions; it does not enable the normal approval link or complete a booking.</p>
      </aside>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/authority/review" element={<LiveReview />} />
        <Route path="*" element={<p className="mx-auto max-w-2xl p-6">This page is not part of the local proof.</p>} />
      </Routes>
      <Toaster />
    </main>
  </BrowserRouter>,
);
