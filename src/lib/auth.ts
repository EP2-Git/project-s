export const getPostSignupDestination = (hasSession: boolean) =>
  hasSession ? '/dashboard' as const : '/email-verification' as const;

const approvalDestination = /^\/authority\/review#review=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;

// Navigation carries only a known screen or an opaque review reference.
// The destination's server still verifies the current caller and permission.
const safeDestination = (value: string | null) =>
  value === '/dashboard' || value === '/profile-settings' ||
  (typeof value === 'string' && approvalDestination.test(value))
    ? value
    : '/dashboard';

export const getAuthReturnTo = (search: string): string => {
  const values = new URLSearchParams(search).getAll('returnTo');
  return safeDestination(values.length === 1 ? values[0] : null);
};

export const authRoute = (
  path: '/login' | '/signup' | '/email-verification',
  destination: string,
): string => {
  const target = safeDestination(destination);
  return target === '/dashboard' ? path : `${path}?${new URLSearchParams({ returnTo: target })}`;
};
