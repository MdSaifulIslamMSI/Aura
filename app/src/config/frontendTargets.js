export const FRONTEND_LAUNCH_HUB_PATH = '/launch';

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export const normalizeFrontendUrl = (value = '') => {
  const candidate = String(value || '').trim();

  if (!candidate) {
    return '';
  }

  try {
    const parsed = new URL(candidate);

    if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
      return '';
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname}`;
  } catch {
    return '';
  }
};

export const detectFrontendPlatform = (hostname = '') => {
  const normalizedHostname = String(hostname || '').trim().toLowerCase();

  if (!normalizedHostname) {
    return '';
  }

  if (normalizedHostname.includes('vercel')) {
    return 'vercel';
  }

  if (normalizedHostname.includes('netlify')) {
    return 'netlify';
  }

  return '';
};

const getHostname = (url = '') => {
  if (!url) {
    return '';
  }

  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const resolveFrontendTargets = ({
  vercelUrl = '',
  netlifyUrl = '',
  currentOrigin = '',
} = {}) => {
  const normalizedCurrentOrigin = normalizeFrontendUrl(currentOrigin);
  const detectedPlatform = detectFrontendPlatform(getHostname(normalizedCurrentOrigin));

  const resolvedTargets = {
    vercel: normalizeFrontendUrl(vercelUrl) || (detectedPlatform === 'vercel' ? normalizedCurrentOrigin : ''),
    netlify: normalizeFrontendUrl(netlifyUrl) || (detectedPlatform === 'netlify' ? normalizedCurrentOrigin : ''),
  };

  return [
    {
      id: 'vercel',
      label: 'Vercel frontend',
      platform: 'Vercel',
      description: 'Open the Vercel deployment for the Aura storefront.',
      href: resolvedTargets.vercel,
      isLive: Boolean(resolvedTargets.vercel),
    },
    {
      id: 'netlify',
      label: 'Netlify frontend',
      platform: 'Netlify',
      description: 'Open the Netlify deployment for the same Aura storefront.',
      href: resolvedTargets.netlify,
      isLive: Boolean(resolvedTargets.netlify),
    },
  ];
};
