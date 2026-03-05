const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('../models/Product');

dotenv.config();

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

const verifyProduct = async () => {
    await connectDB();

    const id = 56;
    console.log(`Checking for product with id: ${id} (Type: ${typeof id})`);

    const productNumeric = await Product.findOne({ id: 56 });
    console.log('Query { id: 56 } result:', productNumeric ? 'FOUND' : 'NOT FOUND');
    if (productNumeric) console.log('Product Title:', productNumeric.title);

    const productString = await Product.findOne({ id: "56" });
    console.log('Query { id: "56" } result:', productString ? 'FOUND' : 'NOT FOUND');

    console.log('--- Sample Product ---');
    const sample = await Product.findOne();
    console.log('Sample ID:', sample.id, 'Type:', typeof sample.id);

    process.exit();
};

verifyProduct();
