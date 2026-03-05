const {
    escapeHtml,
    toCurrency,
    toReadableDateTime,
    compactAddress,
} = require('../templateUtils');
const { flags } = require('../../../config/emailFlags');

const renderOrderItemsHtml = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return '<tr><td style="padding:10px;color:#666">No items</td></tr>';
    }

    return items.map((item) => `
        <tr>
            <td style="padding:8px 0;color:#222;font-size:14px;">
                ${escapeHtml(item.title)} x ${Number(item.quantity || 0)}
            </td>
            <td style="padding:8px 0;color:#111;font-size:14px;text-align:right;">
                ${toCurrency(Number(item.price || 0) * Number(item.quantity || 0))}
            </td>
        </tr>
    `).join('');
};

const renderOrderItemsText = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) return '- No items';
    return items.map((item) => `- ${item.title} x ${item.quantity}: ${toCurrency(Number(item.price || 0) * Number(item.quantity || 0))}`).join('\n');
};

const renderOrderPlacedTemplate = (payload = {}) => {
    const orderId = String(payload.orderId || '');
    const shortOrderId = orderId ? orderId.slice(-8).toUpperCase() : 'NA';
    const customerName = escapeHtml(payload.customerName || 'Customer');
    const createdAt = toReadableDateTime(payload.createdAt);
    const address = escapeHtml(compactAddress(payload.shippingAddress || {}));
    const paymentMethod = escapeHtml(payload.paymentMethod || 'COD');
    const paymentState = escapeHtml(payload.paymentState || 'pending');
    const viewOrdersLink = `${flags.appPublicUrl.replace(/\/$/, '')}/orders`;

    const summaryRows = [
        ['Items', toCurrency(payload.itemsPrice)],
        ['Shipping', toCurrency(payload.shippingPrice)],
        ['Tax', toCurrency(payload.taxPrice)],
        ['Coupon Discount', `-${toCurrency(payload.couponDiscount || 0)}`],
        ['Payment Adjustment', toCurrency(payload.paymentAdjustment || 0)],
    ];

    const summaryHtml = summaryRows.map(([label, value]) => `
        <tr>
            <td style="padding:4px 0;color:#666;font-size:13px;">${escapeHtml(label)}</td>
            <td style="padding:4px 0;color:#222;font-size:13px;text-align:right;">${escapeHtml(value)}</td>
        </tr>
    `).join('');

    const subject = `Aura Order Confirmed #${shortOrderId}`;
    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;color:#111;">
    <div style="max-width:640px;margin:24px auto;background:#ffffff;border:1px solid #e6e8ee;border-radius:12px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0f172a,#111827);padding:20px;color:#fff;">
            <h1 style="margin:0;font-size:20px;">Order Confirmed</h1>
            <p style="margin:8px 0 0;font-size:13px;color:#cbd5e1;">Thank you, ${customerName}. Your order has been placed.</p>
        </div>
        <div style="padding:20px;">
            <p style="margin:0 0 8px;font-size:14px;"><strong>Order ID:</strong> ${escapeHtml(orderId)}</p>
            <p style="margin:0 0 16px;font-size:14px;"><strong>Placed At:</strong> ${escapeHtml(createdAt)}</p>

            <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                <thead>
                    <tr>
                        <th style="text-align:left;font-size:13px;color:#555;border-bottom:1px solid #eee;padding-bottom:8px;">Items</th>
                        <th style="text-align:right;font-size:13px;color:#555;border-bottom:1px solid #eee;padding-bottom:8px;">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${renderOrderItemsHtml(payload.orderItems)}
                </tbody>
            </table>

            <table style="width:100%;border-collapse:collapse;margin:12px 0 20px;">
                ${summaryHtml}
                <tr>
                    <td style="padding-top:8px;border-top:1px solid #eee;font-weight:bold;">Total</td>
                    <td style="padding-top:8px;border-top:1px solid #eee;text-align:right;font-weight:bold;">${toCurrency(payload.totalPrice)}</td>
                </tr>
            </table>

            <p style="margin:0 0 8px;font-size:14px;"><strong>Delivery Address:</strong> ${address}</p>
            <p style="margin:0 0 4px;font-size:14px;"><strong>Payment Method:</strong> ${paymentMethod}</p>
            <p style="margin:0 0 20px;font-size:14px;"><strong>Payment State:</strong> ${paymentState}</p>

            <a href="${escapeHtml(viewOrdersLink)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:bold;">
                View Orders
            </a>
        </div>
    </div>
</body>
</html>`;

    const text = [
        'Order Confirmed',
        `Order ID: ${orderId}`,
        `Placed At: ${createdAt}`,
        '',
        'Items:',
        renderOrderItemsText(payload.orderItems),
        '',
        `Items: ${toCurrency(payload.itemsPrice)}`,
        `Shipping: ${toCurrency(payload.shippingPrice)}`,
        `Tax: ${toCurrency(payload.taxPrice)}`,
        `Coupon Discount: -${toCurrency(payload.couponDiscount || 0)}`,
        `Payment Adjustment: ${toCurrency(payload.paymentAdjustment || 0)}`,
        `Total: ${toCurrency(payload.totalPrice)}`,
        '',
        `Delivery Address: ${compactAddress(payload.shippingAddress || {})}`,
        `Payment Method: ${payload.paymentMethod || 'COD'}`,
        `Payment State: ${payload.paymentState || 'pending'}`,
        '',
        `View Orders: ${viewOrdersLink}`,
    ].join('\n');

    return { subject, html, text };
};

module.exports = {
    renderOrderPlacedTemplate,
};
