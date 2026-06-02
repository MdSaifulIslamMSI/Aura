import { defineMessages } from 'react-intl';

const backendFailureMessages = defineMessages({
  catalogTimeoutTitle: {
    id: 'backendFailure.catalog.timeout.title',
    defaultMessage: 'Catalog request timed out',
  },
  catalogTimeoutMessage: {
    id: 'backendFailure.catalog.timeout.message',
    defaultMessage: 'The catalog service took too long to respond. Please retry in a few seconds.',
  },
  catalogUnavailableTitle: {
    id: 'backendFailure.catalog.unavailable.title',
    defaultMessage: 'Catalog backend unavailable',
  },
  catalogUnavailableMessage: {
    id: 'backendFailure.catalog.unavailable.message',
    defaultMessage: 'The catalog service is temporarily offline or waking up. Please retry in a few moments.',
  },
  catalogUnreachableTitle: {
    id: 'backendFailure.catalog.unreachable.title',
    defaultMessage: 'Catalog service unreachable',
  },
  catalogUnreachableMessage: {
    id: 'backendFailure.catalog.unreachable.message',
    defaultMessage: 'The frontend cannot reach the catalog service right now. Please retry shortly.',
  },
  catalogFailedTitle: {
    id: 'backendFailure.catalog.failed.title',
    defaultMessage: 'Catalog fetch failed',
  },
  catalogFailedMessage: {
    id: 'backendFailure.catalog.failed.message',
    defaultMessage: 'Unable to load products right now. Please retry.',
  },
});

const HTML_RESPONSE_PATTERN = /<!doctype html|<html[\s>]/i;
const NETWORK_FAILURE_PATTERNS = [
  /failed to fetch/i,
  /network\s*error/i,
  /load failed/i,
  /connection was closed unexpectedly/i,
  /econnrefused/i,
  /fetch failed/i,
  /cannot reach/i,
];
const TIMEOUT_PATTERNS = [
  /request timed out/i,
  /\btimeout\b/i,
];
const UPSTREAM_OUTAGE_PATTERNS = [
  /bad gateway/i,
  /service is currently unavailable/i,
  /backend unavailable/i,
  /no-deploy/i,
  /upstream/i,
  /render/i,
];
const SERVICE_OUTAGE_STATUSES = new Set([500, 502, 503, 504]);

const collapseWhitespace = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const matchesAnyPattern = (value = '', patterns = []) => patterns.some((pattern) => pattern.test(value));

const formatBackendFailureMessage = (formatMessage, descriptor, values = {}) => {
  if (typeof formatMessage === 'function') {
    try {
      return formatMessage(descriptor, values);
    } catch {
      return descriptor.defaultMessage;
    }
  }

  return descriptor.defaultMessage;
};

const buildErrorSourceText = (error) => collapseWhitespace([
  error?.message,
  typeof error?.data === 'string' ? error.data : '',
  typeof error?.data?.message === 'string' ? error.data.message : '',
].filter(Boolean).join(' '));

export const summarizeBackendFailureDetail = ({ status = 0, detail = '' } = {}) => {
  const normalizedDetail = collapseWhitespace(detail);
  const numericStatus = Number(status) || 0;

  if (!normalizedDetail) {
    return numericStatus > 0 ? `HTTP ${numericStatus}` : '';
  }

  if (
    HTML_RESPONSE_PATTERN.test(normalizedDetail)
    || matchesAnyPattern(normalizedDetail, UPSTREAM_OUTAGE_PATTERNS)
  ) {
    return numericStatus > 0 ? `HTTP ${numericStatus} upstream outage` : 'Upstream outage';
  }

  if (matchesAnyPattern(normalizedDetail, TIMEOUT_PATTERNS)) {
    return numericStatus > 0 ? `HTTP ${numericStatus} timed out` : 'Request timed out';
  }

  if (matchesAnyPattern(normalizedDetail, NETWORK_FAILURE_PATTERNS)) {
    return 'Connection to API failed';
  }

  return normalizedDetail.length > 120
    ? `${normalizedDetail.slice(0, 117)}...`
    : normalizedDetail;
};

export const resolveProductListingFetchCopy = (error, formatMessage = null) => {
  const status = Number(error?.status) || 0;
  const sourceText = buildErrorSourceText(error);
  const detail = summarizeBackendFailureDetail({ status, detail: sourceText });

  if (matchesAnyPattern(sourceText, TIMEOUT_PATTERNS)) {
    return {
      title: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogTimeoutTitle),
      message: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogTimeoutMessage),
      detail,
    };
  }

  if (SERVICE_OUTAGE_STATUSES.has(status) || matchesAnyPattern(sourceText, UPSTREAM_OUTAGE_PATTERNS)) {
    return {
      title: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogUnavailableTitle),
      message: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogUnavailableMessage),
      detail,
    };
  }

  if (status === 0 || matchesAnyPattern(sourceText, NETWORK_FAILURE_PATTERNS)) {
    return {
      title: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogUnreachableTitle),
      message: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogUnreachableMessage),
      detail,
    };
  }

  return {
    title: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogFailedTitle),
    message: formatBackendFailureMessage(formatMessage, backendFailureMessages.catalogFailedMessage),
    detail,
  };
};
