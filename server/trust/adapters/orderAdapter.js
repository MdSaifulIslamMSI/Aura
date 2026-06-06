const mongoose = require('mongoose');
const Order = require('../../models/Order');

const objectIdFromRequest = (req = {}) => {
    const candidates = [
        req.params?.orderId,
        req.params?.id,
        req.query?.orderId,
        req.body?.orderId,
    ];
    return candidates
        .map((value) => String(value || '').trim())
        .find((value) => mongoose.isValidObjectId(value)) || '';
};

const loadOrderResource = async (req = {}) => {
    const orderId = objectIdFromRequest(req);
    if (!orderId) return null;
    const order = await Order
        .findById(orderId)
        .select('_id user orderStatus paymentState totalPrice refundSummary commandCenter')
        .lean();
    if (!order) return null;

    return {
        _id: order._id,
        id: String(order._id),
        type: 'order',
        resourceType: 'order',
        ownerId: String(order.user || ''),
        userId: String(order.user || ''),
        orderStatus: order.orderStatus || order.paymentState || '',
        state: order.paymentState || order.orderStatus || '',
        totalPrice: order.totalPrice || 0,
        refundSummary: order.refundSummary || {},
    };
};

module.exports = {
    loadOrderResource,
};
