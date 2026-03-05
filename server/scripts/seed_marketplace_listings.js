require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const Listing = require('../models/Listing');
const { MARKETPLACE_SEED_MARKER } = require('../services/marketplaceIntegrityService');

const TARGET_LISTINGS = Number(process.env.MARKETPLACE_SEED_COUNT || 240);
const MIN_SELLERS = Number(process.env.MARKETPLACE_SEED_SELLERS || 12);

const CITY_POOL = [
    { city: 'Bangalore', state: 'Karnataka', pincode: '560001' },
    { city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
    { city: 'Delhi', state: 'Delhi', pincode: '110001' },
    { city: 'Hyderabad', state: 'Telangana', pincode: '500001' },
    { city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
    { city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    { city: 'Kolkata', state: 'West Bengal', pincode: '700001' },
    { city: 'Ahmedabad', state: 'Gujarat', pincode: '380001' },
];

const DEMO_SELLER_NAMES = [
    'Aarav Traders',
    'Mira Store',
    'Neon Deals',
    'Riya Resale Hub',
    'City Gadget Point',
    'Urban Value Mart',
    'Smart Choice Seller',
    'Rapid Mart',
    'Prime Bazaar Seller',
    'Nova Preowned Hub',
    'Verified Market Seller',
    'Trusted Local Deals',
    'QuickFlip Store',
    'Aura Exchange Seller',
];

const CONDITIONS = ['new', 'like-new', 'good', 'fair'];

const normalizeCategory = (value) => String(value || '').trim().toLowerCase();

const mapProductCategoryToListing = (category) => {
    const key = normalizeCategory(category);
    if (key === 'mobiles' || key === 'mobile') return 'mobiles';
    if (key === 'laptops' || key === 'laptop') return 'laptops';
    if (key === 'electronics') return 'electronics';
    if (key === 'books' || key === 'book') return 'books';
    if (key === 'footwear') return 'fashion';
    if (key.includes('fashion')) return 'fashion';
    if (key.includes('home') || key.includes('kitchen')) return 'home-appliances';
    if (key.includes('gaming')) return 'gaming';
    return 'other';
};

const buildPhoneSeed = (seedNumber) => String(seedNumber).padStart(10, '9').slice(0, 10);

const ensureDemoSellers = async ({ requiredCount }) => {
    const sellers = await User.find({}).select('_id name email phone').lean();
    if (sellers.length >= requiredCount) {
        return sellers;
    }

    const existingEmails = new Set(sellers.map((user) => String(user.email || '').toLowerCase()));
    const existingPhones = new Set(sellers.map((user) => String(user.phone || '')));
    const toCreate = [];

    let counter = 0;
    while (sellers.length + toCreate.length < requiredCount) {
        const baseName = DEMO_SELLER_NAMES[counter % DEMO_SELLER_NAMES.length];
        const suffix = `${Date.now()}${counter}`.slice(-6);
        const email = `market.seller.${suffix}@aura.local`;
        const phone = buildPhoneSeed(9000000000 + counter + sellers.length);

        counter += 1;
        if (existingEmails.has(email.toLowerCase()) || existingPhones.has(phone)) {
            continue;
        }

        existingEmails.add(email.toLowerCase());
        existingPhones.add(phone);

        toCreate.push({
            name: `${baseName} ${counter}`,
            email,
            phone,
            isVerified: true,
            isAdmin: false,
            avatar: '',
            bio: 'Marketplace seller account',
        });
    }

    if (toCreate.length > 0) {
        await User.insertMany(toCreate, { ordered: true });
    }

    return User.find({}).select('_id name email phone').lean();
};

const run = async () => {
    if (process.env.ALLOW_MARKETPLACE_DEMO_SEED !== 'true') {
        throw new Error('Seeding marketplace demo data is disabled. Set ALLOW_MARKETPLACE_DEMO_SEED=true only for controlled local testing.');
    }

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const sellers = await ensureDemoSellers({ requiredCount: MIN_SELLERS });
    if (!Array.isArray(sellers) || sellers.length === 0) {
        throw new Error('No users available to attach listings');
    }

    const products = await Product.find({ isPublished: true })
        .sort({ id: 1 })
        .limit(Math.max(TARGET_LISTINGS * 2, 1000))
        .select('id title brand category image price description')
        .lean();

    if (!Array.isArray(products) || products.length === 0) {
        throw new Error('No products available for listing seed');
    }

    const deleted = await Listing.deleteMany({
        description: { $regex: MARKETPLACE_SEED_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') },
    });
    if (deleted.deletedCount > 0) {
        console.log(`[market-seed] cleared previous seeded listings=${deleted.deletedCount}`);
    }

    const docs = [];
    for (let i = 0; i < TARGET_LISTINGS; i += 1) {
        const product = products[i % products.length];
        const seller = sellers[i % sellers.length];
        const location = CITY_POOL[i % CITY_POOL.length];
        const condition = CONDITIONS[i % CONDITIONS.length];

        const basePrice = Number(product.price) || 0;
        const markdown = 0.58 + ((i % 25) / 100); // 58% - 82%
        const listingPrice = Math.max(49, Math.round(basePrice * markdown));

        const title = `${product.title}`;
        const description = [
            `${product.description || `${product.brand || 'Product'} item in good condition.`}`,
            `Condition: ${condition}.`,
            `Brand: ${product.brand || 'Unknown'}.`,
            `${MARKETPLACE_SEED_MARKER} productId=${product.id} seller=${seller._id}`,
        ].join(' ');

        docs.push({
            seller: seller._id,
            title,
            description,
            price: listingPrice,
            negotiable: i % 3 !== 0,
            condition,
            category: mapProductCategoryToListing(product.category),
            images: [product.image],
            location,
            status: 'active',
            source: 'seed',
            views: (i * 17) % 900,
            createdAt: new Date(Date.now() - ((i % 28) * 24 * 60 * 60 * 1000)),
            updatedAt: new Date(),
        });
    }

    await Listing.insertMany(docs, { ordered: true });

    const [total, active] = await Promise.all([
        Listing.countDocuments({}),
        Listing.countDocuments({ status: 'active' }),
    ]);

    console.log('[market-seed] done', JSON.stringify({
        inserted: docs.length,
        total,
        active,
        sellersUsed: sellers.length,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error('[market-seed] failed', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
