const crypto = require('crypto');

const CATEGORY_ART = {
    Mobiles: {
        palette: ['#14b8a6', '#0f766e', '#67e8f9'],
        badge: '5G READY',
        graphic: (accent, glow) => `
            <rect x="92" y="56" width="176" height="312" rx="28" fill="#07111d" stroke="${glow}" stroke-width="4"/>
            <rect x="108" y="84" width="144" height="240" rx="20" fill="url(#panelGlow)" opacity="0.95"/>
            <circle cx="180" cy="346" r="12" fill="${accent}" opacity="0.9"/>
            <rect x="156" y="66" width="48" height="8" rx="4" fill="#d8fefe" opacity="0.5"/>
        `,
    },
    Laptops: {
        palette: ['#60a5fa', '#1d4ed8', '#c4b5fd'],
        badge: 'CREATOR CLASS',
        graphic: (accent, glow) => `
            <rect x="72" y="92" width="216" height="150" rx="18" fill="#0a1220" stroke="${glow}" stroke-width="4"/>
            <rect x="92" y="112" width="176" height="110" rx="12" fill="url(#panelGlow)" opacity="0.92"/>
            <path d="M48 268h264l22 34H26z" fill="#182536" stroke="${glow}" stroke-width="3"/>
            <rect x="156" y="282" width="48" height="8" rx="4" fill="${accent}" opacity="0.85"/>
        `,
    },
    Electronics: {
        palette: ['#f97316', '#ea580c', '#fb7185'],
        badge: 'SMART ELECTRONICS',
        graphic: (accent, glow) => `
            <circle cx="180" cy="186" r="78" fill="#08111d" stroke="${glow}" stroke-width="4"/>
            <circle cx="180" cy="186" r="44" fill="url(#panelGlow)" opacity="0.95"/>
            <circle cx="180" cy="186" r="18" fill="${accent}"/>
            <rect x="98" y="280" width="164" height="24" rx="12" fill="#162233"/>
        `,
    },
    "Men's Fashion": {
        palette: ['#f59e0b', '#d97706', '#fb923c'],
        badge: 'TAILORED FIT',
        graphic: (accent, glow) => `
            <path d="M124 96l24-22h64l24 22 34 18-18 42-28-14v146H108V142l-28 14-18-42z" fill="#0f1724" stroke="${glow}" stroke-width="4"/>
            <path d="M148 74l32 26 32-26" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round"/>
        `,
    },
    "Women's Fashion": {
        palette: ['#ec4899', '#be185d', '#f9a8d4'],
        badge: 'SIGNATURE EDIT',
        graphic: (accent, glow) => `
            <path d="M180 80c24 0 38 18 38 42 0 16-6 30-10 42l56 126H96l56-126c-4-12-10-26-10-42 0-24 14-42 38-42z" fill="#111827" stroke="${glow}" stroke-width="4"/>
            <path d="M148 176h64" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
        `,
    },
    'Home & Kitchen': {
        palette: ['#22c55e', '#15803d', '#facc15'],
        badge: 'HOME ESSENTIAL',
        graphic: (accent, glow) => `
            <rect x="120" y="92" width="120" height="180" rx="26" fill="#0c1520" stroke="${glow}" stroke-width="4"/>
            <rect x="144" y="126" width="72" height="72" rx="18" fill="url(#panelGlow)" opacity="0.92"/>
            <path d="M124 126c-22 0-36 18-36 42 0 30 20 54 48 54" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round"/>
            <rect x="156" y="286" width="48" height="10" rx="5" fill="${accent}" opacity="0.85"/>
        `,
    },
    'Gaming & Accessories': {
        palette: ['#8b5cf6', '#6d28d9', '#22d3ee'],
        badge: 'LOW LATENCY',
        graphic: (accent, glow) => `
            <path d="M106 214c-14 0-24-10-24-24 0-44 32-84 98-84s98 40 98 84c0 14-10 24-24 24h-28l-30-26h-32l-30 26z" fill="#0b1220" stroke="${glow}" stroke-width="4"/>
            <circle cx="146" cy="176" r="12" fill="${accent}"/>
            <circle cx="214" cy="166" r="8" fill="#d8fefe" opacity="0.8"/>
            <circle cx="236" cy="186" r="8" fill="#d8fefe" opacity="0.8"/>
        `,
    },
    Books: {
        palette: ['#6366f1', '#4338ca', '#93c5fd'],
        badge: 'EDITOR PICK',
        graphic: (accent, glow) => `
            <path d="M92 90h92c20 0 36 16 36 36v164H128c-20 0-36-16-36-36z" fill="#0f1724" stroke="${glow}" stroke-width="4"/>
            <path d="M268 90h-92c-20 0-36 16-36 36v164h92c20 0 36-16 36-36z" fill="#111c2b" stroke="${glow}" stroke-width="4"/>
            <path d="M180 120v140" stroke="${accent}" stroke-width="8" stroke-linecap="round"/>
        `,
    },
    Footwear: {
        palette: ['#f97316', '#ea580c', '#38bdf8'],
        badge: 'ALL-TERRAIN',
        graphic: (accent, glow) => `
            <path d="M90 220c18-28 48-46 88-46 26 0 50 8 82 28l40 12c10 3 16 12 16 22v18H72v-20c0-6 4-12 10-14z" fill="#0f1724" stroke="${glow}" stroke-width="4"/>
            <path d="M126 206h52c28 0 48 6 82 24" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round"/>
        `,
    },
};

