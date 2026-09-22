const {
    escapeHtml,
    toCurrency,
} = require('../templateUtils');
const {
    renderShell,
    renderCta,
    renderStatusPill,
} = require('./designSystem');
const { flags } = require('../../../config/emailFlags');

// One flexible template for every post-purchase order event. The placed
// confirmation keeps its dedicated rich template; everything the customer
// needs from the later lifecycle events is the state, the headline and a
// link back to the order.
const EVENT_COPY = {
    order_confirmed: {
        subject: 'Your Aura order is confirmed',
        headline: 'Your order is confirmed and is being prepared.',
        status: { label: 'Confirmed', color: '#2563eb', tint: '#eff6ff', softBorder: '#bfdbfe'},
        accent: 'login',
    },
    order_shipped: {
        subject: 'Your Aura order has shipped',
        headline: 'Good news — your order is on its way.',
        status: { label: 'Shipped', color: '#7c3aed', tint: '#f5f3ff', softBorder: '#ddd6fe'},
        accent: 'login',
    },
    order_out_for_delivery: {
        subject: 'Your Aura order is out for delivery',
        headline: 'Your order is out for delivery today.',
        status: { label: 'Out for delivery', color: '#d97706', tint: '#fffbeb', softBorder: '#fde68a'},
        accent: 'forgot-password',
    },
    order_delivered: {
        subject: 'Your Aura order was delivered',
        headline: 'Your order has been delivered. Enjoy!',
        status: { label: 'Delivered', color: '#059669', tint: '#ecfdf5', softBorder: '#a7f3d0'},
        accent: 'signup',
    },
    order_cancelled: {
        subject: 'Your Aura order was cancelled',
        headline: 'Your order has been cancelled.',
        status: { label: 'Cancelled', color: '#e11d48', tint: '#fff1f2', softBorder: '#fecdd3'},
        accent: 'payment-challenge',
    },
    order_refunded: {
        subject: 'Your Aura refund is on the way',
        headline: 'A refund for your order has been processed.',
        status: { label: 'Refunded', color: '#0891b2', tint: '#ecfeff', softBorder: '#a5f3fc'},
        accent: 'login',
    },
    replacement_approved: {
        subject: 'Your Aura replacement request was approved',
        headline: 'Your replacement request has been approved.',
        status: { label: 'Replacement approved', color: '#2563eb', tint: '#eff6ff', softBorder: '#bfdbfe'},
        accent: 'login',
    },
    replacement_dispatched: {
        subject: 'Your Aura replacement has shipped',
        headline: 'Your replacement is on its way.',
        status: { label: 'Replacement shipped', color: '#7c3aed', tint: '#f5f3ff', softBorder: '#ddd6fe'},
        accent: 'login',
    },
};

const renderOrderEventTemplate = (eventType, payload = {}) => {
    const copy = EVENT_COPY[eventType] || {
        subject: 'An update on your Aura order',
        headline: 'Your order has an update.',
        status: { label: 'Update', color: '#475569' },
        accent: 'neutral',
    };
    const orderId = String(payload.orderId || '');
    const shortOrderId = orderId ? orderId.slice(-8).toUpperCase() : 'NA';
    const customerName = escapeHtml(payload.customerName || 'Customer');
    const message = escapeHtml(payload.message || copy.headline);
    const detailLines = Array.isArray(payload.details) ? payload.details : [];
    const trackingId = escapeHtml(String(payload.trackingId || ''));
    const viewOrdersLink = `${flags.appPublicUrl.replace(/\/$/, '')}/orders`;

    const detailHtml = detailLines.length ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;background-color:#f8fafc;border:1px solid #e4e8f1;border-radius:12px;">
    <tr>
      <td style="padding:12px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.7;color:#334155;">
        ${detailLines.map((line) => escapeHtml(line)).join('<br/>')}
      </td>
    </tr>
  </table>` : '';

    const trackingHtml = trackingId ? `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;background-color:#f8fafc;border:1px solid #e4e8f1;border-radius:12px;">
    <tr>
      <td style="padding:12px 16px;">
        <span style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;">Tracking ID&nbsp;&nbsp;</span>
        <span style="font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:700;color:#111827;">${trackingId}</span>
      </td>
    </tr>
  </table>` : '';

    const orderTotal = Number(payload.totalPrice || 0);

    const bodyHtml = `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
    <tr>
      <td>${renderStatusPill(copy.status)}</td>
    </tr>
  </table>
  <p style="margin:0 0 4px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;line-height:1.25;color:#111827;">Hi ${customerName},</p>
  <p style="margin:0 0 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#64748b;">${message}</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e4e8f1;border-radius:12px;">
    <tr>
      <td style="padding:12px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;">Order</td>
            <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:700;color:#111827;">#${shortOrderId}${orderTotal > 0 ? ` &middot; ${toCurrency(orderTotal)}` : ''}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  ${trackingHtml}
  ${detailHtml}

  ${renderCta({ url: escapeHtml(viewOrdersLink), label: 'View your orders', accent: copy.accent })}`;

    const html = renderShell({
        subject: `${copy.subject} (#${shortOrderId})`,
        preheader: `${message} Order #${shortOrderId}.`,
        eyebrow: 'Order Update',
        accent: copy.accent,
        bodyHtml,
        footerNote: 'You are receiving this because you opted in to order updates for your Aura account.',
    });

    const text = [
        `Hi ${payload.customerName || 'Customer'},`,
        message,
        `[${copy.status.label}] Order #${shortOrderId}${orderTotal > 0 ? ` - ${toCurrency(orderTotal)}` : ''}`,
        trackingId ? `Tracking ID: ${payload.trackingId}` : '',
        ...detailLines,
        `View your orders: ${viewOrdersLink}`,
    ].filter(Boolean).join('\n');

    return {
        subject: `${copy.subject} (#${shortOrderId})`,
        html,
        text,
    };
};

module.exports = { renderOrderEventTemplate, EVENT_COPY };
