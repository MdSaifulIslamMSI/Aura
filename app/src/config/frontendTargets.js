export const FRONTEND_LAUNCH_HUB_PATH = '/launch';
export const DEFAULT_GATEWAY_FRONTEND_URL = 'https://aura-gateway.vercel.app';

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

const createTarget = ({
  id = '',
  label = '',
  platform = '',
  description = '',
  href = '',
  currentOrigin = '',
}) => {
  const hostname = getHostname(href);
  const normalizedCurrentOrigin = normalizeFrontendUrl(currentOrigin);

  return {
    id,
    label,
    platform,
    description,
    href,
    hostname,
    originLabel: hostname || 'Deployment URL pending',
    isCurrent: Boolean(href) && href === normalizedCurrentOrigin,
    isLive: Boolean(href),
  };
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
    createTarget({
      id: 'vercel',
      label: 'Vercel frontend',
      platform: 'Vercel',
      description: 'Open the Vercel-hosted Aura storefront running on the shared production backend.',
      href: resolvedTargets.vercel,
      currentOrigin: normalizedCurrentOrigin,
    }),
    createTarget({
      id: 'netlify',
      label: 'Netlify frontend',
      platform: 'Netlify',
      description: 'Open the Netlify-hosted Aura storefront mirroring the same production commerce state.',
      href: resolvedTargets.netlify,
      currentOrigin: normalizedCurrentOrigin,
    }),
  ];
};

export const resolveFrontendNavigationTargets = ({
  gatewayUrl = '',
  vercelUrl = '',
  netlifyUrl = '',
  currentOrigin = '',
} = {}) => {
  const normalizedCurrentOrigin = normalizeFrontendUrl(currentOrigin);
  const storefrontTargets = resolveFrontendTargets({
    vercelUrl,
    netlifyUrl,
    currentOrigin: normalizedCurrentOrigin,
  });
  const gatewayTarget = createTarget({
    id: 'gateway',
    label: 'Gateway',
    platform: 'Gateway',
    description: 'Return to the Aura gateway and choose the frontend runtime you want from the dedicated entry layer.',
    href: normalizeFrontendUrl(gatewayUrl) || DEFAULT_GATEWAY_FRONTEND_URL,
    currentOrigin: normalizedCurrentOrigin,
  });
  const gatewayIsCurrent = gatewayTarget.isCurrent;

  return [gatewayTarget, ...storefrontTargets].map((target) => ({
    ...target,
    isCurrent: gatewayIsCurrent ? target.id === 'gateway' : target.isCurrent,
  }));
};
