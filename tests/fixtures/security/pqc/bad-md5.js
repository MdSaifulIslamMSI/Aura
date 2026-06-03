const crypto = require('crypto');
crypto.createHash('md5').update('payload').digest('hex');
