const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepareKaggleCatalogSnapshotFromFile } = require('../services/kaggleCatalogService');

describe('kaggleCatalogService', () => {
    test('builds a strict deduped snapshot from a Kaggle-style CSV export', async () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-kaggle-test-'));
        const csvPath = path.join(tempRoot, 'products.csv');
        const outputRoot = path.join(tempRoot, 'out');

        fs.writeFileSync(csvPath, [
            'title,brand,category,price,description,image,storage,color,stock',
            'Phone Alpha,Nova,Mobiles,19999,"Phone Alpha is a real device with good specs and battery life for strict import testing.",https://cdn.example.com/images/phone-alpha.jpg,128GB,Blue,12',
            'Phone Alpha,Nova,Mobiles,19999,"Duplicate title should be removed by the strict dedupe layer.",https://cdn.example.com/images/phone-alpha-2.jpg,128GB,Black,7',
            'Laptop Prime,Orbit,Laptops,55999,"Laptop Prime has a long enough description, category fit, and image to pass the strict gate.",relative/laptop-prime.jpg,16GB RAM,Silver,4',
            'Broken Entry,,Mobiles,24999,"Missing brand must be rejected by the strict gate.",https://cdn.example.com/images/broken.jpg,256GB,Black,3',
            'Camera Core,PixelWorks,Electronics,32999,"Camera Core has valid fields and a usable image URL for import.",https://cdn.example.com/images/camera-core.jpg,24MP,Black,5',
        ].join('\n'));

        const result = await prepareKaggleCatalogSnapshotFromFile({
            dataset: 'owner/sample-products',
            dataFilePath: csvPath,
            outputRoot,
            imageBaseUrl: 'https://assets.example.com/catalog/',
            strict: true,
            specFields: ['storage', 'color'],
        });

        const snapshotLines = fs.readFileSync(result.snapshotPath, 'utf8')
            .trim()
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => JSON.parse(line));

        expect(result.manifest.recordCount).toBe(3);
        expect(result.stats.writtenRows).toBe(3);
        expect(result.stats.duplicateRows).toBe(1);
        expect(result.stats.skipReasons.missing_brand).toBe(1);
        expect(snapshotLines).toHaveLength(3);
        expect(snapshotLines[0].image).toBe('https://cdn.example.com/images/phone-alpha.jpg');
        expect(snapshotLines[1].image).toBe('https://assets.example.com/catalog/relative/laptop-prime.jpg');
        expect(snapshotLines[1].specifications).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'storage', value: '16GB RAM' }),
            expect.objectContaining({ key: 'color', value: 'Silver' }),
        ]));
        expect(result.manifest.imageHostAllowlist).toEqual([
            'assets.example.com',
            'cdn.example.com',
        ]);
        expect(result.manifest.fieldMapping).toEqual(expect.objectContaining({
            title: 'title',
            brand: 'brand',
            category: 'category',
            price: 'price',
            description: 'description',
            image: 'image',
        }));
    });
});
