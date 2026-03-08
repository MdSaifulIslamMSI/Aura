const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CATEGORY_ORDER, buildProductDocument } = require('./firstPartyCatalogGenerator');

const DEFAULT_TOTAL = Math.max(1, Number(process.env.DEMO_CATALOG_TOTAL || 100000));
const DEFAULT_OUTPUT_DIR = process.env.DEMO_CATALOG_OUTPUT_DIR
    ? path.resolve(process.cwd(), process.env.DEMO_CATALOG_OUTPUT_DIR)
    : path.resolve(__dirname, '..', 'generated', 'catalog');
const DEFAULT_FILE_STEM = process.env.DEMO_CATALOG_FILE_STEM || `demo_catalog_${DEFAULT_TOTAL}`;
const DEFAULT_FEED_VERSION = process.env.DEMO_CATALOG_FEED_VERSION || `demo-${DEFAULT_TOTAL}-v1`;
const DEFAULT_PROVIDER_NAME = 'Aura Demo Catalog';
const DEFAULT_SCHEMA_VERSION = '2026-03-demo-v1';

const hashFile = async (filePath) => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
});

const writeLine = async (stream, value) => new Promise((resolve, reject) => {
    const payload = `${value}\n`;
    const onError = (error) => {
        stream.off('drain', onDrain);
        reject(error);
    };
    const onDrain = () => {
        stream.off('error', onError);
        resolve();
    };

    stream.once('error', onError);
    if (stream.write(payload, 'utf8')) {
        stream.off('error', onError);
        resolve();
        return;
    }

    stream.once('drain', onDrain);
});

const closeStream = async (stream) => new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    stream.once('error', onError);
    stream.end(() => {
        stream.off('error', onError);
        resolve();
    });
});

const uniqueValues = (values = []) => [...new Set(values.filter(Boolean))];

const buildMaterialNarrative = (category, seed) => {
    const narratives = {
        Mobiles: [
            'The chassis balances grip comfort with pocket-friendly dimensions.',
            'Its camera tuning emphasizes balanced daylight color and stable low-light output.',
            'Thermal control is tuned for long messaging, streaming, and navigation sessions.',
        ],
        Laptops: [
            'The keyboard deck is tuned for long typing sessions with low flex under load.',
            'Cooling headroom is shaped around sustained creator workloads and video calls.',
            'The port layout favors a clean desk setup without sacrificing daily utility.',
        ],
        Electronics: [
            'The enclosure is tuned for cleaner cable routing and everyday living-room placement.',
            'Its acoustic or display profile aims for consistent, fatigue-free everyday use.',
            'Setup steps are kept straightforward for common home-device ecosystems.',
        ],
        "Men's Fashion": [
            'The cut is designed to hold shape through long days without feeling restrictive.',
            'Fabric choices favor repeat wear, easy layering, and practical maintenance.',
            'Construction details focus on cleaner seams and dependable finishing.',
        ],
        "Women's Fashion": [
            'The silhouette is tuned for drape, ease of movement, and repeat styling.',
            'Fabric handling focuses on comfort against the skin and dependable shape retention.',
            'Finishing details prioritize structure without losing day-long wearability.',
        ],
        'Home & Kitchen': [
            'Surface materials are chosen for simple wipe-down maintenance after daily use.',
            'Controls and handling are kept straightforward for repeat kitchen routines.',
            'Form factor decisions focus on countertop stability and storage practicality.',
        ],
        'Gaming & Accessories': [
            'Control surfaces are tuned for long sessions with predictable tactile feedback.',
            'The build aims to balance durability, portability, and clean cable management.',
            'Latency-sensitive paths are optimized for repeat competitive play sessions.',
        ],
        Books: [
            'The edition is built for repeat reference with dependable print clarity and binding.',
            'Page stock and layout favor longer reading sessions with reduced visual fatigue.',
            'The format is chosen to balance shelf presence and practical portability.',
        ],
        Footwear: [
            'The upper and midsole balance cushioning, breathability, and stable support.',
            'Underfoot tuning aims for predictable traction across daily walking surfaces.',
            'The fit profile favors repeat wear cycles without pressure hotspots.',
        ],
    };

    const options = narratives[category] || narratives.Electronics;
    return options[seed % options.length];
};

