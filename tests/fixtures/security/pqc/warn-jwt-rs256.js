const jwt = require('jsonwebtoken');
jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'RS256' });
