const fs = require('fs');
const lines = fs.readFileSync('server/tests/csrfAuthRoutes.integration.test.js', 'utf8').split('\n');
const newLines = lines.slice(0, 150);
newLines.push(
    "                email: 'user-a@example.com',",
    "                name: 'User A',",
    "                phone: '+919876543210',",
    "            });",
    "",
    "        expect(reusedRes.statusCode).toBe(403);",
    "        expect(reusedRes.body.code).toBe('CSRF_TOKEN_INVALID');",
    "    }, 15000);",
    "});",
    ""
);
fs.writeFileSync('server/tests/csrfAuthRoutes.integration.test.js', newLines.join('\n'));
