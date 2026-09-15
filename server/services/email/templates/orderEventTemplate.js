const {
    escapeHtml,
    toCurrency,
} = require('../templateUtils');
const { flags } = require('../../../config/emailFlags');

// One flexible template for every post-purchase order event. The placed
// confirmation keeps its dedicated rich template; everything the customer
// needs from the later lifecycle events is the state, the headline and a
// link back to the order.
const EVENT_COPY = {
    order_confirmed: {
        subject: 'Your Aura order is confirmed',
        headline: 'Your order is confirmed and is being prepared.',
    },
    order_shipped: {
        subject: 'Your Aura order has shipped',
        headline: 'Good news — your order is on its way.',
    },
    order_out_for_delivery: {
        subject: 'Your Aura order is out for delivery',
        headline: 'Your order is out for delivery today.',
    },
    order_delivered: {
        subject: 'Your Aura order was delivered',
        headline: 'Your order has been delivered. Enjoy!',
    },
    order_cancelled: {
        subject: 'Your Aura order was cancelled',
        headline: 'Your order has been cancelled.',
    },
    order_refunded: {
        subject: 'Your Aura refund is on the way',
        headline: 'A refund for your order has been processed.',
    },
    replacement_approved: {
        subject: 'Your Aura replacement request was approved',
        headline: 'Your replacement request has been approved.',
    },
    replacement_dispatched: {
        subject: 'Your Aura replacement has shipped',
        headline: 'Your replacement is on its way.',
    },
};

const renderOrderEventTemplate = (eventType, payload = {}) => {
    const copy = EVENT_COPY[eventType] || {
        subject: 'An update on your Aura order',
        headline: 'Your order has an update.',
    };
    const orderId = String(payload.orderId || '');
    const shortOrderId = orderId ? orderId.slice(-8).toUpperCase() : 'NA';
    const customerName = escapeHtml(payload.customerName || 'Customer');
    const message = escapeHtml(payload.message || copy.headline);
    const detailLines = Array.isArray(payload.details) ? payload.details : [];
    const trackingId = escapeHtml(String(payload.trackingId || ''));
    const viewOrdersLink = `${flags.appPublicUrl.replace(/\/$/, '')}/orders`;

    const detailHtml = detailLines.length
        ? `<p style="margin:0 0 4px;color:#555;font-size:13px;">${detailLines.map(escapeHtml).join('<br/>')}</p>`
        : '';
    const trackingHtml = trackingId
        ? `<p style="margin:0 0 4px;color:#555;font-size:13px;">Tracking ID: <strong>${trackingId}</strong></p>`
        : '';
    const orderTotal = Number(payload.totalPrice || 0);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;">
            <h2 style="color:#111;margin:0 0 12px;">Hi ${customerName},</h2>
            <p style="color:#222;font-size:15px;margin:0 0 8px;">${message}</p>
            <p style="color:#555;font-size:13px;margin:0 0 4px;">Order <strong>#${escapeHtml(shortOrderId)}</strong>${orderTotal > 0 ? ` &middot; ${toCurrency(orderTotal)}` : ''}</p>
            ${trackingHtml}
            ${detailHtml}
            <p style="margin:20px 0;">
                <a href="${viewOrdersLink}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;display:inline-block;">View your orders</a>
            </p>
            <p style="color:#999;font-size:12px;margin:24px 0 0;">You are receiving this because you opted in to order updates for your Aura account.</p>
        </div>
    `;

    const text = [
        `Hi ${payload.customerName || 'Customer'},`,
        message,
        `Order #${shortOrderId}${orderTotal > 0 ? ` - ${toCurrency(orderTotal)}` : ''}`,
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
