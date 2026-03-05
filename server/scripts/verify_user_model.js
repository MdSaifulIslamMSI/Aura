require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const connectDB = require('../config/db');

const verifyUser = async () => {
    try {
        await connectDB();

        const testEmail = 'test_antigravity@example.com';

        // Cleanup previous test
        await User.deleteOne({ email: testEmail });

        console.log('Creating test user...');
        const user = await User.create({
            name: 'Antigravity Tester',
            email: testEmail,
            cart: [{
                id: 1,
                title: 'Test Product',
                price: 999,
                image: 'http://example.com/image.png',
                stock: 10
            }]
        });

        console.log('User created:', user.email);
        console.log('Cart Items:', user.cart.length);

        if (user.cart[0].title === 'Test Product') {
            console.log('VERIFICATION PASSED: Cart item stored correctly.');
        } else {
            console.error('VERIFICATION FAILED: Cart item mismatch.');
        }

        process.exit();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
};

verifyUser();
