require('dotenv').config();
const Product = require('../models/Product');
const connectDB = require('../config/db');

const verifyData = async () => {
    try {
        await connectDB();
        const count = await Product.countDocuments();
        console.log(`Total Products in DB: ${count}`);

        if (count > 0) {
            const sample = await Product.findOne();
            console.log('Sample ID:', sample.id);
            console.log('Sample Title:', sample.title);
        }

        process.exit();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

verifyData();
