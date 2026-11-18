import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoute, getAuthReturnTo } from '@/lib/auth';
import { useAuth } from '@/hooks/useAuth';
import Login from '@/pages/Login';
import EmailVerification from '@/pages/EmailVerification';
import Signup from '@/pages/Signup';
import { PrivateRoute } from '@/App';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  listeners: [] as Array<(event: AuthChangeEvent, session: Session | null) => void>,
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      signInWithPassword: auth.signInWithPassword,
      resend: auth.resend,
      onAuthStateChange: (listener: NonNullable<typeof auth.listener>) => {
        auth.listener = listener;
        auth.listeners.push(listener);
        return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
      },
    },
  },
}));
vi.mock('@/services/profileService', () => ({ signOut: vi.fn().mockResolvedValue(true) }));
vi.mock('sonner', () => ({ toast: { success: auth.success, error: auth.error } }));
vi.mock('@/components/common/Logo', () => ({ default: () => <div>Project S</div> }));
vi.mock('@/components/auth/SignupForm', () => ({ default: () => <div>Signup fields</div> }));

const reviewId = 'abcdef12-3456-4789-8abc-0123456789ab';
const reviewDestination = `/authority/review#review=${reviewId}`;
const searchFor = (destination: string) => `?returnTo=${encodeURIComponent(destination)}`;
const loginFor = (destination: string) => `/login${searchFor(destination)}`;
const originalBrowserPath = window.location.pathname + window.location.search + window.location.hash;
const session = {
  user: { id: '11111111-1111-4111-8111-111111111111' },
} as Session;

beforeEach(() => {
  vi.clearAllMocks();
  auth.listener = null;
  auth.listeners = [];
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
  auth.resend.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => window.history.replaceState(null, '', originalBrowserPath));

describe('authentication return destination allowlist', () => {
  it.each(['/dashboard', '/profile-settings', reviewDestination])(
    'preserves the exact approved destination %s', (destination) => {
      expect(getAuthReturnTo(searchFor(destination))).toBe(destination);
    },
  );

  it.each([
    '', '?', '?returnTo=', '?unrelated=/profile-settings',
    '?returnTo=%E0%A4%A',
    `${searchFor('/profile-settings')}&returnTo=${encodeURIComponent(reviewDestination)}`,
    `${searchFor(reviewDestination)}&returnTo=${encodeURIComponent(reviewDestination)}`,
  ])('defaults safely for missing, malformed or duplicate return destinations: %s', (search) => {
    expect(getAuthReturnTo(search)).toBe('/dashboard');
  });

  const unsafeDestinations = [
    'https://example.invalid/profile-settings',
    '//example.invalid/profile-settings',
    String.raw`\example.invalid\profile-settings`,
    String.raw`/\example.invalid/profile-settings`,
    'javascript:alert(1)',
    '/book/demo-host',
    '/dashboard/',
    '/profile-settings/',
    '/profile-settings?tab=privacy',
    '/profile-settings#private',
    '/dashboard?returnTo=/profile-settings',
    '/login?returnTo=/profile-settings',
    '/signup?returnTo=/profile-settings',
    encodeURIComponent('/profile-settings'),
    '/authority/review',
    '/authority/review#review=',
    `/authority/review#review=${reviewId.toUpperCase()}`,
    `/authority/review#review=${reviewId.replaceAll('-', '')}`,
    `/authority/review#review=${reviewId.slice(0, -1)}z`,
    `/authority/review#review=${reviewId}&review=${reviewId}`,
    `/authority/review#review=${reviewId}&returnTo=/profile-settings`,
    `/authority/review?returnTo=/profile-settings#review=${reviewId}`,
    `${reviewDestination}/extra`,
    `${reviewDestination} `,
    ` ${reviewDestination}`,
    `${reviewDestination}\n`,
    `${reviewDestination}\r\n`,
    encodeURIComponent(reviewDestination),
  ];

  it.each(unsafeDestinations)('rejects an external, nested or non-exact destination: %s', (destination) => {
    expect(getAuthReturnTo(searchFor(destination))).toBe('/dashboard');
  });

  it.each(['/login', '/signup', '/email-verification'] as const)(
    'encodes only an approved non-default destination into %s', (path) => {
      expect(authRoute(path, '/dashboard')).toBe(path);
      expect(authRoute(path, '/profile-settings')).toBe(`${path}${searchFor('/profile-settings')}`);
      expect(authRoute(path, reviewDestination)).toBe(`${path}${searchFor(reviewDestination)}`);
      for (const destination of unsafeDestinations) {
        expect(authRoute(path, destination)).toBe(path);
      }
    },
  );
});

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search + location.hash}</div>;
};

const drawAuth = (entry: string, state?: { email: string }) => render(
  <MemoryRouter initialEntries={[{ pathname: entry.split('?')[0], search: entry.includes('?') ? `?${entry.split('?').slice(1).join('?')}` : '', state }]}>
    <LocationProbe />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/email-verification" element={<EmailVerification />} />
      <Route path="/signup" element={<h1>Signup destination</h1>} />
      <Route path="/dashboard" element={<h1>Dashboard destination</h1>} />
      <Route path="/profile-settings" element={<h1>Profile destination</h1>} />
      <Route path="/authority/review" element={<h1>Approval review destination</h1>} />
    </Routes>
  </MemoryRouter>,
);

