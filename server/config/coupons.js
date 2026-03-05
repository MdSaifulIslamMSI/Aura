const COUPON_RULES = {
    AURA10: {
        code: 'AURA10',
        type: 'percentage',
        value: 10,
        minCartValue: 1000,
        maxDiscount: 600,
        description: '10% off on orders above Rs 1000 (max Rs 600)',
    },
    FREESHIP: {
        code: 'FREESHIP',
        type: 'free_shipping',
        minCartValue: 500,
        description: 'Free shipping on eligible orders',
    },
    UPI50: {
        code: 'UPI50',
        type: 'flat',
        value: 50,
        minCartValue: 500,
        paymentMethod: 'UPI',
        description: 'Rs 50 off on UPI payments above Rs 500',
    },
};

module.exports = COUPON_RULES;
