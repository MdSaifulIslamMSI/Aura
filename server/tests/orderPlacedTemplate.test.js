const { renderOrderPlacedTemplate } = require('../services/email/templates/orderPlacedTemplate');

describe('Order Placed Email Template', () => {
    test('renders expected sections and escapes unsafe values', () => {
        const payload = {
            orderId: '65f0abc1234def567890abcd',
            customerName: 'Alice <script>alert(1)</script>',
            createdAt: '2026-03-01T10:00:00.000Z',
            shippingAddress: {
                address: 'Street <b>1</b>',
                city: 'Pune',
                postalCode: '411001',
                country: 'India',
            },
            paymentMethod: 'UPI',
            paymentState: 'authorized',
            orderItems: [{ title: 'Phone <img src=x>', quantity: 2, price: 1999 }],
            itemsPrice: 3998,
            shippingPrice: 99,
            taxPrice: 200,
            couponDiscount: 100,
            paymentAdjustment: 0,
            totalPrice: 4197,
        };

        const rendered = renderOrderPlacedTemplate(payload);

        expect(rendered.subject).toContain('Order Confirmed');
        expect(rendered.html).toContain('Order ID');
        expect(rendered.html).toContain('View Orders');
        expect(rendered.text).toContain('Order ID:');
        expect(rendered.html).not.toContain('<script>');
        expect(rendered.html).not.toContain('<img src=x>');
        expect(rendered.html).toContain('&lt;script&gt;');
        expect(rendered.html).toContain('&lt;img src=x&gt;');
    });
});
