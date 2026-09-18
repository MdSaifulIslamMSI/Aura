const Product = require('../models/Product');

const defaultIndexName = (keys) => Object.entries(keys)
    .map(([key, direction]) => `${key}_${direction}`)
    .join('_');

const indexNames = (model) => model.schema.indexes()
    .map(([keys, options]) => options?.name || defaultIndexName(keys));

// DB-free schema assertion suite (same pattern as accountCenterIndexes.test.js):
// guards the sort-covering compounds that catalog listing performance depends
// on. catalogService.resolveSort() sorts {ratingCount:-1,_id:-1} by default and
// every catalog read filters on the (isPublished, catalogVersion) prefix, so
// losing any of these silently reintroduces in-memory blocking sorts over the
// whole published collection.
describe('product catalog sort-covering indexes', () => {
    test('declares a compound index for every catalog list sort key', () => {
        expect(indexNames(Product)).toEqual(expect.arrayContaining([
            'isPublished_1_catalogVersion_1_ratingCount_-1__id_-1',
            'isPublished_1_catalogVersion_1_rating_-1__id_-1',
            'isPublished_1_catalogVersion_1_discountPercentage_-1__id_-1',
            'isPublished_1_catalogVersion_1_price_-1__id_-1',
            'isPublished_1_catalogVersion_1_createdAt_-1__id_-1',
        ]));
    });

    test('price compound reverse-walks to serve the price-asc sort', () => {
        const names = indexNames(Product);
        // resolveSort('price-asc') = {price:1,_id:1}: a (price:-1,_id:-1)
        // compound serves it by reverse traversal, so only one price index
        // should exist alongside the legacy single-field price index.
        expect(names.filter((name) => name.startsWith('isPublished_1_catalogVersion_1_price'))).toHaveLength(1);
    });
});
