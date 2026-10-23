const SystemState = require('../models/SystemState');
const { flags: catalogFlags } = require('../config/catalogFlags');

// The single definition of "purchasable catalog item". Cart reads, checkout
// pricing and the atomic stock reservation all use it so a product cannot be
// viewed in one catalog state and purchased in another.
const getActiveCatalogProductFilter = async () => {
    const activeProductFilter = { isActive: { $ne: false } };
    if (!catalogFlags.catalogActiveVersionRequired) return activeProductFilter;

    const state = await SystemState.findOne({ key: 'singleton' }).lean();
    if (!state?.activeCatalogVersion) return { isPublished: true, ...activeProductFilter };
    return {
        isPublished: true,
        ...activeProductFilter,
        catalogVersion: state.activeCatalogVersion,
    };
};

module.exports = {
    getActiveCatalogProductFilter,
};
