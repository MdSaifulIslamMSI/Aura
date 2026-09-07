const { buildProfileSupportUrl } = require('../utils/frontendLinks');

describe('frontendLinks.buildProfileSupportUrl', () => {
  test('always scopes to the support tab', () => {
    expect(buildProfileSupportUrl()).toBe('/profile?tab=support');
  });

  test('attaches ticket, compose and category context', () => {
    const url = buildProfileSupportUrl({ ticketId: 't-1', compose: true, category: 'order_issue' });
    expect(url).toContain('ticket=t-1');
    expect(url).toContain('compose=1');
    expect(url).toContain('category=order_issue');
  });

  test('encodes subjects and intents safely', () => {
    const url = buildProfileSupportUrl({ subject: 'Refund & return?', intent: 'track order' });
    expect(url).toContain('subject=Refund+%26+return%3F');
    expect(url).toContain('intent=track+order');
  });

  test('omits empty optionals', () => {
    expect(buildProfileSupportUrl({})).toBe('/profile?tab=support');
  });

  test('stringifies non-string ids', () => {
    const params = new URLSearchParams(buildProfileSupportUrl({ ticketId: 42 }).split('?')[1]);
    expect(params.get('ticket')).toBe('42');
  });
});
