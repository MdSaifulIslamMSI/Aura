import {
  DEFAULT_GATEWAY_FRONTEND_URL,
  detectFrontendPlatform,
  normalizeFrontendUrl,
  resolveFrontendNavigationTargets,
  resolveFrontendTargets,
} from './frontendTargets';

describe('frontendTargets', () => {
  it('normalizes and trims frontend urls', () => {
    expect(normalizeFrontendUrl(' https://aura.app/launch/ ')).toBe('https://aura.app/launch');
    expect(normalizeFrontendUrl('ftp://aura.app')).toBe('');
    expect(normalizeFrontendUrl('not-a-url')).toBe('');
  });

  it('detects known deployment hosts', () => {
    expect(detectFrontendPlatform('aura-demo.vercel.app')).toBe('vercel');
    expect(detectFrontendPlatform('aura-demo.netlify.app')).toBe('netlify');
    expect(detectFrontendPlatform('aura.shop')).toBe('');
  });

  it('falls back to the active vercel origin when the vercel url is not configured', () => {
    const [vercelTarget, netlifyTarget] = resolveFrontendTargets({
      currentOrigin: 'https://aura-gateway.vercel.app',
      netlifyUrl: 'https://aura-gateway.netlify.app',
    });

    expect(vercelTarget.href).toBe('https://aura-gateway.vercel.app');
    expect(vercelTarget.isLive).toBe(true);
    expect(vercelTarget.isCurrent).toBe(true);
    expect(vercelTarget.hostname).toBe('aura-gateway.vercel.app');
    expect(netlifyTarget.href).toBe('https://aura-gateway.netlify.app');
    expect(netlifyTarget.isCurrent).toBe(false);
  });

  it('keeps targets pending when no deployment url is available', () => {
    const [, netlifyTarget] = resolveFrontendTargets({
      currentOrigin: 'https://localhost:5173',
    });

    expect(netlifyTarget.href).toBe('');
    expect(netlifyTarget.isLive).toBe(false);
    expect(netlifyTarget.originLabel).toBe('Deployment URL pending');
  });

  it('adds the gateway target ahead of the storefront runtimes for navigation', () => {
    const [gatewayTarget, vercelTarget, netlifyTarget] = resolveFrontendNavigationTargets({
      currentOrigin: 'https://aurapilot.vercel.app',
      netlifyUrl: 'https://aurapilot.netlify.app',
    });

    expect(gatewayTarget.id).toBe('gateway');
    expect(gatewayTarget.href).toBe(DEFAULT_GATEWAY_FRONTEND_URL);
    expect(gatewayTarget.isCurrent).toBe(false);
    expect(vercelTarget.isCurrent).toBe(true);
    expect(netlifyTarget.href).toBe('https://aurapilot.netlify.app');
  });

  it('gives the gateway current-host priority when the app runs on the gateway domain', () => {
    const [gatewayTarget, vercelTarget] = resolveFrontendNavigationTargets({
      currentOrigin: DEFAULT_GATEWAY_FRONTEND_URL,
    });

    expect(gatewayTarget.isCurrent).toBe(true);
    expect(vercelTarget.isCurrent).toBe(false);
  });
});
