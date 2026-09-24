// Ratchet: every mutating admin route must carry a requireTrustDecision call.
// Static source scan (DB-free). adminSecurityRoutes.js is excluded by design:
// its mutations are the assurance bootstrap itself (passkey enrollment/challenge,
// recovery exchange) — requiring a trust step-up there would be circular, since
// passkey enrollment is how step-up capability is earned in the first place.
const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

const EXCLUDED_FILES = new Set([
    // Assurance bootstrap flows (passkey enrollment/challenge, recovery exchange,
    // session establishment). Trust step-up inputs, not admin state mutations.
    'adminSecurityRoutes.js',
]);

const collectAdminRouteFiles = () => fs.readdirSync(ROUTES_DIR)
    .filter((name) => /^admin.*\.js$/.test(name) && name !== 'index.js')
    .filter((name) => !EXCLUDED_FILES.has(name))
    .sort();

// Extract each full router.<method>(...) declaration via paren balancing so
// multi-line and inline-handler declarations are covered entirely.
const extractDeclarations = (source, method) => {
    const declarations = [];
    const opener = `router.${method}(`;
    let cursor = source.indexOf(opener);
    while (cursor !== -1) {
        let depth = 0;
        let end = cursor;
        for (let i = cursor + opener.length - 1; i < source.length; i += 1) {
            const ch = source[i];
            if (ch === '(') depth += 1;
            if (ch === ')') {
                depth -= 1;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        declarations.push(source.slice(cursor, end + 1));
        cursor = source.indexOf(opener, end + 1);
    }
    return declarations;
};

describe('Admin trust-decision coverage ratchet', () => {
    test('every mutating admin route declares requireTrustDecision', () => {
        const files = collectAdminRouteFiles();
        expect(files.length).toBeGreaterThanOrEqual(12);

        const gaps = [];
        for (const fileName of files) {
            const source = fs.readFileSync(path.join(ROUTES_DIR, fileName), 'utf8');
            for (const method of ['post', 'patch', 'put', 'delete']) {
                for (const declaration of extractDeclarations(source, method)) {
                    if (!declaration.includes('requireTrustDecision(')) {
                        gaps.push(`${fileName} :: ${declaration.split('\n')[0].slice(0, 120)}`);
                    }
                }
            }
        }

        expect(gaps).toEqual([]);
    });

    test('every wired trust action has an explicit admin policy (no unknown-action fallback)', () => {
        const { actionRegistry } = require('../trust/policies/actionRegistry');
        const files = collectAdminRouteFiles();

        const usedActions = new Set();
        for (const fileName of files) {
            const source = fs.readFileSync(path.join(ROUTES_DIR, fileName), 'utf8');
            const pattern = /requireTrustDecision\(\s*['"]([^'"]+)['"]/g;
            let match = pattern.exec(source);
            while (match) {
                usedActions.add(match[1]);
                match = pattern.exec(source);
            }
        }

        expect(usedActions.size).toBeGreaterThanOrEqual(10);
        const unregistered = [...usedActions].filter((action) => !actionRegistry[action]);
        expect(unregistered).toEqual([]);
    });
});
