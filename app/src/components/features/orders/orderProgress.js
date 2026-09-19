// Shared order-progress contract. Stage derivation is data-only so the
// orders page, confirmation surfaces, and admin views agree on one rank
// order for shipment statuses.
export const ORDER_FLOW_STAGES = ['placed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];

export const SHIPMENT_STATUS_RANK = {
    pending: 1,
    packed: 2,
    shipped: 3,
    out_for_delivery: 4,
    delivered: 5,
};

export const STAGE_LABEL_FALLBACKS = {
    placed: 'Order Confirmed',
    packed: 'Packed',
    shipped: 'Shipped',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
};

export const getShipmentStage = (orderMeta = {}) => {
    if (orderMeta.orderStatus === 'cancelled' || orderMeta.cancelledAt) return 'cancelled';
    if (orderMeta.isDelivered || orderMeta.orderStatus === 'delivered') return 'delivered';
    const shipments = Array.isArray(orderMeta.shipments) ? orderMeta.shipments : [];
    // 'processing' stays on the confirmed stage until a real packed/shipped
    // checkpoint exists — the legacy admin status alone never claimed packing.
    let rank = orderMeta.orderStatus === 'shipped' ? 3 : 1;
    for (const shipment of shipments) {
        rank = Math.max(rank, SHIPMENT_STATUS_RANK[String(shipment?.status || '')] || 0);
    }
    return ORDER_FLOW_STAGES[Math.min(Math.max(rank, 1), 5) - 1];
};
