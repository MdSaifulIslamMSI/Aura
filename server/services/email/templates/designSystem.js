// Shared email design system for every Aura transactional email.
//
// Rules baked into this module:
// - Table-based layout with inline styles only (Gmail/Outlook/Apple Mail safe).
// - Light theme: dark emails render unpredictably in Gmail dark mode; light
//   cards with dark text invert gracefully and read as "official".
// - No external images or fonts: brand is typographic, icons are CSS shapes,
//   so nothing is blocked by default image settings.
// - One shell + reusable components so every email looks like the same brand.

const { escapeHtml } = require('../templateUtils');

const PALETTE = {
    pageBg: '#edf0f7',
    cardBg: '#ffffff',
    cardBorder: '#e4e8f1',
    headerBg: '#0a1122',
    headerWordmark: '#ffffff',
    headerMuted: '#8ea0bf',
    bodyBg: '#ffffff',
    textPrimary: '#111827',
    textSecondary: '#64748b',
    textTertiary: '#94a3b8',
    hairline: '#eef1f6',
    chipBg: '#f1f5f9',
    footerBg: '#f8fafc',
};

// Per-purpose accent: { primary, tint (soft bg), wash (page-tone bg) }.
const ACCENTS = {
    login: { primary: '#2563eb', tint: '#eff6ff', wash: '#f5f8ff' },
    signup: { primary: '#059669', tint: '#ecfdf5', wash: '#f2fbf7' },
    'forgot-password': { primary: '#d97706', tint: '#fffbeb', wash: '#fffaf0' },
    'payment-challenge': { primary: '#e11d48', tint: '#fff1f2', wash: '#fff5f6' },
    neutral: { primary: '#0f172a', tint: '#f1f5f9', wash: '#f8fafc' },
};

const resolveAccent = (accent) => ACCENTS[accent] || ACCENTS.neutral;

const padPreheader = (text) => `${text}${'&nbsp;&zwnj;'.repeat(24)}`;

// Bulletproof CTA: table-wrapped so padding renders even in Outlook.
const renderCta = ({ url, label, accent = 'neutral', align = 'left' }) => {
    if (!url) return '';
    const tone = resolveAccent(accent);
    return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px;">
    <tr>
      <td align="${align}" bgcolor="${tone.primary}" style="border-radius:10px;">
        <a href="${url}"
           style="display:inline-block;padding:12px 22px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:.02em;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
};

// Status pill for order lifecycle events. Explicit 6-digit tint/border so the
// legacy bgcolor parser never falls back to a wrong solid color.
const renderStatusPill = ({ label, color = '#475569', tint = '#f1f5f9', softBorder = '#e2e8f0' }) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td bgcolor="${tint}" style="background-color:${tint};border:1px solid ${softBorder};border-radius:999px;padding:4px 12px;">
        <span style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${color};">
          ${label}
        </span>
      </td>
    </tr>
  </table>`;

// Key/value context table with hairline dividers.
const renderContextTable = ({ title, rows, accent = 'neutral' }) => {
    const tone = resolveAccent(accent);
    const rowHtml = rows.map(([label, value]) => `
      <tr>
        <td style="padding:9px 16px;width:168px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.textSecondary};vertical-align:top;">${label}</td>
        <td style="padding:9px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:${PALETTE.textPrimary};line-height:1.5;">${value}</td>
      </tr>
      <tr><td colspan="2" style="padding:0 16px;"><div style="height:1px;background-color:${PALETTE.hairline};line-height:1px;font-size:0;">&nbsp;</div></td></tr>`).join('');

    return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PALETTE.cardBg};border:1px solid ${PALETTE.cardBorder};border-radius:12px;overflow:hidden;">
    <tr>
      <td colspan="2" bgcolor="${tone.wash}" style="padding:11px 16px;border-bottom:1px solid ${PALETTE.cardBorder};">
        <span style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${tone.primary};">${title}</span>
      </td>
    </tr>
    ${rowHtml}
  </table>`;
};

// Soft callout boxes: tone 'warning' | 'info' | 'neutral'.
const renderCallout = ({ tone = 'neutral', text }) => {
    const tones = {
        warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
        info: { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
        neutral: { bg: '#f8fafc', border: '#e2e8f0', text: '#475569' },
    };
    const t = tones[tone] || tones.neutral;
    return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${t.bg};border:1px solid ${t.border};border-radius:10px;">
    <tr>
      <td style="padding:12px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:${t.text};">
        ${text}
      </td>
    </tr>
  </table>`;
};

// Full-page shell every template renders inside.
// Contract: `preheader` is RAW dynamic text (escaped here); every other
// interpolated field is call-site escaped by the caller.
const renderShell = ({
    subject,
    preheader = '',
    eyebrow = '',
    accent = 'neutral',
    bodyHtml,
    footerNote,
}) => {
    const tone = resolveAccent(accent);
    const safeEyebrow = eyebrow
        ? `<span style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:${tone.primary === '#0f172a' ? PALETTE.headerMuted : tone.primary};background-color:#ffffff14;border:1px solid #ffffff2e;border-radius:999px;padding:4px 10px;">${eyebrow}</span>`
        : '';

    return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.pageBg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${padPreheader(escapeHtml(preheader))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PALETTE.pageBg}" style="background-color:${PALETTE.pageBg};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;background-color:${PALETTE.cardBg};border:1px solid ${PALETTE.cardBorder};border-radius:16px;overflow:hidden;">
          <tr>
            <td bgcolor="${PALETTE.headerBg}" style="background-color:${PALETTE.headerBg};padding:22px 28px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:.24em;color:${PALETTE.headerWordmark};">AURA</td>
                  <td align="right">${safeEyebrow}</td>
                </tr>
              </table>
              <div style="height:3px;line-height:3px;font-size:0;background-color:${tone.primary};border-radius:2px;margin-top:14px;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 8px;background-color:${PALETTE.bodyBg};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td bgcolor="${PALETTE.footerBg}" style="background-color:${PALETTE.footerBg};padding:14px 28px 18px;border-top:1px solid ${PALETTE.hairline};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:${PALETTE.textTertiary};">
                    ${footerNote}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
          <tr>
            <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${PALETTE.textTertiary};">
              Aura &middot; Secure by design
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

module.exports = {
    PALETTE,
    ACCENTS,
    resolveAccent,
    renderShell,
    renderCta,
    renderContextTable,
    renderCallout,
    renderStatusPill,
};
