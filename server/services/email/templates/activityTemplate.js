const { escapeHtml, toReadableDateTime } = require('../templateUtils');
const {
    renderShell,
    renderContextTable,
    renderCallout,
    renderCta,
} = require('./designSystem');

const renderHighlightsHtml = (highlights = []) => {
    if (!Array.isArray(highlights) || highlights.length === 0) {
        return `<li style="margin:0 0 8px;color:#64748b;">No additional details were provided.</li>`;
    }

    return highlights
        .map((entry) => `<li style="margin:0 0 8px;color:#334155;line-height:1.55;">${escapeHtml(entry)}</li>`)
        .join('');
};

const renderHighlightsText = (highlights = []) => {
    if (!Array.isArray(highlights) || highlights.length === 0) {
        return '- No additional details were provided.';
    }
    return highlights.map((entry) => `- ${entry}`).join('\n');
};

const renderActivityTemplate = ({
    brand = 'AURA',
    userName = '',
    actionTitle = 'Account activity update',
    actionSummary = '',
    highlights = [],
    requestId = '',
    method = '',
    path = '',
    deviceLabel = 'Unknown device',
    maskedIp = 'Unavailable',
    occurredAt = new Date(),
    ctaUrl = '',
    ctaLabel = 'Open Security Dashboard',
}) => {
    const greetingName = String(userName || '').trim() || 'there';
    const safeTitle = escapeHtml(actionTitle);
    const safeSummary = escapeHtml(actionSummary || 'A secure action was completed in your Aura account.');
    const safeRequestId = escapeHtml(requestId || '-');
    const safeMethod = escapeHtml(method || '-');
    const safePath = escapeHtml(path || '-');
    const safeCta = escapeHtml(ctaUrl || '');
    const safeCtaLabel = escapeHtml(ctaLabel || 'Open Security Dashboard');
    const safeDevice = escapeHtml(deviceLabel || 'Unknown device');
    const safeIp = escapeHtml(maskedIp || 'Unavailable');
    const timestamp = toReadableDateTime(occurredAt);

    const subject = `${brand} Security Activity: ${actionTitle}`.slice(0, 140);
    const preheader = `${actionSummary || actionTitle} | ${timestamp}`;

    const bodyHtml = `
  <p style="margin:0 0 4px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;line-height:1.25;color:#111827;">${safeTitle}</p>
  <p style="margin:0 0 18px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#64748b;">${safeSummary}</p>

  <p style="margin:0 0 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#334155;">Hi <strong>${escapeHtml(greetingName)}</strong>,</p>

  ${renderContextTable({
      title: 'Operation Details',
      accent: 'neutral',
      rows: [
          ['Time', `${escapeHtml(timestamp)} IST`],
          ['Request ID', safeRequestId],
          ['HTTP', `${safeMethod} ${safePath}`],
          ['Device', safeDevice],
          ['IP', safeIp],
      ],
  })}

  <p style="margin:20px 0 10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#2563eb;">What changed</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e4e8f1;border-radius:12px;">
    <tr>
      <td style="padding:14px 16px 14px 30px;">
        <ul style="padding-left:16px;margin:0;">
          ${renderHighlightsHtml(highlights)}
        </ul>
      </td>
    </tr>
  </table>

  ${safeCta ? renderCta({ url: safeCta, label: safeCtaLabel, accent: 'login' }) : ''}

  <div style="margin-top:18px;">
    ${renderCallout({ tone: 'warning', text: '<strong>If this action was not initiated by you,</strong> reset your password immediately and contact Aura support. Aura will never ask for OTPs, passwords, or card secrets over email or chat.' })}
  </div>`;

    const html = renderShell({
        subject,
        preheader,
        eyebrow: 'Security Activity',
        accent: 'login',
        bodyHtml,
        footerNote: `${escapeHtml(brand)} • Automated activity notice • Do not reply to this email.`,
    });

    const text = [
        `${brand} Security Activity`,
        '',
        `Hi ${greetingName},`,
        actionSummary || 'A successful action was completed on your Aura account.',
        '',
        'Operation Details',
        `- Time: ${timestamp} IST`,
        `- Request ID: ${requestId || '-'}`,
        `- HTTP: ${method || '-'} ${path || '-'}`,
        `- Device: ${deviceLabel || 'Unknown device'}`,
        `- IP: ${maskedIp || 'Unavailable'}`,
        '',
        'What changed:',
        renderHighlightsText(highlights),
        '',
        ctaUrl ? `Security dashboard: ${ctaUrl}` : '',
        '',
        'If this was not you, reset your password immediately and contact support.',
        `${brand} will never ask for OTPs, passwords, or card secrets over email.`,
    ].filter(Boolean).join('\n');

    return { subject, html, text };
};

module.exports = {
    renderActivityTemplate,
};
