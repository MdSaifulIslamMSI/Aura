const { safeString } = require('./assistantContract');
const assistantCapabilities = require('../../../shared/assistantCapabilities.json');

const ASSISTANT_NAVIGATION_PATHS = Object.freeze(
    assistantCapabilities.reduce((paths, capability) => ({
        ...paths,
        [safeString(capability?.id)]: safeString(capability?.route),
    }), {}),
);

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
    get_product_details: {
        name: 'get_product_details',
        timeout_ms: 2200,
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
                product: 'object',
            },
        },
    },
    check_inventory: {
        name: 'check_inventory',
        timeout_ms: 1800,
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
                stock: 'number',
            },
        },
    },
    get_price: {
        name: 'get_price',
        timeout_ms: 1800,
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
                price: 'number',
            },
        },
    },
    compare_products: {
        name: 'compare_products',
        timeout_ms: 2500,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: ['productIds'],
            properties: {
                productIds: 'array',
                query: 'string',
            },
        },
        output_schema: {
            required: ['productIds'],
            properties: {
                productIds: 'array',
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
    get_cart_summary: {
        name: 'get_cart_summary',
        timeout_ms: 1200,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: [],
            properties: {},
        },
        output_schema: {
            required: ['itemCount', 'subtotal'],
            properties: {
                itemCount: 'number',
                subtotal: 'number',
                items: 'array',
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
    apply_coupon: {
        name: 'apply_coupon',
        timeout_ms: 2200,
        idempotent: true,
        mutation: false,
        requires_confirmation: false,
        input_schema: {
            required: [],
            properties: {
                couponCode: 'string',
            },
        },
        output_schema: {
            required: [],
            properties: {
                couponCode: 'string',
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
    cancel_order: {
        name: 'cancel_order',
        timeout_ms: 3500,
        idempotent: false,
        mutation: true,
        requires_confirmation: true,
        input_schema: {
            required: [],
            properties: {
                orderId: 'string',
                reason: 'string',
            },
        },
        output_schema: {
            required: [],
            properties: {
                orderId: 'string',
            },
        },
    },
    create_return_request: {
        name: 'create_return_request',
        timeout_ms: 3500,
        idempotent: false,
        mutation: true,
        requires_confirmation: true,
        input_schema: {
            required: [],
            properties: {
                orderId: 'string',
                requestType: 'string',
                reason: 'string',
                amount: 'number',
            },
        },
        output_schema: {
            required: [],
            properties: {
                orderId: 'string',
                requestType: 'string',
            },
        },
    },
    get_payment_status: {
        name: 'get_payment_status',
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
                paymentState: 'string',
            },
        },
    },
    recommend_products: {
        name: 'recommend_products',
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

const isPositiveProductId = (value) => /^\d+$/.test(safeString(value));
const isFullOrderId = (value) => /^[a-f0-9]{24}$/i.test(safeString(value));

const validateSemanticToolInput = ({ toolName = '', payload = {} } = {}) => {
    const input = payload && typeof payload === 'object' ? payload : {};
    const productIdTools = new Set([
        'get_product_details',
        'check_inventory',
        'get_price',
        'select_product',
        'add_to_cart',
        'remove_from_cart',
    ]);
    if (productIdTools.has(toolName) && !isPositiveProductId(input.productId)) {
        return 'invalid_input_value:productId';
    }
    if (toolName === 'add_to_cart' && input.quantity !== undefined) {
        const quantity = Number(input.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
            return 'invalid_input_value:quantity';
        }
    }
    if (toolName === 'compare_products') {
        const productIds = Array.isArray(input.productIds) ? input.productIds : [];
        if (productIds.length < 2 || productIds.length > 4 || productIds.some((productId) => !isPositiveProductId(productId))) {
            return 'invalid_input_value:productIds';
        }
    }
    if (toolName === 'navigate_to') {
        const page = safeString(input.page);
        if (!Object.prototype.hasOwnProperty.call(ASSISTANT_NAVIGATION_PATHS, page)) {
            return 'invalid_input_value:page';
        }
        if (page === 'product' && !isPositiveProductId(input?.params?.productId || input.productId)) {
            return 'invalid_input_value:productId';
        }
        if (page === 'category' && !safeString(input?.params?.category)) {
            return 'invalid_input_value:category';
        }
        if (page === 'listing' && !safeString(input?.params?.listingId)) {
            return 'invalid_input_value:listingId';
        }
        if (page === 'seller_profile' && !safeString(input?.params?.sellerId)) {
            return 'invalid_input_value:sellerId';
        }
    }
    if (['track_order', 'cancel_order', 'create_return_request', 'get_payment_status', 'open_support'].includes(toolName)) {
        if (safeString(input.orderId) && !isFullOrderId(input.orderId)) {
            return 'invalid_input_value:orderId';
        }
    }
    if (toolName === 'create_return_request') {
        const requestType = safeString(input.requestType || 'refund').toLowerCase();
        if (!['refund', 'replacement'].includes(requestType)) {
            return 'invalid_input_value:requestType';
        }
        if (input.amount !== undefined && (!Number.isFinite(Number(input.amount)) || Number(input.amount) < 0)) {
            return 'invalid_input_value:amount';
        }
    }
    if (toolName === 'apply_coupon' && safeString(input.couponCode) && !/^[a-z0-9_-]{3,30}$/i.test(safeString(input.couponCode))) {
        return 'invalid_input_value:couponCode';
    }
    return '';
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

    const semanticError = validateSemanticToolInput({ toolName, payload: input });
    if (semanticError) {
        return {
            ok: false,
            reason: semanticError,
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
    ASSISTANT_NAVIGATION_PATHS,
    TOOL_REGISTRY,
    getToolDefinition,
    validateAssistantAction,
    validateToolInput,
};
