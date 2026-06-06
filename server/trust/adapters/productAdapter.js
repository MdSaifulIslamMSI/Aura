const mongoose = require('mongoose');
const Product = require('../../models/Product');

const productIdFromRequest = (req = {}) => {
    const candidates = [
        req.params?.productId,
        req.params?.id,
        req.query?.productId,
        req.body?.productId,
    ];
    return candidates
        .map((value) => String(value || '').trim())
        .find((value) => mongoose.isValidObjectId(value)) || '';
};

const loadProductResource = async (req = {}) => {
    const productId = productIdFromRequest(req);
    if (!productId) return null;
    const product = await Product
        .findById(productId)
        .select('_id user owner seller vendor vendorId isActive status source')
        .lean();
    if (!product) return null;

    const ownerId = product.user || product.owner || product.seller || product.vendor || product.vendorId || '';
    return {
        _id: product._id,
        id: String(product._id),
        type: 'product',
        resourceType: 'product',
        ownerId: String(ownerId || ''),
        state: product.status || (product.isActive === false ? 'inactive' : 'active'),
        source: product.source || '',
    };
};

module.exports = {
    loadProductResource,
};
