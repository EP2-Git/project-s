interface RefreshLimiterOptions {
  maxCalls: number;
  windowMs: number;
  onLimitedChange: (limited: boolean) => void;
}

export const createRefreshLimiter = ({
  maxCalls,
  windowMs,
  onLimitedChange,
}: RefreshLimiterOptions) => {
  let history: number[] = [];
  let resetTimer: ReturnType<typeof setTimeout> | null = null;

  const prune = (now: number) => {
    history = history.filter((timestamp) => now - timestamp < windowMs);
  };

  const attempt = () => {
    const now = Date.now();
    prune(now);
    if (history.length < maxCalls) {
      history.push(now);
      onLimitedChange(false);
      return true;
    }

    onLimitedChange(true);
    if (resetTimer) clearTimeout(resetTimer);
    const retryAfterMs = Math.max(1, windowMs - (now - history[0]));
    resetTimer = setTimeout(() => {
      prune(Date.now());
      resetTimer = null;
      onLimitedChange(false);
    }, retryAfterMs);
    return false;
  };

  const dispose = () => {
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = null;
  };

  return { attempt, dispose };
};
