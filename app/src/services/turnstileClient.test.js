import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getTurnstileSiteKey,
    isTurnstileEnabled,
    renderTurnstile,
} from './turnstileClient';

describe('turnstileClient', () => {
    afterEach(() => {
        delete window.turnstile;
        document.body.innerHTML = '';
    });

    it('requires a site key and honors frontend feature flags', () => {
        expect(getTurnstileSiteKey({})).toBe('');
        expect(isTurnstileEnabled({ VITE_TURNSTILE_SITE_KEY: 'site-key' })).toBe(true);
        expect(getTurnstileSiteKey({
            VITE_TURNSTILE_SITE_KEY: 'site-key',
            VITE_TURNSTILE_ENABLED: 'false',
        })).toBe('');
        expect(getTurnstileSiteKey({
            VITE_TURNSTILE_SITE_KEY: 'site-key',
            VITE_AUTH_TURNSTILE_ENABLED: 'off',
        })).toBe('');
    });

    it('renders explicit Turnstile challenges with auth action callbacks', async () => {
        const onToken = vi.fn();
        const onExpire = vi.fn();
        const onError = vi.fn();
        const container = document.createElement('div');
        window.turnstile = {
            render: vi.fn((_container, options) => {
                options.callback('token-123');
                options['expired-callback']();
                options['error-callback']();
                return 'widget-1';
            }),
        };

        const widgetId = await renderTurnstile(container, {
            siteKey: 'site-key',
            action: 'auth_otp_verify',
            onToken,
            onExpire,
            onError,
        });

        expect(widgetId).toBe('widget-1');
        expect(window.turnstile.render).toHaveBeenCalledWith(container, expect.objectContaining({
            sitekey: 'site-key',
            action: 'auth_otp_verify',
        }));
        expect(onToken).toHaveBeenCalledWith('token-123');
        expect(onExpire).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
    });
});