const buildCareNarrative = (category, seed) => {
    const narratives = {
        Mobiles: [
            'The package is aimed at users who want a reliable mainstream smartphone without overcomplicating the spec sheet.',
            'The configuration suits buyers who care about balanced battery life, camera quality, and smooth everyday responsiveness.',
        ],
        Laptops: [
            'It fits buyers who need stable performance for work, study, and creator multitasking in one machine.',
            'The configuration is aimed at users who want strong everyday performance without moving into workstation bulk.',
        ],
        Electronics: [
            'It fits households that want practical connected-device value and dependable daily performance.',
            'The feature mix is aimed at shoppers prioritizing smooth setup and consistent media performance.',
        ],
        "Men's Fashion": [
            'It is aimed at buyers who want wardrobe staples that look structured without becoming precious or hard to maintain.',
            'The styling balance works for office, travel, and weekend rotation without requiring special care.',
        ],
        "Women's Fashion": [
            'It is aimed at buyers who want dependable repeat styling pieces rather than one-time occasion wear.',
            'The overall construction favors versatility across work, travel, and daily rotation.',
        ],
        'Home & Kitchen': [
            'It is aimed at kitchens that need repeatable daily utility without fragile maintenance routines.',
            'The configuration suits buyers who value practical function, easy cleanup, and dependable countertop behavior.',
        ],
        'Gaming & Accessories': [
            'It is aimed at players who want stable response, durable controls, and comfortable long-session ergonomics.',
            'The feature mix favors consistent play-session reliability over decorative excess.',
        ],
        Books: [
            'It suits readers who want a durable reference edition they can revisit repeatedly.',
            'The format is aimed at buyers who value long-term shelf utility as much as first-read experience.',
        ],
        Footwear: [
            'It suits buyers who want repeat-use comfort and dependable traction across mixed daily routines.',
            'The setup favors stable fit and supportive wear rather than a short-lived showroom feel.',
        ],
    };

    const options = narratives[category] || narratives.Electronics;
    return options[seed % options.length];
};

const buildSupplementalHighlights = ({ category, brand, stock, deliveryTime }) => uniqueValues([
    `${brand} design language tuned for ${category.toLowerCase()}`,
    `Ready stock window: ${stock} units`,
    `Estimated dispatch and delivery: ${deliveryTime}`,
    'Structured detail set for listing, filtering, and comparison use',
]);

const ensureSpecifications = ({ specifications = [], category, seed }) => {
    const fallbackSpecs = {
        Mobiles: [
            ['Connectivity', seed % 2 === 0 ? '5G / Wi-Fi 6 / Bluetooth 5.3' : '5G / Wi-Fi 6E / Bluetooth 5.3'],
            ['Security', seed % 2 === 0 ? 'In-display fingerprint' : 'Side fingerprint'],
        ],
        Laptops: [
            ['Ports', seed % 2 === 0 ? 'USB-C / HDMI / USB-A' : 'USB4 / HDMI / SD card'],
            ['Battery Life', `${8 + (seed % 7)} hours typical mixed use`],
        ],
        Electronics: [
            ['Installation', 'Quick-start setup guide included'],
            ['Placement', 'Home entertainment and desk-ready footprint'],
        ],
        "Men's Fashion": [
            ['Colorway', seed % 2 === 0 ? 'Neutral everyday palette' : 'Seasonal statement palette'],
            ['Occasion', 'Office, travel, and casual rotation'],
        ],
        "Women's Fashion": [
            ['Colorway', seed % 2 === 0 ? 'Soft neutral palette' : 'Rich seasonal palette'],
            ['Occasion', 'Daily, work, and occasion-ready styling'],
        ],
        'Home & Kitchen': [
            ['Safety', 'Everyday household use'],
            ['Cleaning', 'Easy-wipe finish and routine maintenance'],
        ],
        'Gaming & Accessories': [
            ['Controls', 'Tuned tactile response'],
            ['Setup', 'Plug-and-play onboarding'],
        ],
        Books: [
            ['Binding', seed % 2 === 0 ? 'Thread-bound spine' : 'Reinforced perfect binding'],
            ['Audience', 'General readers and repeat reference use'],
        ],
        Footwear: [
            ['Closure', seed % 2 === 0 ? 'Lace-up support' : 'Slip-on secure fit'],
            ['Surface', 'Road, walkway, and indoor mixed use'],
        ],
    };

    const merged = uniqueValues(
        specifications.map((entry) => `${entry.key}: ${entry.value}`)
            .concat((fallbackSpecs[category] || fallbackSpecs.Electronics).map(([key, value]) => `${key}: ${value}`))
    ).map((entry) => {
        const [key, ...rest] = entry.split(':');
        return {
            key: key.trim(),
            value: rest.join(':').trim(),
        };
    });

    return merged.slice(0, 6);
};

