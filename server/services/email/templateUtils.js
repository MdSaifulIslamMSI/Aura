const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toCurrency = (value) => {
    const num = Number(value || 0);
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 2,
    }).format(num);
};

const toReadableDateTime = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const compactAddress = (address = {}) => {
    const parts = [
        address.address,
        address.city,
        address.postalCode,
        address.country,
    ].map((value) => String(value || '').trim()).filter(Boolean);
    return parts.join(', ');
};

const normalizeIp = (value) => {
    const first = String(value || '').split(',')[0].trim();
    return first.replace(/^::ffff:/i, '');
};

const maskIpAddress = (value) => {
    const ip = normalizeIp(value);
    if (!ip) return 'Unavailable';

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
        const octets = ip.split('.');
        return `${octets[0]}.${octets[1]}.x.x`;
    }

    if (ip.includes(':')) {
        const groups = ip.split(':').filter(Boolean);
        if (groups.length >= 2) {
            return `${groups[0]}:${groups[1]}:****`;
        }
        return 'IPv6:****';
    }

    return 'Masked';
};

const getDeviceLabelFromUserAgent = (userAgent = '') => {
    const ua = String(userAgent || '').toLowerCase();
    if (!ua) return 'Unknown device';

    const isMobile = /mobile|iphone|ipod|android/.test(ua);
    const isTablet = /ipad|tablet/.test(ua);
    const device = isTablet ? 'Tablet' : isMobile ? 'Mobile' : 'Desktop';

    let browser = 'Browser';
    if (/edg\//.test(ua)) browser = 'Edge';
    else if (/opr\/|opera/.test(ua)) browser = 'Opera';
    else if (/chrome\//.test(ua) && !/edg\//.test(ua) && !/opr\/|opera/.test(ua)) browser = 'Chrome';
    else if (/firefox\//.test(ua)) browser = 'Firefox';
    else if (/safari\//.test(ua) && !/chrome\//.test(ua)) browser = 'Safari';

    return `${device} - ${browser}`;
};

const toIstUtcTimestamp = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
        return {
            ist: '-',
            utc: '-',
            display: '-',
        };
    }

    const ist = date.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const utc = date.toISOString().replace('T', ' ').replace('Z', '');

    return {
        ist,
        utc,
        display: `${ist} IST | ${utc} UTC`,
    };
};

module.exports = {
    escapeHtml,
    toCurrency,
    toReadableDateTime,
    compactAddress,
    maskIpAddress,
    getDeviceLabelFromUserAgent,
    toIstUtcTimestamp,
};
