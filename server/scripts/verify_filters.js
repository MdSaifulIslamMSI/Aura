const http = require('http');

const fetch = (url) => {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
};

const verify = async () => {
    try {
        console.log('--- Verifying Filters ---');

        // 1. Discount >= 20%
        console.log('\nTesting Discount >= 20%...');
        const discountRes = await fetch('http://localhost:5000/api/products?discount=20');
        const discountProducts = discountRes.products;
        console.log(`Found ${discountProducts.length} products.`);
        discountProducts.forEach(p => console.log(`- ${p.title} (${p.discountPercentage}%)`));
        if (discountProducts.length !== 2) console.error('FAIL: Expected 2 products (Headphones, Nike)');

        // 2. Rating >= 4.0
        console.log('\nTesting Rating >= 4.0...');
        const ratingRes = await fetch('http://localhost:5000/api/products?rating=4');
        const ratingProducts = ratingRes.products;
        console.log(`Found ${ratingProducts.length} products.`);
        ratingProducts.forEach(p => console.log(`- ${p.title} (${p.rating}*)`));
        if (ratingProducts.length !== 3) console.error('FAIL: Expected 3 products (iPhone, Galaxy, Nike)');

        // 3. Brand = Apple
        console.log('\nTesting Brand = Apple...');
        const brandRes = await fetch('http://localhost:5000/api/products?brand=Apple');
        const brandProducts = brandRes.products;
        console.log(`Found ${brandProducts.length} products.`);
        brandProducts.forEach(p => console.log(`- ${p.title} (${p.brand})`));
        if (brandProducts.length !== 1) console.error('FAIL: Expected 1 product (iPhone)');

        // 4. Price Range (500 - 1000)
        console.log('\nTesting Price Range 500 - 1000...');
        const priceRes = await fetch('http://localhost:5000/api/products?minPrice=500&maxPrice=1000');
        const priceProducts = priceRes.products;
        console.log(`Found ${priceProducts.length} products.`);
        priceProducts.forEach(p => console.log(`- ${p.title} ($${p.price})`));
        // We expect iPhone 14 ($999) and Galaxy S23 ($899) from our seed, plus maybe others from original DB.

        console.log('\n--- Verification Complete ---');
    } catch (e) {
        console.error('Verification Failed:', e.message);
    }
};

verify();
