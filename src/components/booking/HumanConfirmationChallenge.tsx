import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { env } from '@/config/env';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      cData: string;
      theme: 'auto';
      size: 'flexible';
      callback(token: string): void;
      'error-callback'(): void;
      'expired-callback'(): void;
      'timeout-callback'(): void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface HumanConfirmationChallengeProps {
  preparationId: string;
  value: string | null;
  disabled?: boolean;
  onTokenChange(token: string | null): void;
}

const turnstileScriptUrl =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

const loadTurnstile = () =>
  new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${turnstileScriptUrl}"]`,
    );
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile did not initialize.'));
    };
    const onError = () => reject(new Error('Turnstile could not be loaded.'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = turnstileScriptUrl;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  });

const isLoopback = (hostname: string) =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

const HumanConfirmationChallenge = ({
  preparationId,
  value,
  disabled = false,
  onTokenChange,
}: HumanConfirmationChallengeProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const localDevelopment = useMemo(
    () => isLoopback(window.location.hostname) && !env.turnstileSiteKey,
    [],
  );

  useEffect(() => {
    onTokenChange(null);
    if (!env.turnstileSiteKey || !containerRef.current) return;
    let active = true;

    void loadTurnstile()
      .then((turnstile) => {
        if (!active || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: env.turnstileSiteKey!,
          action: 'project_s_booking_confirmation',
          cData: preparationId,
          theme: 'auto',
          size: 'flexible',
          callback: (token) => active && onTokenChange(token),
          'error-callback': () => {
            if (!active) return;
            onTokenChange(null);
            setLoadError('The confirmation check failed. Please try again.');
          },
          'expired-callback': () => active && onTokenChange(null),
          'timeout-callback': () => active && onTokenChange(null),
        });
      })
      .catch(() => {
        if (active) {
          setLoadError('The confirmation check could not be loaded.');
        }
      });

    return () => {
      active = false;
      onTokenChange(null);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = undefined;
      }
    };
  }, [onTokenChange, preparationId]);

  useEffect(() => {
    if (!value && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [value]);

  if (localDevelopment) {
    return (
      <label className="flex items-start gap-3 rounded-md border p-4">
        <Checkbox
          checked={value === 'project-s-local-confirmation'}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onTokenChange(checked === true ? 'project-s-local-confirmation' : null)
          }
        />
        <span className="text-sm leading-5">
          <span className="block">
            I reviewed these details and am confirming this local development booking.
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            This loopback-only checkbox is a development fixture. Production requires a configured verification challenge.
          </span>
        </span>
      </label>
    );
  }

  if (!env.turnstileSiteKey) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
        Booking confirmation protection is not configured for this installation.
      </p>
    );
  }

  return (
    <div>
      <div ref={containerRef} aria-label="Human confirmation challenge" />
      {loadError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {loadError}
        </p>
      )}
    </div>
  );
};

export default HumanConfirmationChallenge;
