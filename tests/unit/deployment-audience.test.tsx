import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeploymentRoot, HostedOnlyRoute } from '@/App';
import { resolveDeploymentAudience } from '@/config/deploymentAudience';

const authState = vi.hoisted(() => ({
  loading: false,
  user: null as { id: string } | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    loading: authState.loading,
    session: null,
    user: authState.user,
    handleSignOut: vi.fn(),
  }),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderRoot = (audience: 'hosted' | 'self-hosted') => render(
  <MemoryRouter initialEntries={['/']}>
    <LocationProbe />
    <Routes>
      <Route
        path="/"
        element={(
          <DeploymentRoot
            audience={audience}
            hostedHome={(
              <main>
                <h1>Hosted marketing</h1>
                <nav>Hosted navigation</nav>
                <footer>Hosted footer</footer>
              </main>
            )}
          />
        )}
      />
      <Route path="/login" element={<h1>Deployment login</h1>} />
      <Route path="/dashboard" element={<h1>Host dashboard</h1>} />
    </Routes>
  </MemoryRouter>,
);

describe('deployment audience boundary', () => {
  beforeEach(() => {
    authState.loading = false;
    authState.user = null;
  });

  it.each([
    [undefined, 'self-hosted'],
    ['', 'self-hosted'],
    ['SELF-HOSTED', 'self-hosted'],
    ['production', 'self-hosted'],
    ['hosted', 'hosted'],
    ['self-hosted', 'self-hosted'],
  ] as const)('resolves %s to the safe audience %s', (value, expected) => {
    expect(resolveDeploymentAudience(value)).toBe(expected);
  });

  it('renders the marketing homepage only in hosted mode', () => {
    renderRoot('hosted');

    expect(screen.getByRole('heading', { name: 'Hosted marketing' })).toBeVisible();
    expect(screen.getByText('Hosted navigation')).toBeVisible();
    expect(screen.getByText('Hosted footer')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('sends an anonymous self-hosted root to login without marketing leakage', async () => {
    renderRoot('self-hosted');

    expect(await screen.findByRole('heading', { name: 'Deployment login' })).toBeVisible();
    expect(screen.queryByText('Hosted marketing')).not.toBeInTheDocument();
    expect(screen.queryByText('Hosted navigation')).not.toBeInTheDocument();
    expect(screen.queryByText('Hosted footer')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('sends an authenticated self-hosted root to the dashboard without a loop', async () => {
    authState.user = { id: 'synthetic-host' };
    renderRoot('self-hosted');

    expect(await screen.findByRole('heading', { name: 'Host dashboard' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/dashboard'));
  });

  it('waits for authentication state before redirecting', () => {
    authState.loading = true;
    renderRoot('self-hosted');

    expect(screen.getByRole('status')).toHaveTextContent('Loading page…');
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('does not render hosted-only routes in self-hosted mode', async () => {
    render(
      <MemoryRouter>
        <HostedOnlyRoute audience="self-hosted">
          <div>Private design review</div>
        </HostedOnlyRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Private design review')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '404' })).toBeVisible();
  });
});
