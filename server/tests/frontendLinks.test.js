const { buildProfileSupportUrl } = require('../utils/frontendLinks');

describe('frontendLinks.buildProfileSupportUrl', () => {
    test('always targets the profile support tab', () => {
        expect(buildProfileSupportUrl({})).toBe('/profile?tab=support');
        expect(buildProfileSupportUrl()).toBe('/profile?tab=support');
    });

    test('includes provided params and omits empty ones', () => {
        const url = buildProfileSupportUrl({
            ticketId: 'TCK-1',
            compose: true,
            category: 'order-issue',
            relatedActionId: 'act-9',
            subject: 'Refund help',
            intent: 'refund',
        });
        const params = new URLSearchParams(url.split('?')[1]);
        expect(params.get('tab')).toBe('support');
        expect(params.get('ticket')).toBe('TCK-1');
        expect(params.get('compose')).toBe('1');
        expect(params.get('category')).toBe('order-issue');
        expect(params.get('actionId')).toBe('act-9');
        expect(params.get('subject')).toBe('Refund help');
        expect(params.get('intent')).toBe('refund');
    });

    test('skips unset optional params', () => {
        const params = new URLSearchParams(buildProfileSupportUrl({ category: 'payments' }).split('?')[1]);
        expect(params.get('category')).toBe('payments');
        expect(params.has('ticket')).toBe(false);
        expect(params.has('compose')).toBe(false);
        expect(params.has('subject')).toBe(false);
    });

    test('stringifies non-string ids', () => {
        const params = new URLSearchParams(buildProfileSupportUrl({ ticketId: 42 }).split('?')[1]);
        expect(params.get('ticket')).toBe('42');
    });
});
