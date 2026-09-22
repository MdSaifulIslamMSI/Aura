const { escapeHtml } = require('../templateUtils');
const {
    renderShell,
    renderContextTable,
    renderCallout,
    resolveAccent,
} = require('./designSystem');

const PURPOSE_META = {
    signup: {
        subject: 'Aura Security Code - Complete Signup',
        title: 'Confirm Your New Account',
        actionLine: 'Use this security code to complete your Aura signup.',
        accent: 'signup',
    },
    login: {
        subject: 'Aura Security Code - Login Verification',
        title: 'Login Verification Required',
        actionLine: 'Use this security code to continue login.',
        accent: 'login',
    },
    'forgot-password': {
        subject: 'Aura Security Code - Password Reset',
        title: 'Password Reset Verification',
        actionLine: 'Use this security code to continue password reset.',
        accent: 'forgot-password',
    },
    'payment-challenge': {
        subject: 'Aura Security Code - Payment Challenge',
        title: 'Payment Security Challenge',
        actionLine: 'Use this security code to approve the payment challenge.',
        accent: 'payment-challenge',
    },
};

const normalizePurpose = (purpose) => {
    const key = String(purpose || '').trim();
    return PURPOSE_META[key] ? key : 'login';
};

const renderOtpTemplate = ({
    otp,
    purpose,
    context = {},
    brand = 'AURA',
    ttlMinutes = 5,
}) => {
    const resolvedPurpose = normalizePurpose(purpose);
    const meta = PURPOSE_META[resolvedPurpose];
    const tone = resolveAccent(meta.accent);
    const code = String(otp || '').trim();
    const spacedCode = escapeHtml(code.split('').join(' '));
    const expiry = Number.isFinite(Number(ttlMinutes)) ? Number(ttlMinutes) : 5;

    const requestTime = escapeHtml(context.requestTime || '-');
    const maskedIp = escapeHtml(context.maskedIp || 'Unavailable');
    const deviceLabel = escapeHtml(context.deviceLabel || 'Unknown device');
    const locationLabel = escapeHtml(context.locationLabel || 'Approximate location unavailable');
    const purposeLabel = escapeHtml(context.purposeLabel || resolvedPurpose);
    const subject = meta.subject;
    // The shell escapes the preheader, so pass the raw value here.
    const preheader = `Security code for ${context.purposeLabel || resolvedPurpose}. Expires in ${expiry} minutes.`;

    const bodyHtml = `
  <p style="margin:0 0 4px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;line-height:1.25;color:#111827;">${escapeHtml(meta.title)}</p>
  <p style="margin:0 0 18px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#64748b;">${escapeHtml(meta.actionLine)}</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tone.tint}" style="background-color:${tone.tint};border:1.5px solid ${tone.primary};border-radius:14px;">
    <tr>
      <td align="center" style="padding:16px 14px 6px;">
        <span style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:${tone.primary};">Your security code</span>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:6px 14px 18px;">
        <span style="font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:800;letter-spacing:12px;text-indent:12px;line-height:1.1;color:#111827;">${spacedCode}</span>
      </td>
    </tr>
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
    <tr>
      <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;">
        This code expires in <strong style="color:${tone.primary};">${expiry} minutes</strong>. Each code works once.
      </td>
    </tr>
  </table>

  <div style="margin-top:16px;">
    ${renderCallout({ tone: 'info', text: 'Aura will never ask for this code by phone, chat, or social media.' })}
  </div>

  <div style="margin-top:16px;">
    ${renderContextTable({
        title: 'Security Request Context',
        accent: meta.accent,
        rows: [
            ['Purpose', purposeLabel],
            ['Request Time', requestTime],
            ['Device', deviceLabel],
            ['Source IP', maskedIp],
            ['Location', locationLabel],
        ],
    })}
  </div>

  <div style="margin-top:16px;">
    ${renderCallout({ tone: 'warning', text: '<strong>If this request was not made by you,</strong> secure your account immediately by resetting your password and reviewing recent account activity.' })}
  </div>`;

    const html = renderShell({
        subject,
        preheader,
        eyebrow: meta.title,
        accent: meta.accent,
        bodyHtml,
        footerNote: 'This is an automated security message from Aura. Do not reply to this email.',
    });

    const text = [
        `${meta.title}`,
        '',
        `${meta.actionLine}`,
        `Security code: ${code}`,
        `Expires in: ${expiry} minutes (each code works once)`,
        '',
        'Security request context:',
        `Purpose: ${context.purposeLabel || resolvedPurpose}`,
        `Request Time: ${context.requestTime || '-'}`,
        `Device: ${context.deviceLabel || 'Unknown device'}`,
        `Source IP: ${context.maskedIp || 'Unavailable'}`,
        `Location: ${context.locationLabel || 'Approximate location unavailable'}`,
        '',
        'Aura will never ask for this code by phone, chat, or social media.',
        'If this was not you, reset your password immediately and review account activity.',
    ].join('\n');

    return {
        subject,
        html,
        text,
        preheader,
    };
};

module.exports = {
    renderOtpTemplate,
};
