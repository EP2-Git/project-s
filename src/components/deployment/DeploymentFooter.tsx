import { lazy, Suspense } from 'react';
import Logo from '@/components/common/Logo';
import { env } from '@/config/env';
import { isHostedAudience } from '@/config/deploymentAudience';

const HostedFooter = import.meta.env.VITE_PROJECT_S_DEPLOYMENT_AUDIENCE === 'hosted'
  ? lazy(() => import('@/components/Footer'))
  : null;

const DeploymentFooter = () => {
  if (isHostedAudience(env.deploymentAudience) && HostedFooter) {
    return (
      <Suspense fallback={<div className="h-24 border-t border-border" aria-hidden="true" />}>
        <HostedFooter />
      </Suspense>
    );
  }

  return (
    <footer className="border-t border-border bg-card px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Logo size="sm" />
        <p className="text-sm text-muted-foreground">
          Scheduling infrastructure operated by this deployment.
        </p>
      </div>
    </footer>
  );
};

export default DeploymentFooter;
