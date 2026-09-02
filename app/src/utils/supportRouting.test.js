import { describe, expect, it } from 'vitest';
import { buildSupportHandoffPath } from './supportRouting';

describe('buildSupportHandoffPath', () => {
  it('always opens the contact composer', () => {
    expect(buildSupportHandoffPath()).toBe('/contact?compose=1');
    expect(buildSupportHandoffPath({})).toBe('/contact?compose=1');
  });

  it('includes provided prefill fields', () => {
    const params = new URLSearchParams(
      buildSupportHandoffPath({
        category: 'order-issue',
        subject: 'Where is my order?',
        intent: 'track_order',
        actionId: 'act-12',
      }).split('?')[1]
    );
    expect(params.get('compose')).toBe('1');
    expect(params.get('category')).toBe('order-issue');
    expect(params.get('subject')).toBe('Where is my order?');
    expect(params.get('intent')).toBe('track_order');
    expect(params.get('actionId')).toBe('act-12');
  });

  it('omits blank fields and trims whitespace', () => {
    const params = new URLSearchParams(
      buildSupportHandoffPath({ category: '  payments  ', subject: '   ' }).split('?')[1]
    );
    expect(params.get('category')).toBe('payments');
    expect(params.has('subject')).toBe(false);
    expect(params.has('intent')).toBe(false);
  });
});