const escapeXml = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const hashString = (value = '') => {
    const digest = crypto.createHash('sha1').update(String(value)).digest('hex');
    return parseInt(digest.slice(0, 8), 16);
};

const shortenText = (value, max = 34) => {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
};

const buildCatalogArtworkUrl = ({ externalId, title, brand, category }) => {
    const params = new URLSearchParams({
        title: String(title || ''),
        brand: String(brand || ''),
        category: String(category || ''),
    });
    return `/api/products/art/${encodeURIComponent(String(externalId || 'item'))}.svg?${params.toString()}`;
};

const renderCatalogArtworkSvg = ({ externalId, title, brand, category }) => {
    const safeCategory = CATEGORY_ART[category] ? category : 'Electronics';
    const profile = CATEGORY_ART[safeCategory];
    const seed = hashString(`${externalId}|${title}|${brand}|${safeCategory}`);
    const [accent, shadow, glow] = profile.palette;
    const orbitX = 60 + (seed % 240);
    const orbitY = 44 + ((seed >> 4) % 120);
    const orbitRadius = 24 + ((seed >> 7) % 42);
    const sparkX = 260 + ((seed >> 9) % 70);
    const sparkY = 70 + ((seed >> 12) % 90);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 360 360" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bgGlow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07111c"/>
      <stop offset="55%" stop-color="#0a1727"/>
      <stop offset="100%" stop-color="#08101b"/>
    </linearGradient>
    <radialGradient id="panelGlow" cx="35%" cy="30%" r="85%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.95"/>
      <stop offset="60%" stop-color="${shadow}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#050b14" stop-opacity="0.9"/>
    </radialGradient>
    <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
  </defs>

  <rect width="360" height="360" fill="url(#bgGlow)"/>
  <circle cx="${orbitX}" cy="${orbitY}" r="${orbitRadius}" fill="${accent}" fill-opacity="0.18" filter="url(#softBlur)"/>
  <circle cx="${sparkX}" cy="${sparkY}" r="18" fill="${glow}" fill-opacity="0.14" filter="url(#softBlur)"/>
  <rect x="28" y="28" width="304" height="304" rx="28" fill="#0b1320" fill-opacity="0.62" stroke="rgba(255,255,255,0.08)"/>
  ${profile.graphic(accent, glow)}
  <rect x="34" y="284" width="122" height="26" rx="13" fill="${accent}" fill-opacity="0.12" stroke="${accent}" stroke-opacity="0.55"/>
  <text x="48" y="301" fill="#d8fefe" font-size="12" font-family="Segoe UI, Arial, sans-serif" letter-spacing="1.6">${escapeXml(profile.badge)}</text>
  <text x="38" y="326" fill="#f8fafc" font-size="26" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${escapeXml(shortenText(title, 24))}</text>
  <text x="38" y="346" fill="#93c5fd" font-size="13" font-family="Segoe UI, Arial, sans-serif" letter-spacing="1.2">${escapeXml(shortenText(`${brand} • ${safeCategory}`, 38))}</text>
</svg>`;
};

module.exports = {
    buildCatalogArtworkUrl,
    renderCatalogArtworkSvg,
};
