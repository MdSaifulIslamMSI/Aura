const { buildCatalogArtworkUrl } = require('./catalogArtworkService');
const Product = require('../models/Product');

const CATEGORY_ORDER = [
    'Mobiles',
    'Laptops',
    'Electronics',
    "Men's Fashion",
    "Women's Fashion",
    'Home & Kitchen',
    'Gaming & Accessories',
    'Books',
    'Footwear',
];

const CATEGORY_BLUEPRINTS = {
    Mobiles: {
        brandRoots: ['Aster', 'Nimbus', 'Helio', 'Vertex', 'Quanta', 'Luma', 'Nova', 'Auralink'],
        lines: ['Pulse', 'Orbit', 'Zen', 'Aero', 'Arc', 'Matrix', 'Shift', 'Drive'],
        variants: ['Lite', 'Core', 'Max', 'Pro', 'Ultra'],
        colors: ['Arctic Blue', 'Obsidian Black', 'Solar Gold', 'Mint Fog', 'Crimson Wave', 'Graphite Silver'],
        capacities: ['128GB', '256GB', '512GB'],
        memories: ['8GB RAM', '12GB RAM', '16GB RAM'],
        featureOne: ['5G dual-SIM', '120Hz AMOLED', 'AI low-light camera', 'fast 80W charging'],
        featureTwo: ['stereo audio', 'water resistant shell', 'all-day battery', 'optical stabilization'],
        priceRange: [14999, 89999],
        warranty: '1 year device warranty',
        delivery: '1-3 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('X', globalIndex, seed)} ${pick(this.variants, seed, 2)} Smartphone ${pick(this.capacities, seed, 3)} ${pick(this.colors, seed, 4)}`;
        },
        highlights(seed) {
            return [pick(this.featureOne, seed, 5), pick(this.featureTwo, seed, 6), `${pick(this.memories, seed, 7)} + ${pick(this.capacities, seed, 3)}`];
        },
        specs(seed, globalIndex) {
            return [
                ['Display', `${6.1 + ((seed % 7) * 0.1)}" AMOLED 120Hz`],
                ['Processor', `AURA Mobile ${modelCode('M', globalIndex, seed)}`],
                ['Memory', pick(this.memories, seed, 7)],
                ['Storage', pick(this.capacities, seed, 3)],
                ['Battery', `${4500 + ((seed % 8) * 180)} mAh`],
                ['Camera', `${50 + ((seed % 4) * 14)} MP primary`],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a first-party ${brand} smartphone tuned for everyday speed, strong battery life, and balanced mobile photography.`;
        },
    },
    Laptops: {
        brandRoots: ['Valence', 'Northgrid', 'Auralite', 'Nimbus', 'Forge', 'Atlas', 'Helio'],
        lines: ['Studio', 'Creator', 'Vertex', 'Craft', 'Command', 'Slate', 'Pulse'],
        variants: ['Air', 'Core', 'Pro', 'Max'],
        colors: ['Midnight Slate', 'Frost Silver', 'Ocean Blue', 'Copper Sand'],
        displays: ['13.6"', '14"', '15.3"', '16"'],
        chips: ['Ryzen 7', 'Ryzen 9', 'Core i7', 'Core Ultra 7'],
        memory: ['16GB RAM', '24GB RAM', '32GB RAM'],
        storage: ['512GB SSD', '1TB SSD', '2TB SSD'],
        priceRange: [44999, 189999],
        warranty: '1 year premium laptop warranty',
        delivery: '2-4 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('L', globalIndex, seed)} ${pick(this.variants, seed, 2)} ${pick(this.displays, seed, 3)} Laptop ${pick(this.colors, seed, 4)}`;
        },
        highlights(seed) {
            return [`${pick(this.chips, seed, 5)} performance`, pick(this.memory, seed, 6), `${pick(this.storage, seed, 7)} with Wi-Fi 7`];
        },
        specs(seed) {
            return [
                ['Display', `${pick(this.displays, seed, 3)} IPS creator display`],
                ['Processor', pick(this.chips, seed, 5)],
                ['Memory', pick(this.memory, seed, 6)],
                ['Storage', pick(this.storage, seed, 7)],
                ['Graphics', seed % 2 === 0 ? 'Integrated AI graphics' : 'RTX-class creator graphics'],
                ['Weight', `${(1.18 + (seed % 8) * 0.09).toFixed(2)} kg`],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a ${brand} notebook designed for multitasking, creator workloads, and high-efficiency mobile computing.`;
        },
    },
    Electronics: {
        brandRoots: ['Helio', 'Auralink', 'Vertex', 'Luma', 'Northgrid', 'Nova'],
        lines: ['Vision', 'Sound', 'Beam', 'Core', 'Fusion', 'Element'],
        productTypes: ['4K Smart TV', 'Soundbar', 'Wireless Earbuds', 'Bluetooth Speaker', 'Smart Monitor'],
        colors: ['Graphite', 'Pearl White', 'Deep Navy', 'Steel Black'],
        priceRange: [3999, 129999],
        warranty: '1 year electronics warranty',
        delivery: '2-5 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('E', globalIndex, seed)} ${pick(this.productTypes, seed, 2)} ${pick(this.colors, seed, 3)}`;
        },
        highlights(seed) {
            return ['Smart connected controls', 'Balanced acoustic tuning', 'Energy efficient build'];
        },
        specs(seed, globalIndex) {
            return [
                ['Model', modelCode('E', globalIndex, seed)],
                ['Connectivity', seed % 2 === 0 ? 'Bluetooth 5.3 / Wi-Fi' : 'HDMI / USB-C / Wi-Fi'],
                ['Audio', `${20 + ((seed % 5) * 10)}W tuned output`],
                ['Warranty', '1 year'],
            ];
        },
        description(seed, title, brand) {
            return `${title} is part of the ${brand} connected electronics range built for dependable home entertainment and modern device connectivity.`;
        },
    },
    "Men's Fashion": {
        brandRoots: ['Northline', 'Aster', 'Mercer', 'Cinder', 'Frame', 'Harbor'],
        lines: ['Tailored', 'Urban', 'Weekend', 'Motion', 'Classic', 'Field'],
        productTypes: ['Oxford Shirt', 'Cargo Jacket', 'Tapered Chinos', 'Polo Tee', 'Bomber Layer'],
        colors: ['Indigo', 'Stone Grey', 'Olive', 'Charcoal', 'Sand'],
        fits: ['Slim Fit', 'Regular Fit', 'Relaxed Fit'],
        priceRange: [1499, 11999],
        warranty: '7 day size exchange',
        delivery: '2-4 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('MF', globalIndex, seed, 6)} ${pick(this.productTypes, seed, 2)} ${pick(this.colors, seed, 3)}`;
        },
        highlights(seed) {
            return [pick(this.fits, seed, 4), 'Premium stitched finish', 'Everyday wearable comfort'];
        },
        specs(seed) {
            return [
                ['Fabric', seed % 2 === 0 ? 'Cotton blend' : 'Performance twill'],
                ['Fit', pick(this.fits, seed, 4)],
                ['Closure', seed % 2 === 0 ? 'Button front' : 'Zip front'],
                ['Care', 'Machine wash cold'],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a ${brand} menswear essential created for clean structure, reliable comfort, and repeat daily use.`;
        },
    },
    "Women's Fashion": {
        brandRoots: ['Solene', 'Mira', 'Velora', 'Luma', 'Seren', 'Aurelle'],
        lines: ['Studio', 'Flow', 'Canvas', 'Muse', 'Drape', 'Edit'],
        productTypes: ['Midi Dress', 'Pleated Kurta', 'Structured Blazer', 'Co-ord Set', 'Everyday Top'],
        colors: ['Rose Clay', 'Midnight Plum', 'Sage Bloom', 'Ivory Sand', 'Mocha Satin'],
        fits: ['Tailored Fit', 'Soft Drape', 'Relaxed Fit'],
        priceRange: [1699, 14999],
        warranty: '7 day size exchange',
        delivery: '2-4 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('WF', globalIndex, seed, 6)} ${pick(this.productTypes, seed, 2)} ${pick(this.colors, seed, 3)}`;
        },
        highlights(seed) {
            return [pick(this.fits, seed, 4), 'Lined finish and refined seams', 'Comfortable all-day wear'];
        },
        specs(seed) {
            return [
                ['Fabric', seed % 2 === 0 ? 'Viscose blend' : 'Soft woven rayon'],
                ['Fit', pick(this.fits, seed, 4)],
                ['Sleeve', seed % 2 === 0 ? 'Full sleeve' : 'Half sleeve'],
                ['Care', 'Gentle machine wash'],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a ${brand} womenswear staple balancing soft structure, refined drape, and reliable repeat styling.`;
        },
    },
    'Home & Kitchen': {
        brandRoots: ['Hearthline', 'Auralink', 'Northgrid', 'Pulse', 'Brewster', 'Cove'],
        lines: ['Pulse', 'Brew', 'Home', 'Steam', 'Fresh', 'Core'],
        productTypes: ['Mixer Grinder', 'Coffee Maker', 'Air Fryer', 'Water Purifier', 'Cookware Set'],
        colors: ['Steel Black', 'Warm Beige', 'Pearl White', 'Graphite'],
        priceRange: [2499, 34999],
        warranty: '1 year appliance warranty',
        delivery: '2-5 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('HK', globalIndex, seed, 6)} ${pick(this.productTypes, seed, 2)} ${pick(this.colors, seed, 3)}`;
        },
        highlights(seed) {
            return ['Built for daily home use', 'Low-noise operation', 'Easy-clean material finish'];
        },
        specs(seed) {
            return [
                ['Capacity', `${1 + (seed % 4) * 0.5} L`],
                ['Power', `${650 + ((seed % 6) * 130)} W`],
                ['Material', seed % 2 === 0 ? 'Food-grade steel' : 'Heat-safe polymer'],
                ['Warranty', '1 year'],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a ${brand} home appliance designed for practical daily cooking, brewing, or preparation work.`;
        },
    },
    'Gaming & Accessories': {
        brandRoots: ['Vector', 'Pulse', 'Arcade', 'Nimbus', 'Replay', 'Aster'],
        lines: ['Arc', 'Flux', 'Forge', 'Nova', 'Shift', 'Sprint'],
        productTypes: ['Wireless Pro Controller', 'Mechanical Keyboard', 'Gaming Mouse', 'RGB Headset', 'Dock Station'],
        colors: ['Cosmic Teal', 'Phantom Black', 'Neon Violet', 'Storm White'],
        priceRange: [1999, 24999],
        warranty: '1 year accessory warranty',
        delivery: '1-3 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('GA', globalIndex, seed, 6)} ${pick(this.productTypes, seed, 2)} ${pick(this.colors, seed, 3)}`;
        },
        highlights(seed) {
            return ['Low latency wireless response', 'Long-session ergonomic tuning', 'Cross-platform compatibility'];
        },
        specs(seed) {
            return [
                ['Connectivity', seed % 2 === 0 ? '2.4GHz / Bluetooth' : 'USB-C wired / Bluetooth'],
                ['Latency', `${1 + (seed % 4)} ms response path`],
                ['Battery', `${20 + ((seed % 6) * 6)} hours`],
                ['Compatibility', 'PC / console / mobile'],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a ${brand} gaming accessory tuned for stable response, ergonomic control, and long-session comfort.`;
        },
    },
    Books: {
        brandRoots: ['Quiet Signal', 'Builder Notes', 'North Ledger', 'Deep Craft', 'Orbit Pages', 'Founders Shelf'],
        lines: ['Playbook', 'Atlas', 'Field Guide', 'Manual', 'Principles', 'Blueprint'],
        productTypes: ['Hardcover', 'Paperback', 'Collector Edition'],
        authors: ['Arin Vale', 'Mira Sen', 'Jon Mercer', 'Lena North', 'Rohan Dutt', 'Sara Voss'],
        themes: ['strategy for builders', 'systems thinking', 'design and growth', 'resilient operations', 'modern product craft'],
        priceRange: [399, 2999],
        warranty: '7 day return window',
        delivery: '2-5 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${modelCode('BK', globalIndex, seed, 6)}: ${pick(this.lines, seed, 1)} for ${capitalizeWords(pick(this.themes, seed, 2))} ${pick(this.productTypes, seed, 3)}`;
        },
        highlights(seed) {
            return [`By ${pick(this.authors, seed, 4)}`, 'Print edition with durable binding', 'Curated for repeat reference'];
        },
        specs(seed) {
            return [
                ['Format', pick(this.productTypes, seed, 3)],
                ['Author', pick(this.authors, seed, 4)],
                ['Pages', `${220 + ((seed % 9) * 28)}`],
                ['Language', 'English'],
            ];
        },
        description(seed, title) {
            return `${title} is part of the Aura reading shelf: a focused print book for learning, reflection, and long-term retention.`;
        },
    },
    Footwear: {
        brandRoots: ['Stridewell', 'Atlas', 'Northgrid', 'Aster', 'Motion Lab', 'Trailcore'],
        lines: ['Atlas', 'Sprint', 'Forge', 'Drift', 'Terrain', 'Pulse'],
        productTypes: ['Running Shoes', 'Trail Sneakers', 'Court Trainers', 'Daily Walkers'],
        colors: ['Sandstone Orange', 'Carbon Grey', 'Aqua Mint', 'Navy Citrus', 'Stone Beige'],
        priceRange: [1799, 12999],
        warranty: '30 day comfort guarantee',
        delivery: '2-4 days',
        buildTitle(seed, globalIndex) {
            return `${pick(this.brandRoots, seed)} ${pick(this.lines, seed, 1)} ${modelCode('FW', globalIndex, seed, 6)} ${pick(this.productTypes, seed, 2)} ${pick(this.colors, seed, 3)}`;
        },
        highlights(seed) {
            return ['Engineered grip outsole', 'Cushioned heel support', 'Breathable upper material'];
        },
        specs(seed) {
            return [
                ['Upper', seed % 2 === 0 ? 'Breathable mesh' : 'Hybrid knit upper'],
                ['Sole', 'Responsive EVA outsole'],
                ['Weight', `${280 + ((seed % 7) * 18)} g`],
                ['Use Case', pick(this.productTypes, seed, 2)],
            ];
        },
        description(seed, title, brand) {
            return `${title} is a ${brand} footwear model made for stable movement, long wear cycles, and dependable comfort.`;
        },
    },
};

const pick = (list, seed, offset = 0) => list[(seed + offset) % list.length];
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const slugify = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const capitalizeWords = (value) => String(value || '').replace(/\b\w/g, (match) => match.toUpperCase());
const modelCode = (prefix, globalIndex, seed, width = 5) => {
    const serial = ((globalIndex + 1) * 17) + ((seed % 89) * 13);
    return `${prefix}${String(serial).padStart(width, '0')}`;
};
const buildPrice = ([min, max], seed) => {
    const span = max - min;
    return Math.round((min + ((seed * 7919) % (span + 1))) / 10) * 10;
};

const getCategoryBlueprint = (category) => CATEGORY_BLUEPRINTS[category] || CATEGORY_BLUEPRINTS.Electronics;

const buildProductDocument = ({ globalIndex, categoryIndex, catalogVersion = 'aura-firstparty-v1', source = 'provider' }) => {
    const category = CATEGORY_ORDER[globalIndex % CATEGORY_ORDER.length];
    const blueprint = getCategoryBlueprint(category);
    const seed = (categoryIndex * 131) + globalIndex;
    const brand = pick(blueprint.brandRoots, seed);
    const title = blueprint.buildTitle(seed, globalIndex);
    const externalId = `aura-fp-${slugify(category)}-${String(categoryIndex + 1).padStart(5, '0')}`;
    const price = buildPrice(blueprint.priceRange, seed);
    const originalPrice = Math.round(price * (1 + (0.08 + ((seed % 12) / 100))) / 10) * 10;
    const discountPercentage = clamp(Number((((originalPrice - price) / originalPrice) * 100).toFixed(1)), 5, 28);
    const rating = Number((3.6 + ((seed % 15) * 0.1)).toFixed(1));
    const ratingCount = 40 + ((seed * 17) % 4800);
    const highlights = blueprint.highlights(seed).slice(0, 3);
    const specifications = blueprint.specs(seed, globalIndex).map(([key, value]) => ({ key, value }));
    const image = buildCatalogArtworkUrl({ externalId, title, brand, category });

    return {
        id: 300000000 + globalIndex,
        externalId,
        source,
        catalogVersion,
        isPublished: true,
        title,
        titleKey: Product.normalizeTitleKey(title),
        brand,
        category,
        subCategory: blueprint.productTypes ? pick(blueprint.productTypes, seed, 9) : '',
        price,
        originalPrice,
        discountPercentage,
        rating,
        ratingCount,
        image,
        imageKey: Product.normalizeImageKey(image),
        description: blueprint.description(seed, title, brand),
        highlights,
        specifications,
        stock: 18 + ((seed * 19) % 240),
        deliveryTime: blueprint.delivery,
        warranty: blueprint.warranty,
        searchText: [title, brand, category, ...highlights, ...specifications.map((entry) => `${entry.key} ${entry.value}`)].join(' | '),
        ingestHash: '',
        updatedFromSyncAt: null,
    };
};

module.exports = {
    CATEGORY_ORDER,
    buildProductDocument,
};
