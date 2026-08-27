const CONSERVATIVE_EMAIL = /^[A-Za-z0-9.!#$%*+'=_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,63}$/;

export const getSafeMailtoHref = (email: string): string | null => {
  const normalized = email.trim();
  if (normalized.length > 320 || !CONSERVATIVE_EMAIL.test(normalized)) return null;
  return `mailto:${encodeURIComponent(normalized)}`;
};
