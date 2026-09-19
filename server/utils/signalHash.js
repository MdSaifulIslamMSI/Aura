const crypto = require('crypto');
const { safeString } = require('./safeString');

// Truncated hash for client request signals (ip, user agent) stored on
// money/risk collections. Lookup-only: equality against the hash of the
// incoming request's own value. NOT a blind index — a truncated unsalted
// hash is reversible in principle for low-entropy inputs like IPv4, so
// never treat it as anonymity, only as "no raw signal at rest".
const hashSignalValue = (value) => {
    const clean = safeString(value);
    if (!clean) return '';
    return crypto.createHash('sha256').update(clean).digest('hex').slice(0, 24);
};

module.exports = {
    hashSignalValue,
};
