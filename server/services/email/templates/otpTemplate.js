const { escapeHtml } = require('../templateUtils');

const PURPOSE_META = {
    signup: {
        subject: 'Aura Security Code - Complete Signup',
        title: 'Confirm Your New Account',
        actionLine: 'Use this security code to complete your Aura signup.',
    },
    login: {
        subject: 'Aura Security Code - Login Verification',
        title: 'Login Verification Required',
        actionLine: 'Use this security code to continue login.',
    },
    'forgot-password': {
        subject: 'Aura Security Code - Password Reset',
        title: 'Password Reset Verification',
        actionLine: 'Use this security code to continue password reset.',
    },
    'payment-challenge': {
        subject: 'Aura Security Code - Payment Challenge',
        title: 'Payment Security Challenge',
        actionLine: 'Use this security code to approve the payment challenge.',
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
    const code = String(otp || '').trim();
    const expiry = Number.isFinite(Number(ttlMinutes)) ? Number(ttlMinutes) : 5;

    const requestTime = escapeHtml(context.requestTime || '-');
    const maskedIp = escapeHtml(context.maskedIp || 'Unavailable');
    const deviceLabel = escapeHtml(context.deviceLabel || 'Unknown device');
    const locationLabel = escapeHtml(context.locationLabel || 'Approximate location unavailable');
    const purposeLabel = escapeHtml(context.purposeLabel || resolvedPurpose);
    const subject = meta.subject;
    const preheader = `Security code for ${purposeLabel}. Expires in ${expiry} minutes.`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#090b10;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#090b10;padding:20px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:92%;background:#10141d;border:1px solid #1f2937;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:24px;background:linear-gradient(135deg,#0f172a 0%,#1f2937 55%,#312e81 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" style="color:#f8fafc;font-size:22px;font-weight:800;letter-spacing:1px;">
                    ${escapeHtml(brand)}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:14px;color:#f8fafc;font-size:24px;font-weight:700;line-height:1.25;">
                    ${escapeHtml(meta.title)}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:8px;color:#cbd5e1;font-size:14px;line-height:1.5;">
                    ${escapeHtml(meta.actionLine)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 24px 22px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #0ea5e9;border-radius:12px;background:#061722;">
                <tr>
                  <td align="center" style="padding:20px 14px;color:#22d3ee;font-size:42px;font-weight:800;letter-spacing:14px;font-family:'Courier New',Courier,monospace;">
                    ${escapeHtml(code)}
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                <tr>
                  <td style="color:#e2e8f0;font-size:14px;line-height:1.55;">
                    This code expires in <strong style="color:#fb7185;">${expiry} minutes</strong>.
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:6px;color:#e2e8f0;font-size:14px;line-height:1.55;">
                    Aura will never ask for this code by phone, chat, or social media.
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border:1px solid #334155;border-radius:10px;background:#0b1220;">
                <tr>
                  <td colspan="2" style="padding:12px 14px;border-bottom:1px solid #334155;color:#e2e8f0;font-size:13px;font-weight:700;">
                    Security Request Context
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;color:#94a3b8;font-size:12px;width:180px;">Purpose</td>
                  <td style="padding:10px 14px;color:#e2e8f0;font-size:12px;">${purposeLabel}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;color:#94a3b8;font-size:12px;">Request Time</td>
                  <td style="padding:10px 14px;color:#e2e8f0;font-size:12px;">${requestTime}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;color:#94a3b8;font-size:12px;">Device</td>
                  <td style="padding:10px 14px;color:#e2e8f0;font-size:12px;">${deviceLabel}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;color:#94a3b8;font-size:12px;">Source IP</td>
                  <td style="padding:10px 14px;color:#e2e8f0;font-size:12px;">${maskedIp}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px;color:#94a3b8;font-size:12px;">Location</td>
                  <td style="padding:10px 14px;color:#e2e8f0;font-size:12px;">${locationLabel}</td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                <tr>
                  <td style="color:#cbd5e1;font-size:13px;line-height:1.6;">
                    If this request was not made by you, secure your account immediately by resetting your password and reviewing recent account activity.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:14px 24px 18px 24px;border-top:1px solid #1f2937;color:#64748b;font-size:11px;line-height:1.5;">
              This is an automated security message from Aura. Do not reply to this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = [
        `${meta.title}`,
        '',
        `${meta.actionLine}`,
        `Security code: ${code}`,
        `Expires in: ${expiry} minutes`,
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
