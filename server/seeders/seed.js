require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const connectDB = require('../config/db');

// Import data from the frontend file (requires some adjustment as it is ES6 export)
// For simplicity, we will copy the data structure or use a workaround to read it.
// Since we can't easily require an ES6 module in CommonJS without Babel, 
// I will create a temporary data file or Paste the data here if it was small.
// However, the best approach is to read the file content and eval/parse it, or just copy it.
// Given I have view_file access, I will actually construct a valid JSON or CommonJS file for data.

// Let's assume for this specific step I will use a simplified approach:
// I'll manually copy the data structure into a variable here since I already read it with `view_file`.
// Wait, the file is large (1990 lines). 
// I will instead create a data.js in this folder that has the array in CommonJS format first.

const importData = async () => {
    try {
        await connectDB();

        // Clear existing data
        await Product.deleteMany();

        // We will load data from a local file 'data.js' which I will create next
        const products = require('./data/products');

        await Product.insertMany(products);

        console.log('Data Imported!');
        process.exit();
    } catch (error) {
        console.error(`${error}`);
        process.exit(1);
    }
};

importData();
