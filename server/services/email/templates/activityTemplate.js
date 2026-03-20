const { escapeHtml, toReadableDateTime } = require('../templateUtils');

const renderHighlightsHtml = (highlights = []) => {
    if (!Array.isArray(highlights) || highlights.length === 0) {
        return '<li style="margin:0 0 8px;color:#CBD5E1;">No additional details were provided.</li>';
    }

    return highlights
        .map((entry) => `<li style="margin:0 0 8px;color:#CBD5E1;">${escapeHtml(entry)}</li>`)
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
    const safeDevice = escapeHtml(deviceLabel || 'Unknown device');
    const safeIp = escapeHtml(maskedIp || 'Unavailable');
    const safeCta = escapeHtml(ctaUrl || '');
    const safeCtaLabel = escapeHtml(ctaLabel || 'Open Security Dashboard');
    const timestamp = toReadableDateTime(occurredAt);

    const subject = `${brand} Security Activity: ${actionTitle}`.slice(0, 140);
    const preheader = `${actionSummary || actionTitle} | ${timestamp}`;

    const html = `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#020617;color:#E2E8F0;font-family:Inter,Segoe UI,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#020617,#0F172A);padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border:1px solid rgba(148,163,184,.25);border-radius:18px;overflow:hidden;background:#0B1220;">
            <tr>
              <td style="padding:24px 24px 18px;background:linear-gradient(90deg,#0B1220,#1E293B);border-bottom:1px solid rgba(148,163,184,.2);">
                <div style="font-size:12px;letter-spacing:.18em;color:#22D3EE;font-weight:700;text-transform:uppercase;">${escapeHtml(brand)} Security Command</div>
                <h1 style="margin:10px 0 4px;font-size:26px;line-height:1.2;color:#F8FAFC;">${safeTitle}</h1>
                <p style="margin:0;color:#94A3B8;font-size:14px;line-height:1.5;">${safeSummary}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 24px;">
                <p style="margin:0 0 14px;color:#E2E8F0;font-size:14px;line-height:1.5;">Hi ${escapeHtml(greetingName)},</p>
                <p style="margin:0 0 18px;color:#CBD5E1;font-size:14px;line-height:1.6;">
                  We detected and verified a successful action on your Aura account. Review the operation details below for full transparency.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid rgba(56,189,248,.35);background:rgba(14,116,144,.12);border-radius:12px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-size:12px;color:#67E8F9;text-transform:uppercase;letter-spacing:.12em;font-weight:700;">Operation Details</div>
                      <div style="margin-top:10px;color:#E2E8F0;font-size:13px;line-height:1.6;">
                        <div><strong>Time:</strong> ${escapeHtml(timestamp)} IST</div>
                        <div><strong>Request ID:</strong> ${safeRequestId}</div>
                        <div><strong>HTTP:</strong> ${safeMethod} ${safePath}</div>
                        <div><strong>Device:</strong> ${safeDevice}</div>
                        <div><strong>IP:</strong> ${safeIp}</div>
                      </div>
                    </td>
                  </tr>
                </table>

                <h3 style="margin:22px 0 10px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#22D3EE;">What changed</h3>
                <ul style="padding-left:18px;margin:0 0 20px;">
                  ${renderHighlightsHtml(highlights)}
                </ul>

                ${safeCta ? `
                <div style="margin:0 0 18px;">
                  <a href="${safeCta}" style="display:inline-block;padding:12px 18px;background:linear-gradient(90deg,#06B6D4,#10B981);color:#F8FAFC;text-decoration:none;border-radius:10px;font-size:13px;font-weight:700;letter-spacing:.04em;">
                    ${safeCtaLabel}
                  </a>
                </div>` : ''}

                <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.6;">
                  If this action was not initiated by you, reset your password immediately and contact Aura support.
                  Aura will never ask for OTPs, passwords, or card secrets over email or chat.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px;border-top:1px solid rgba(148,163,184,.2);background:#060C18;">
                <p style="margin:0;font-size:11px;color:#64748B;letter-spacing:.08em;text-transform:uppercase;">
                  ${escapeHtml(brand)} • Automated activity notice • Do not reply
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

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
