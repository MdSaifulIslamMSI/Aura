const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanSensitiveRoutes } = require('../../../scripts/security/sensitive-route-scanner-lib.cjs');

describe('sensitive route coverage scanner', () => {
    test('detects unprotected sensitive route', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-scan-'));
        const exceptionsFile = path.join(tempDir, 'exceptions.json');
        fs.writeFileSync(exceptionsFile, '[]');
        fs.writeFileSync(path.join(tempDir, 'adminRoutes.js'), `
            const express = require('express');
            const router = express.Router();
            router.post('/users/:id/role', controller.updateRole);
            module.exports = router;
        `);

        const result = scanSensitiveRoutes({ routeDir: tempDir, exceptionsFile });

        expect(result.ok).toBe(false);
        expect(result.findings[0].route).toBe('/users/:id/role');
    });

    test('accepts approved security decision middleware', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-scan-'));
        const exceptionsFile = path.join(tempDir, 'exceptions.json');
        fs.writeFileSync(exceptionsFile, '[]');
        fs.writeFileSync(path.join(tempDir, 'adminRoutes.js'), `
            const express = require('express');
            const { requireSecurityDecision } = require('../middleware/requireSecurityDecision');
            const router = express.Router();
            router.post('/users/:id/role', requireSecurityDecision('admin.role.change'), controller.updateRole);
            module.exports = router;
        `);

        const result = scanSensitiveRoutes({ routeDir: tempDir, exceptionsFile });

        expect(result.ok).toBe(true);
        expect(result.findings).toHaveLength(0);
    });
});
