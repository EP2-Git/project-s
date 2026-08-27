export const deploymentAudiences = ['hosted', 'self-hosted'] as const;

export type DeploymentAudience = (typeof deploymentAudiences)[number];

export const resolveDeploymentAudience = (
  value: unknown,
): DeploymentAudience => value === 'hosted' ? 'hosted' : 'self-hosted';

export const isHostedAudience = (
  audience: DeploymentAudience,
): boolean => audience === 'hosted';
