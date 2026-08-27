import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import Logo from '@/components/common/Logo';
import { Button } from '@/components/ui/button';
import { env } from '@/config/env';
import { isHostedAudience } from '@/config/deploymentAudience';

const HostedNavbar = import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE === 'hosted'
  ? lazy(() => import('@/components/Navbar'))
  : null;

const DeploymentHeader = () => {
  if (isHostedAudience(env.deploymentAudience) && HostedNavbar) {
    return (
      <Suspense fallback={<div className="h-[73px] border-b border-border" aria-hidden="true" />}>
        <HostedNavbar />
      </Suspense>
    );
  }

  return (
    <header className="w-full border-b border-border bg-background px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Logo size="md" />
        <nav aria-label="Deployment account" className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Sign up</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
};

export default DeploymentHeader;
