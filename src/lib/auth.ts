export const getPostSignupDestination = (hasSession: boolean) =>
  hasSession ? '/dashboard' as const : '/email-verification' as const;
