'use strict';

/**
 * Canonical null-safe string coercion shared across the server runtime.
 * Replaces the ~39 previously duplicated local copies of this helper.
 *
 * @param {*} value Value to coerce.
 * @param {string} [fallback=''] Returned when value is undefined/null.
 * @returns {string} Trimmed string coercion of value, or fallback.
 */
const safeString = (value, fallback = '') =>
    String(value === undefined || value === null ? fallback : value).trim();

module.exports = { safeString };