const submitLogin = () => {
  fireEvent.change(screen.getByLabelText('Email', { exact: true }), {
    target: { value: 'local-reviewer@example.invalid' },
  });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), {
    target: { value: 'Synthetic-local-password-Aa1!' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Log in', exact: true }));
};

describe('login and verification return journey', () => {
  it.each(['/profile-settings', reviewDestination])('returns an existing session to %s without a dashboard detour', async (destination) => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    drawAuth(loginFor(destination));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(destination));
    expect(screen.queryByRole('heading', { name: 'Dashboard destination' })).not.toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it.each(['/profile-settings', reviewDestination])('returns a manual sign-in to %s', async (destination) => {
    drawAuth(loginFor(destination));
    await waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());
    expect(screen.getByRole('link', { name: 'Sign up', exact: true })).toHaveAttribute(
      'href', `/signup${searchFor(destination)}`,
    );
    submitLogin();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(destination));
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: 'local-reviewer@example.invalid', password: 'Synthetic-local-password-Aa1!',
    });
  });

  it('keeps the approved URL after a failed sign-in and resumes from it after a fresh mount', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ data: { session: null }, error: new Error('Invalid credentials') });
    const first = drawAuth(loginFor(reviewDestination));
    submitLogin();
    await waitFor(() => expect(auth.error).toHaveBeenCalledWith(
      'Unable to sign in. Check your credentials and try again.',
    ));
    const persistedUrl = screen.getByTestId('location').textContent!;
    expect(persistedUrl).toBe(loginFor(reviewDestination));
    expect(screen.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled();
    first.unmount();
    drawAuth(persistedUrl);
    submitLogin();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(reviewDestination));
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it('preserves the review destination through verification, resend callback and return to login', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null }, error: new Error('Email not confirmed'),
    });
    drawAuth(loginFor(reviewDestination));
    submitLogin();
    const verificationUrl = `/email-verification${searchFor(reviewDestination)}`;
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(verificationUrl));
    expect(screen.getByLabelText('Account email', { exact: true })).toHaveValue('local-reviewer@example.invalid');
    const returnLink = screen.getByRole('link', { name: 'Return to login', exact: true });
    expect(returnLink).toHaveAttribute('href', loginFor(reviewDestination));
    expect(screen.getByRole('link', { name: 'Try signing up again', exact: true })).toHaveAttribute(
      'href', `/signup${searchFor(reviewDestination)}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email', exact: true }));
    await waitFor(() => expect(auth.resend).toHaveBeenCalledExactlyOnceWith({
      type: 'signup', email: 'local-reviewer@example.invalid',
      options: { emailRedirectTo: window.location.origin + loginFor(reviewDestination) },
    }));
    fireEvent.click(returnLink);
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(loginFor(reviewDestination)));
    submitLogin();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(reviewDestination));
  });

  it('preserves the review reference after reloading verification without navigation state', async () => {
    drawAuth(`/email-verification${searchFor(reviewDestination)}`);
    fireEvent.change(screen.getByLabelText('Account email', { exact: true }), {
      target: { value: '  LOCAL-REVIEWER@example.invalid  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email', exact: true }));
    await waitFor(() => expect(auth.resend).toHaveBeenCalledExactlyOnceWith({
      type: 'signup', email: 'local-reviewer@example.invalid',
      options: { emailRedirectTo: window.location.origin + loginFor(reviewDestination) },
    }));
    expect(screen.getByRole('link', { name: 'Return to login', exact: true })).toHaveAttribute(
      'href', loginFor(reviewDestination),
    );
  });

  it('keeps the existing dashboard callback when no approved return target is present', async () => {
    drawAuth('/email-verification?returnTo=https%3A%2F%2Fexample.invalid', {
      email: 'local-reviewer@example.invalid',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email', exact: true }));
    await waitFor(() => expect(auth.resend).toHaveBeenCalledExactlyOnceWith({
      type: 'signup', email: 'local-reviewer@example.invalid',
      options: { emailRedirectTo: window.location.origin + '/dashboard' },
    }));
    expect(screen.getByRole('link', { name: 'Return to login', exact: true })).toHaveAttribute('href', '/login');
  });
});

const AuthEventHarness = () => {
  const { loading } = useAuth();
  return <div>{loading ? 'Loading session' : 'Session checked'}</div>;
};

const drawAuthEvents = (entry: string) => {
  window.history.replaceState(null, '', entry);
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/login" element={<AuthEventHarness />} />
        <Route path="/signup" element={<AuthEventHarness />} />
        <Route path="/authority/review" element={<AuthEventHarness />} />
        <Route path="/profile-settings" element={<h1>Profile destination</h1>} />
        <Route path="/dashboard" element={<h1>Dashboard destination</h1>} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('auth event navigation keeps the same approved return destination', () => {
  it.each(['/login', '/signup'])('does not override review return on SIGNED_IN at %s', async (path) => {
    drawAuthEvents(`${path}${searchFor(reviewDestination)}`);
    await screen.findByText('Session checked');
    expect(auth.listener).not.toBeNull();
    act(() => auth.listener!('SIGNED_IN', session));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(reviewDestination));
    expect(screen.queryByRole('heading', { name: 'Dashboard destination' })).not.toBeInTheDocument();
  });

  it('defaults an unsafe auth-event return to dashboard', async () => {
    drawAuthEvents(loginFor('https://example.invalid'));
    await screen.findByText('Session checked');
    act(() => auth.listener!('SIGNED_IN', session));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/dashboard'));
  });

  it('preserves only the opaque current review reference across SIGNED_OUT', async () => {
    drawAuthEvents(reviewDestination);
    await screen.findByText('Session checked');
    act(() => auth.listener!('SIGNED_OUT', null));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(loginFor(reviewDestination)));
  });

  it('keeps the destination when two SIGNED_OUT subscribers redirect successively in the real browser history', async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    window.history.replaceState(null, '', reviewDestination);
    render(
      <BrowserRouter>
        <LocationProbe />
        <AuthEventHarness />
        <AuthEventHarness />
      </BrowserRouter>,
    );
    await waitFor(() => expect(screen.getAllByText('Session checked')).toHaveLength(2));
    const subscribers = [...auth.listeners];
    expect(subscribers).toHaveLength(2);
    act(() => {
      subscribers[0]('SIGNED_OUT', null);
      // BrowserRouter writes this synchronously; the second subscriber now
      // observes an auth URL, rather than the original protected review URL.
      expect(window.location.pathname + window.location.search).toBe(loginFor(reviewDestination));
      subscribers[1]('SIGNED_OUT', null);
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(loginFor(reviewDestination)));
    expect(window.location.pathname + window.location.search).toBe(loginFor(reviewDestination));
  });
});

const pendingSession = () => {
  let resolve!: (result: { data: { session: Session | null }; error: null }) => void;
  const promise = new Promise<{ data: { session: Session | null }; error: null }>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};

const AuthNavigationControls = ({ path }: { path: '/login' | '/signup' }) => {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate(`${path}${searchFor('/profile-settings')}`)}>Choose profile destination</button>
    <button onClick={() => navigate('/away')}>Leave authentication</button>
  </>;
};

const drawSessionRace = (path: '/login' | '/signup') => render(
  <MemoryRouter initialEntries={[`${path}${searchFor(reviewDestination)}`]}>
    <LocationProbe />
    <AuthNavigationControls path={path} />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/profile-settings" element={<h1>Profile destination</h1>} />
      <Route path="/authority/review" element={<h1>Approval review destination</h1>} />
      <Route path="/away" element={<h1>Left authentication</h1>} />
    </Routes>
  </MemoryRouter>,
);

describe('pending session reads cannot navigate with stale destinations', () => {
  it.each(['/login', '/signup'] as const)('ignores an older getSession response after the return URL changes at %s', async (path) => {
    const oldRead = pendingSession();
    const currentRead = pendingSession();
    auth.getSession.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(currentRead.promise);
    drawSessionRace(path);
    await waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Choose profile destination' }));
    await waitFor(() => expect(auth.getSession).toHaveBeenCalledTimes(2));
    await act(async () => oldRead.resolve({ data: { session }, error: null }));
    expect(screen.getByTestId('location').textContent).toBe(`${path}${searchFor('/profile-settings')}`);
    expect(screen.queryByRole('heading', { name: 'Approval review destination' })).not.toBeInTheDocument();
    await act(async () => currentRead.resolve({ data: { session }, error: null }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/profile-settings'));
  });

  it.each(['/login', '/signup'] as const)('ignores getSession completion after leaving %s', async (path) => {
    const read = pendingSession();
    auth.getSession.mockReturnValueOnce(read.promise);
    drawSessionRace(path);
    await waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Leave authentication' }));
    await screen.findByRole('heading', { name: 'Left authentication' });
    await act(async () => read.resolve({ data: { session }, error: null }));
    expect(screen.getByTestId('location').textContent).toBe('/away');
    expect(screen.getByRole('heading', { name: 'Left authentication' })).toBeVisible();
  });

  it('waits for protected-route authentication before redirecting and keeps the review reference', async () => {
    const read = pendingSession();
    auth.getSession.mockReturnValueOnce(read.promise);
    render(
      <MemoryRouter initialEntries={[reviewDestination]}>
        <LocationProbe />
        <Routes>
          <Route path="/authority/review" element={<PrivateRoute><h1>Protected review content</h1></PrivateRoute>} />
          <Route path="/login" element={<h1>Authentication destination</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading authentication…');
    expect(screen.getByTestId('location').textContent).toBe(reviewDestination);
    expect(screen.queryByRole('heading', { name: 'Protected review content' })).not.toBeInTheDocument();
    await act(async () => read.resolve({ data: { session: null }, error: null }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(loginFor(reviewDestination)));
    expect(screen.getByRole('heading', { name: 'Authentication destination' })).toBeVisible();
  });
});
