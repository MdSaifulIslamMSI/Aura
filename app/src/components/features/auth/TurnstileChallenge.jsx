import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  getTurnstileSiteKey,
  removeTurnstile,
  renderTurnstile,
} from '@/services/turnstileClient';

const TurnstileChallenge = ({
  action = 'auth',
  className = '',
  disabled = false,
  onError,
  onToken,
  refreshKey = '',
}) => {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const siteKey = disabled ? '' : getTurnstileSiteKey();

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      return undefined;
    }

    let mounted = true;
    onToken?.('');

    renderTurnstile(containerRef.current, {
      siteKey,
      action,
      onToken: (token) => {
        if (mounted) onToken?.(token);
      },
      onExpire: () => {
        if (mounted) onToken?.('');
      },
      onError: () => {
        if (mounted) {
          onToken?.('');
          onError?.();
        }
      },
    }).then((widgetId) => {
      if (mounted) {
        widgetRef.current = widgetId;
      }
    }).catch(() => {
      if (mounted) {
        onToken?.('');
        onError?.();
      }
    });

    return () => {
      mounted = false;
      removeTurnstile(widgetRef.current);
      widgetRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [action, onError, onToken, refreshKey, siteKey]);

  if (!siteKey) {
    return null;
  }

  return (
    <div
      className={cn('flex justify-center', className)}
      data-testid="turnstile-challenge"
    >
      <div ref={containerRef} />
    </div>
  );
};

export default TurnstileChallenge;
