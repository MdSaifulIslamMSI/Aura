const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const connectDB = require('../config/db');

dotenv.config();

const products = [
    {
        id: 201,
        title: 'Women Printed Kurta',
        brand: 'Biba',
        category: "Women's Fashion",
        price: 1500,
        discountPercentage: 30,
        rating: 4.4,
        ratingCount: 200,
        image: 'https://via.placeholder.com/150',
        description: 'Cotton printed kurta for daily wear',
        countInStock: 50
    },
    {
        id: 202,
        title: 'Women Slim Fit Jeans',
        brand: 'Levis',
        category: "Women's Fashion",
        price: 2500,
        discountPercentage: 10,
        rating: 4.6,
        ratingCount: 150,
        image: 'https://via.placeholder.com/150',
        description: 'High rise slim fit jeans',
        countInStock: 30
    },
    {
        id: 203,
        title: 'Women Handbag',
        brand: 'Caprese',
        category: "Women's Fashion",
        price: 3000,
        discountPercentage: 40,
        rating: 4.2,
        ratingCount: 80,
        image: 'https://via.placeholder.com/150',
        description: 'Stylish handbag for parties',
        countInStock: 20
    },
    {
        id: 204,
        title: 'Women Heels',
        brand: 'Catwalk',
        category: "Women's Fashion",
        price: 1800,
        discountPercentage: 20,
        rating: 4.0,
        ratingCount: 50,
        image: 'https://via.placeholder.com/150',
        description: 'Party wear heels',
        countInStock: 15
    }
];

const seed = async () => {
    await connectDB();

    // Debug: Check existing
    const existing = await Product.find({ category: { $regex: /Women/i } });
    console.log('Existing Women/Womens items count:', existing.length);
    if (existing.length > 0) console.log('Sample:', existing[0].category, existing[0].title);

    // Check strict
    const count = await Product.countDocuments({ category: "Women's Fashion" });
    if (count < 2) {
        await Product.insertMany(products);
        console.log('Women\'s Fashion Data Seeded! (Added 4 items)');
    } else {
        console.log('Skipping seed, sufficient data exists.');
    }
    process.exit();
};

seed();
