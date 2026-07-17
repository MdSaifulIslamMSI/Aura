const fs = require('fs');
const path = require('path');
const assistantCapabilities = require('../../shared/assistantCapabilities.json');

describe('assistant capability manifest', () => {
    test('contains only curated user-facing routes that exist in the app router', () => {
        const appSource = fs.readFileSync(path.resolve(__dirname, '../../app/src/App.jsx'), 'utf8');
        const literalRoutes = new Set(
            [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]),
        );

        assistantCapabilities.forEach((capability) => {
            const route = String(capability.route || '').split('?')[0];
            expect(literalRoutes.has(route)).toBe(true);
            expect(capability).toMatchObject({
                id: expect.any(String),
                title: expect.any(String),
                aliases: expect.any(Array),
                route: expect.any(String),
                authRequired: expect.any(Boolean),
                description: expect.any(String),
                assistantAction: 'navigate_to',
            });
        });
    });

    test('keeps capability ids unique and excludes admin, trust, and status internals', () => {
        const ids = assistantCapabilities.map((capability) => capability.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.some((id) => /admin|trust|status/.test(id))).toBe(false);
    });
});
