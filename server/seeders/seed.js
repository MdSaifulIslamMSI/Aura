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

const SystemState = require('../models/SystemState');

const importData = async () => {
    try {
        await connectDB();

        // Clear existing data
        await Product.deleteMany();

        const rawProducts = require('./data/products');
        const products = rawProducts.map((p) => {
            const externalId = p.externalId || `legacy_${p.id}`;
            const source = p.source || 'manual';
            const catalogVersion = p.catalogVersion || 'legacy-v1';
            const isPublished = typeof p.isPublished === 'boolean' ? p.isPublished : true;
            
            let image = p.image || '';
            if (image) {
                if (image.includes('?')) {
                    image += `&productId=${p.id}`;
                } else {
                    image += `?productId=${p.id}`;
                }
            }

            const searchText = p.searchText || [
                p.title || '',
                p.brand || '',
                p.category || '',
                p.description || '',
                Array.isArray(p.highlights) ? p.highlights.join(' ') : '',
            ].filter(Boolean).join(' | ');

            return {
                ...p,
                image,
                externalId,
                source,
                catalogVersion,
                isPublished,
                searchText,
            };
        });

        await Product.insertMany(products);
        console.log('Data Imported!');

        // Update SystemState to activate legacy-v1 catalog
        await SystemState.updateOne(
            { key: 'singleton' },
            {
                $setOnInsert: { key: 'singleton', manualProductCounter: 1000000 },
                $set: {
                    activeCatalogVersion: 'legacy-v1',
                    previousCatalogVersion: '',
                    lastSwitchAt: new Date(),
                    catalogLastImportAt: new Date(),
                },
            },
            { upsert: true }
        );
        console.log('SystemState updated to legacy-v1');

        process.exit();
    } catch (error) {
        console.error(`${error}`);
        process.exit(1);
    }
};

importData();

