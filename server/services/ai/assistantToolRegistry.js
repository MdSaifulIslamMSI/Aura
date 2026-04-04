const { safeString } = require('./assistantContract');

const TOOL_REGISTRY = Object.freeze({
    search_products: {
        name: 'search_products',
        timeout_ms: 3500,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: ['query'],
            properties: {
                query: 'string',
                filters: 'object',
            },
        },
        output_schema: {
            required: ['products'],
            properties: {
                products: 'array',
            },
        },
    },
    select_product: {
        name: 'select_product',
        timeout_ms: 2000,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: ['productId'],
            properties: {
                productId: 'string',
            },
        },
        output_schema: {
            required: ['productId'],
            properties: {
                productId: 'string',
            },
        },
    },
    add_to_cart: {
        name: 'add_to_cart',
        timeout_ms: 2500,
        idempotent: false,
        mutation: true,
        requires_confirmation: true,
        input_schema: {
            required: ['productId'],
            properties: {
                productId: 'string',
                quantity: 'number',
            },
        },
        output_schema: {
            required: ['productId'],
            properties: {
                productId: 'string',
            },
        },
    },
    remove_from_cart: {
        name: 'remove_from_cart',
        timeout_ms: 2500,
        idempotent: false,
        mutation: true,
        requires_confirmation: true,
        input_schema: {
            required: ['productId'],
            properties: {
                productId: 'string',
            },
        },
        output_schema: {
            required: ['productId'],
            properties: {
                productId: 'string',
            },
        },
    },
    go_to_checkout: {
        name: 'go_to_checkout',
        timeout_ms: 1800,
        idempotent: true,
        mutation: false,
        requires_confirmation: true,
        input_schema: {
            required: [],
            properties: {},
        },
        output_schema: {
            required: ['page'],
            properties: {
                page: 'string',
            },
        },
    },
    navigate_to: {
        name: 'navigate_to',
        timeout_ms: 1800,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: ['page'],
            properties: {
                page: 'string',
                params: 'object',
                productId: 'string',
                orderId: 'string',
            },
        },
        output_schema: {
            required: ['page'],
            properties: {
                page: 'string',
                path: 'string',
            },
        },
    },
    track_order: {
        name: 'track_order',
        timeout_ms: 2200,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: [],
            properties: {
                orderId: 'string',
            },
        },
        output_schema: {
            required: [],
            properties: {
                orderId: 'string',
            },
        },
    },
    open_support: {
        name: 'open_support',
        timeout_ms: 2200,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: [],
            properties: {
                orderId: 'string',
                prefill: 'object',
            },
        },
        output_schema: {
            required: [],
            properties: {
                orderId: 'string',
            },
        },
    },
});

const validatePrimitive = (value, expectedType) => {
    if (expectedType === 'array') return Array.isArray(value);
    if (expectedType === 'object') return value && typeof value === 'object' && !Array.isArray(value);
    if (expectedType === 'number') return Number.isFinite(Number(value));
    return typeof value === expectedType;
};

const getToolDefinition = (toolName = '') => TOOL_REGISTRY[safeString(toolName)] || null;

const validateToolInput = ({ toolName = '', payload = {} } = {}) => {
    const definition = getToolDefinition(toolName);
    if (!definition) {
        return {
            ok: false,
            reason: 'tool_not_registered',
        };
    }

    const input = payload && typeof payload === 'object' ? payload : {};
    const missing = (definition.input_schema.required || [])
        .filter((field) => {
            const value = input[field];
            return value === undefined || value === null || safeString(value) === '';
        });
    if (missing.length > 0) {
        return {
            ok: false,
            reason: `missing_required_input:${missing.join(',')}`,
            definition,
        };
    }

    const invalid = Object.entries(definition.input_schema.properties || {})
        .find(([field, expectedType]) => {
            const value = input[field];
            if (value === undefined || value === null || value === '') {
                return false;
            }
            return !validatePrimitive(value, expectedType);
        });

    if (invalid) {
        return {
            ok: false,
            reason: `invalid_input_type:${invalid[0]}`,
            definition,
        };
    }

    return {
        ok: true,
        reason: '',
        definition,
    };
};

const validateAssistantAction = (action = {}, { disabledTools = [] } = {}) => {
    const type = safeString(action?.type || '');
    const disabled = new Set((Array.isArray(disabledTools) ? disabledTools : []).map((entry) => safeString(entry)));
    if (!type) {
        return {
            ok: false,
            reason: 'missing_action_type',
        };
    }
    if (disabled.has(type)) {
        return {
            ok: false,
            reason: 'tool_disabled_by_override',
        };
    }
    return validateToolInput({
        toolName: type,
        payload: action,
    });
};

module.exports = {
    TOOL_REGISTRY,
    getToolDefinition,
    validateAssistantAction,
    validateToolInput,
};
