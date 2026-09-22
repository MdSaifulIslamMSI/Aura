const {
    escapeHtml,
    toCurrency,
    toReadableDateTime,
    compactAddress,
} = require('../templateUtils');
const {
    renderShell,
    renderCta,
    renderCallout,
} = require('./designSystem');
const { flags } = require('../../../config/emailFlags');

const renderOrderItemsHtml = (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        return '<tr><td colspan="2" style="padding:12px 16px;color:#94a3b8;font-size:13px;">No items</td></tr>';
    }

    return items.map((item) => `
        <tr>
            <td style="padding:10px 16px;border-bottom:1px solid #eef1f6;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;">
                ${escapeHtml(item.title)} <span style="color:#94a3b8;">&times; ${Number(item.quantity || 0)}</span>
            </td>
            <td style="padding:10px 16px;border-bottom:1px solid #eef1f6;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;text-align:right;white-space:nowrap;">
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

    const paid = paymentState.toLowerCase() === 'paid';
    const summaryRows = [
        ['Items', toCurrency(payload.itemsPrice)],
        ['Shipping', toCurrency(payload.shippingPrice)],
        ['Tax', toCurrency(payload.taxPrice)],
        ['Coupon Discount', `-${toCurrency(payload.couponDiscount || 0)}`],
        ['Payment Adjustment', toCurrency(payload.paymentAdjustment || 0)],
    ];

    const summaryHtml = summaryRows.map(([label, value]) => `
        <tr>
            <td style="padding:5px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#64748b;">${escapeHtml(label)}</td>
            <td style="padding:5px 16px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;text-align:right;">${escapeHtml(value)}</td>
        </tr>
    `).join('');

    const subject = `Aura Order Confirmed #${shortOrderId}`;
    const preheader = `Thanks ${payload.customerName || 'Customer'} — order #${shortOrderId} is confirmed.`;

    const bodyHtml = `
  <p style="margin:0 0 4px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;line-height:1.25;color:#111827;">Order Confirmed</p>
  <p style="margin:0 0 18px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#64748b;">Thank you, ${customerName}. Your order has been placed and is being prepared.</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;border:1px solid #e4e8f1;border-radius:12px;">
    <tr>
      <td style="padding:12px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:2px 0;">Order ID</td>
            <td align="right" style="font-family:'Courier New',Courier,monospace;font-size:13px;font-weight:700;color:#111827;padding:2px 0;">${escapeHtml(orderId)}</td>
          </tr>
          <tr>
            <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:2px 0;">Placed At</td>
            <td align="right" style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;padding:2px 0;">${escapeHtml(createdAt)}</td>
          </tr>
          <tr>
            <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b;padding:2px 0;">Payment</td>
            <td align="right" style="padding:2px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr>
                <td style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;color:#111827;">${paymentMethod}</td>
                <td style="padding-left:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td bgcolor="${paid ? '#ecfdf5' : '#fffbeb'}" style="border:1px solid ${paid ? '#a7f3d0' : '#fde68a'};border-radius:999px;padding:2px 10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${paid ? '#047857' : '#b45309'};">${paymentState}</td>
                  </tr></table>
                </td>
              </tr></table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <p style="margin:20px 0 10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#2563eb;">Items</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid #e4e8f1;border-radius:12px;overflow:hidden;">
    ${renderOrderItemsHtml(payload.orderItems)}
  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;background-color:#f8fafc;border:1px solid #e4e8f1;border-radius:12px;">
    ${summaryHtml}
    <tr>
      <td style="padding:11px 16px;border-top:1px solid #e4e8f1;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#111827;">Total</td>
      <td style="padding:11px 16px;border-top:1px solid #e4e8f1;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#111827;text-align:right;">${toCurrency(payload.totalPrice)}</td>
    </tr>
  </table>

  <p style="margin:20px 0 10px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#2563eb;">Delivery</p>
  ${renderCallout({ tone: 'neutral', text: `<strong>${address}</strong><br/><span style="color:#64748b;">We will email you as the order moves — shipped, out for delivery, and delivered.</span>` })}

  ${renderCta({ url: escapeHtml(viewOrdersLink), label: 'View Orders', accent: 'login' })}`;

    const html = renderShell({
        subject,
        preheader,
        eyebrow: 'Order Confirmation',
        accent: 'login',
        bodyHtml,
        footerNote: 'You are receiving this email because you placed an order with Aura.',
    });

    const text = [
        'Order Confirmed',
        `Order ID: ${orderId}`,
        `Placed At: ${createdAt}`,
        `Payment: ${payload.paymentMethod || 'COD'} (${payload.paymentState || 'pending'})`,
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
        '',
        `View Orders: ${viewOrdersLink}`,
    ].join('\n');

    return { subject, html, text, preheader };
};

module.exports = {
    renderOrderPlacedTemplate,
};
