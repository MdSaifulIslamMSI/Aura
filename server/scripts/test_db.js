require('dotenv').config();
const mongoose = require('mongoose');

const connect = async () => {
    try {
        console.log('Attempting to connect to:', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected successfully');
        process.exit(0);
    } catch (err) {
        console.error('Connection failed:', err);
        process.exit(1);
    }
};

connect();
