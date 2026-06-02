import { defineMessages } from 'react-intl';

export const FRONTEND_LAUNCH_HUB_PATH = '/launch';
export const DEFAULT_GATEWAY_FRONTEND_URL = '';

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export const frontendTargetMessages = defineMessages({
  vercelLabel: {
    id: 'frontendTargets.vercel.label',
    defaultMessage: 'Vercel frontend',
  },
  vercelDescription: {
    id: 'frontendTargets.vercel.description',
    defaultMessage: 'Open the Vercel-hosted Aura storefront running on the shared production backend.',
  },
  netlifyLabel: {
    id: 'frontendTargets.netlify.label',
    defaultMessage: 'Netlify frontend',
  },
  netlifyDescription: {
    id: 'frontendTargets.netlify.description',
    defaultMessage: 'Open the Netlify-hosted Aura storefront mirroring the same production commerce state.',
  },
  gatewayLabel: {
    id: 'frontendTargets.gateway.label',
    defaultMessage: 'Gateway',
  },
  gatewayDescription: {
    id: 'frontendTargets.gateway.description',
    defaultMessage: 'Return to the Aura gateway and choose the frontend runtime you want from the dedicated entry layer.',
  },
  deploymentUrlPending: {
    id: 'frontendTargets.origin.pending',
    defaultMessage: 'Deployment URL pending',
  },
});

const formatFrontendTargetMessage = (formatMessage, descriptor, values = {}) => {
  if (!descriptor) return '';

  if (typeof formatMessage === 'function') {
    try {
      return formatMessage(descriptor, values);
    } catch {
      return descriptor.defaultMessage || '';
    }
  }

  return descriptor.defaultMessage || '';
};

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
  labelMessage = null,
  platform = '',
  description = '',
  descriptionMessage = null,
  href = '',
  currentOrigin = '',
  formatMessage = null,
}) => {
  const hostname = getHostname(href);
  const normalizedCurrentOrigin = normalizeFrontendUrl(currentOrigin);

  return {
    id,
    label: label || formatFrontendTargetMessage(formatMessage, labelMessage),
    platform,
    description: description || formatFrontendTargetMessage(formatMessage, descriptionMessage),
    href,
    hostname,
    originLabel: hostname || formatFrontendTargetMessage(formatMessage, frontendTargetMessages.deploymentUrlPending),
    isCurrent: Boolean(href) && href === normalizedCurrentOrigin,
    isLive: Boolean(href),
  };
};

export const resolveFrontendTargets = ({
  vercelUrl = '',
  netlifyUrl = '',
  currentOrigin = '',
  formatMessage = null,
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
      labelMessage: frontendTargetMessages.vercelLabel,
      platform: 'Vercel',
      descriptionMessage: frontendTargetMessages.vercelDescription,
      href: resolvedTargets.vercel,
      currentOrigin: normalizedCurrentOrigin,
      formatMessage,
    }),
    createTarget({
      id: 'netlify',
      labelMessage: frontendTargetMessages.netlifyLabel,
      platform: 'Netlify',
      descriptionMessage: frontendTargetMessages.netlifyDescription,
      href: resolvedTargets.netlify,
      currentOrigin: normalizedCurrentOrigin,
      formatMessage,
    }),
  ];
};

export const resolveFrontendNavigationTargets = ({
  gatewayUrl = '',
  vercelUrl = '',
  netlifyUrl = '',
  currentOrigin = '',
  formatMessage = null,
} = {}) => {
  const normalizedCurrentOrigin = normalizeFrontendUrl(currentOrigin);
  const storefrontTargets = resolveFrontendTargets({
    vercelUrl,
    netlifyUrl,
    currentOrigin: normalizedCurrentOrigin,
    formatMessage,
  });
  const gatewayTarget = createTarget({
    id: 'gateway',
    labelMessage: frontendTargetMessages.gatewayLabel,
    platform: 'Gateway',
    descriptionMessage: frontendTargetMessages.gatewayDescription,
    href: normalizeFrontendUrl(gatewayUrl) || DEFAULT_GATEWAY_FRONTEND_URL,
    currentOrigin: normalizedCurrentOrigin,
    formatMessage,
  });
  const gatewayIsCurrent = gatewayTarget.isCurrent;

  return [gatewayTarget, ...storefrontTargets].map((target) => ({
    ...target,
    isCurrent: gatewayIsCurrent ? target.id === 'gateway' : target.isCurrent,
  }));
};
