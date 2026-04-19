import {
  detectFrontendPlatform,
  normalizeFrontendUrl,
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
    expect(netlifyTarget.href).toBe('https://aura-gateway.netlify.app');
  });

  it('keeps targets pending when no deployment url is available', () => {
    const [, netlifyTarget] = resolveFrontendTargets({
      currentOrigin: 'https://localhost:5173',
    });

    expect(netlifyTarget.href).toBe('');
    expect(netlifyTarget.isLive).toBe(false);
  });
});
