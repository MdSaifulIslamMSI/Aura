const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');
const connectDB = require('../config/db');

dotenv.config();

const products = [
    {
        id: 101,
        title: 'Apple iPhone 14',
        brand: 'Apple',
        category: 'Mobiles',
        price: 999,
        discountPercentage: 0,
        rating: 4.8,
        ratingCount: 100,
        image: 'https://via.placeholder.com/150',
        description: 'Latest Apple iPhone',
        countInStock: 10
    },
    {
        id: 102,
        title: 'Samsung Galaxy S23',
        brand: 'Samsung',
        category: 'Mobiles',
        price: 899,
        discountPercentage: 10,
        rating: 4.5,
        ratingCount: 80,
        image: 'https://via.placeholder.com/150',
        description: 'New Samsung Flagship',
        countInStock: 15
    },
    {
        id: 103,
        title: 'Budget Headphones',
        brand: 'Generic',
        category: 'Electronics',
        price: 20,
        discountPercentage: 50,
        rating: 2.5,
        ratingCount: 10,
        image: 'https://via.placeholder.com/150',
        description: 'Cheap noise makers',
        countInStock: 50
    },
    {
        id: 104,
        title: 'Nike Air Max',
        brand: 'Nike',
        category: 'Footwear',
        price: 120,
        discountPercentage: 20,
        rating: 4.2,
        ratingCount: 50,
        image: 'https://via.placeholder.com/150',
        description: 'Comfortable running shoes',
        countInStock: 20
    }
];

const seed = async () => {
    await connectDB();
    await Product.deleteMany({ id: { $in: [101, 102, 103, 104] } }); // Clean up old test data
    await Product.insertMany(products);
    console.log('Filter Test Data Seeded!');
    process.exit();
};

seed();
