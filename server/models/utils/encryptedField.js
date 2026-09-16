const { encrypt, decrypt } = require('../../services/fieldEncryptionService');

// Wire field-level encryption into a Mongoose path: values are encrypted on
// assignment/cast (covers saves and model-based updates) and decrypted through
// the getter on hydrated documents. .lean() reads bypass getters — decrypt
// explicitly with decryptValue() there. For subdocuments, pass the nested
// schema (e.g. schema.path('addresses').schema) and its own path name.
const defineEncryptedField = (schema, path) => {
    const schemaType = schema.path(path);
    if (!schemaType) {
        throw new Error(`defineEncryptedField: unknown schema path "${path}"`);
    }
    schemaType.set((value) => {
        if (value === undefined || value === null || value === '' || typeof value !== 'string') return value;
        return encrypt(value);
    });
    schemaType.get((value) => {
        if (value === undefined || value === null || value === '' || typeof value !== 'string') return value;
        return decrypt(value);
    });
};

const decryptValue = (value) => {
    if (value === undefined || value === null || value === '' || typeof value !== 'string') return value;
    return decrypt(value);
};

module.exports = {
    defineEncryptedField,
    decryptValue,
};
