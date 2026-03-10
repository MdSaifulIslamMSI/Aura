import { describe, expect, it } from 'vitest';
import {
  resolveProductListingFetchCopy,
  summarizeBackendFailureDetail,
} from './backendFailurePresentation';

describe('backendFailurePresentation', () => {
  it('summarizes HTML 502 responses into a short outage detail', () => {
    expect(summarizeBackendFailureDetail({
      status: 502,
      detail: '<!DOCTYPE html><html><body><h1>Bad Gateway</h1></body></html>',
    })).toBe('HTTP 502 upstream outage');
  });

  it('maps upstream outage errors to backend-unavailable copy', () => {
    expect(resolveProductListingFetchCopy({
      status: 502,
      message: 'Bad Gateway',
      data: '<!DOCTYPE html><html><body>Render no-deploy</body></html>',
    })).toMatchObject({
      title: 'Catalog backend unavailable',
      message: 'The catalog service is temporarily offline or waking up. Please retry in a few moments.',
      detail: 'HTTP 502 upstream outage',
    });
  });

  it('maps timeout failures to timeout copy', () => {
    expect(resolveProductListingFetchCopy({
      status: 0,
      message: 'Request timed out',
    })).toMatchObject({
      title: 'Catalog request timed out',
      detail: 'Request timed out',
    });
  });

  it('maps network failures to unreachable copy', () => {
    expect(resolveProductListingFetchCopy({
      status: 0,
      message: 'Failed to fetch',
    })).toMatchObject({
      title: 'Catalog service unreachable',
      detail: 'Connection to API failed',
    });
  });

  it('falls back to a generic fetch message for non-outage client errors', () => {
    expect(resolveProductListingFetchCopy({
      status: 404,
      message: 'Product feed not found',
    })).toMatchObject({
      title: 'Catalog fetch failed',
      message: 'Unable to load products right now. Please retry.',
      detail: 'Product feed not found',
    });
  });
});
