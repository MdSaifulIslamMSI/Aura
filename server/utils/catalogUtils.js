/**
 * catalog/utils.js — Pure utility functions for catalog operations.
 *
 * No side effects, no imports from models or services.
 * Safe to use anywhere in the catalog domain.
 */

const crypto = require('crypto');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const safeNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};
const toInt = (value, fallback = 0) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.trunc(num);
};

const makeId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clonePlain = (value) => {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
};

const isSystemStateWriteBlocked = (error) => {
    const message = safeLower(error?.message || '');
    return message.includes('cannot create a new collection')
        || message.includes('over your space quota')
        || message.includes('using 510 collections of 500')
        || message.includes('space quota');
};

const isDuplicateKeyError = (error) => {
    if (!error) return false;
    if (error.code === 11000) return true;
    if (Array.isArray(error.writeErrors) && error.writeErrors.some((entry) => entry?.code === 11000)) return true;
    return String(error.message || '').includes('E11000');
};

const detectDuplicateField = (error) => {
    if (error?.keyPattern?.titleKey) return 'name';
    if (error?.keyPattern?.imageKey) return 'image';

    const rawMessage = safeString(error?.message || '');
    if (rawMessage.includes('titleKey')) return 'name';
    if (rawMessage.includes('imageKey')) return 'image';

    if (Array.isArray(error?.writeErrors)) {
        const joined = error.writeErrors.map((entry) => safeString(entry?.errmsg || '')).join(' ');
        if (joined.includes('titleKey')) return 'name';
        if (joined.includes('imageKey')) return 'image';
    }
    return 'product identity';
};

const mapDuplicateToAppError = (error) => {
    const AppError = require('../AppError');
    const field = detectDuplicateField(error);
    if (field === 'name') return new AppError('Duplicate product name is not allowed. Use a unique product name.', 409);
    if (field === 'image') return new AppError('Duplicate product image is not allowed. Use a unique image URL.', 409);
    return new AppError('Duplicate product identity is not allowed.', 409);
};

module.exports = {
    safeString,
    safeLower,
    safeNumber,
    toInt,
    makeId,
    hashValue,
    escapeRegExp,
    clonePlain,
    isSystemStateWriteBlocked,
    isDuplicateKeyError,
    detectDuplicateField,
    mapDuplicateToAppError,
};