const buildExpandedDescription = ({ baseDescription, category, seed, title, brand, highlights, specifications }) => {
    const specPreview = specifications
        .slice(0, 3)
        .map((entry) => `${entry.key.toLowerCase()} ${entry.value}`)
        .join(', ');
    const highlightPreview = highlights.slice(0, 3).join(', ');

    return [
        baseDescription,
        buildMaterialNarrative(category, seed),
        `${title} pairs ${highlightPreview.toLowerCase()} with a structured spec profile covering ${specPreview}.`,
        buildCareNarrative(category, seed),
        `${brand} positions this configuration as a dependable comparison-ready option inside the ${category.toLowerCase()} assortment.`,
    ].join(' ');
};

const buildDemoRecord = ({ globalIndex, catalogVersion }) => {
    const baseDoc = buildProductDocument({
        globalIndex,
        categoryIndex: Math.floor(globalIndex / CATEGORY_ORDER.length),
        catalogVersion,
        source: 'batch',
    });
    const seed = globalIndex * 17;
    const highlights = uniqueValues([
        ...baseDoc.highlights,
        ...buildSupplementalHighlights({
            category: baseDoc.category,
            brand: baseDoc.brand,
            stock: baseDoc.stock,
            deliveryTime: baseDoc.deliveryTime,
        }),
    ]).slice(0, 5);
    const specifications = ensureSpecifications({
        specifications: baseDoc.specifications,
        category: baseDoc.category,
        seed,
    });
    const description = buildExpandedDescription({
        baseDescription: baseDoc.description,
        category: baseDoc.category,
        seed,
        title: baseDoc.title,
        brand: baseDoc.brand,
        highlights,
        specifications,
    });

    return {
        id: baseDoc.id,
        externalId: `aura-demo-${String(globalIndex + 1).padStart(6, '0')}`,
        title: baseDoc.title,
        brand: baseDoc.brand,
        category: baseDoc.category,
        subCategory: baseDoc.subCategory,
        price: baseDoc.price,
        originalPrice: baseDoc.originalPrice,
        discountPercentage: baseDoc.discountPercentage,
        rating: baseDoc.rating,
        ratingCount: baseDoc.ratingCount,
        image: baseDoc.image,
        description,
        highlights,
        specifications,
        stock: baseDoc.stock,
        deliveryTime: baseDoc.deliveryTime,
        warranty: baseDoc.warranty,
        provider: DEFAULT_PROVIDER_NAME,
    };
};

const generateDemoCatalogSnapshot = async ({
    total = DEFAULT_TOTAL,
    outputDir = DEFAULT_OUTPUT_DIR,
    fileStem = DEFAULT_FILE_STEM,
    feedVersion = DEFAULT_FEED_VERSION,
    providerName = DEFAULT_PROVIDER_NAME,
    schemaVersion = DEFAULT_SCHEMA_VERSION,
} = {}) => {
    const normalizedTotal = Math.max(1, Number(total) || DEFAULT_TOTAL);
    await fs.promises.mkdir(outputDir, { recursive: true });

    const snapshotPath = path.resolve(outputDir, `${fileStem}.jsonl`);
    const manifestPath = path.resolve(outputDir, `${fileStem}.manifest.json`);
    const catalogVersion = `demo_${fileStem}_${Date.now()}`;
    const stream = fs.createWriteStream(snapshotPath, { encoding: 'utf8' });

    try {
        for (let globalIndex = 0; globalIndex < normalizedTotal; globalIndex += 1) {
            const record = buildDemoRecord({ globalIndex, catalogVersion });
            await writeLine(stream, JSON.stringify(record));
        }
    } finally {
        await closeStream(stream);
    }

    const sha256 = await hashFile(snapshotPath);
    const manifest = {
        providerName,
        feedVersion,
        exportTimestamp: new Date().toISOString(),
        schemaVersion,
        recordCount: normalizedTotal,
        sha256,
        sourceRef: snapshotPath,
        sourceType: 'jsonl',
        fieldMapping: {
            title: 'title',
            brand: 'brand',
            category: 'category',
            price: 'price',
            description: 'description',
            image: 'image',
        },
        categoryMapping: Object.fromEntries(CATEGORY_ORDER.map((category) => [category, category])),
        imageHostAllowlist: [],
    };

    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return {
        total: normalizedTotal,
        outputDir,
        fileStem,
        catalogVersion,
        sourceRef: snapshotPath,
        manifestRef: manifestPath,
        manifest,
    };
};

module.exports = {
    DEFAULT_TOTAL,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_FILE_STEM,
    DEFAULT_FEED_VERSION,
    DEFAULT_PROVIDER_NAME,
    DEFAULT_SCHEMA_VERSION,
    buildDemoRecord,
    generateDemoCatalogSnapshot,
};
