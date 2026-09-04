/**
 * Multi-turn task state machine for state-changing assistant work.
 * Gathers slots (product, quantity, order, return type) across turns in
 * server-owned `pendingTask` state. Never executes anything: completed tasks
 * return a normalized action that still flows through the confirmation
 * envelope + HMAC token gate. Pure logic with injected resolvers so the
 * service stays unit-testable without a database.
 */

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const TASK_SLOT_SPEC = Object.freeze({
    add_to_cart: ['productId', 'quantity'],
    cancel_order: ['orderId'],
    create_return_request: ['orderId', 'requestType'],
});

const CANCEL_TASK_PATTERN = /^\s*(never mind|forget it|cancel that|stop that|abort)\b/i;
const REFUND_PATTERN = /\b(refund|money back)\b/i;
const REPLACEMENT_PATTERN = /\b(replace|replacement|exchange|swap)\b/i;

const defaultDeps = {
    parseQuantity: () => 1,
    resolveReference: () => null,
    resolveOrder: async () => null,
};

const isTaskType = (value = '') => Object.prototype.hasOwnProperty.call(TASK_SLOT_SPEC, safeString(value));

const startTask = (taskType, initialSlots = {}) => ({
    taskType: safeString(taskType),
    slots: { ...initialSlots },
    asked: [],
    createdAt: Date.now(),
});

const missingSlots = (task = {}) => (
    (TASK_SLOT_SPEC[task.taskType] || []).filter((slot) => {
        const value = task.slots?.[slot];
        return value === undefined || value === null || safeString(value) === '';
    })
);

const detectRequestType = (message = '') => {
    if (REPLACEMENT_PATTERN.test(safeString(message))) return 'replacement';
    if (REFUND_PATTERN.test(safeString(message))) return 'refund';
    return '';
};

const buildAction = (task = {}) => {
    const slots = task.slots || {};
    if (task.taskType === 'add_to_cart') {
        return {
            type: 'add_to_cart',
            productId: safeString(slots.productId || ''),
            quantity: Math.min(20, Math.max(1, Number(slots.quantity || 1) || 1)),
            requiresConfirmation: true,
        };
    }
    if (task.taskType === 'cancel_order') {
        return {
            type: 'cancel_order',
            orderId: safeString(slots.orderId || ''),
            requiresConfirmation: true,
        };
    }
    if (task.taskType === 'create_return_request') {
        return {
            type: 'create_return_request',
            orderId: safeString(slots.orderId || ''),
            requestType: safeString(slots.requestType || 'refund'),
            requiresConfirmation: true,
        };
    }
    return null;
};

/**
 * @returns {{ taskState, question, options, complete, action, cancelled }}
 */
const advanceTask = async ({
    message = '',
    taskType = '',
    assistantSession = {},
    user = null,
    context = {},
    deps = {},
} = {}) => {
    const resolved = { ...defaultDeps, ...(deps || {}) };
    const normalizedMessage = safeString(message);
    const existing = assistantSession?.pendingTask && isTaskType(assistantSession.pendingTask.taskType)
        ? { slots: {}, asked: [], createdAt: Date.now(), ...assistantSession.pendingTask }
        : null;

    if (existing && CANCEL_TASK_PATTERN.test(normalizedMessage)) {
        return { taskState: null, question: '', options: [], complete: false, action: null, cancelled: true };
    }

    const task = existing || (isTaskType(taskType) ? startTask(taskType) : null);
    if (!task) {
        return { taskState: null, question: '', options: [], complete: false, action: null, cancelled: false };
    }

    // Fill product slot from server-owned memory first, then explicit context.
    if (TASK_SLOT_SPEC[task.taskType]?.includes('productId') && !safeString(task.slots.productId)) {
        const reference = resolved.resolveReference({ message: normalizedMessage, assistantSession, context });
        if (reference && !reference.ambiguous && safeString(reference.productId)) {
            task.slots.productId = safeString(reference.productId);
        } else if (reference?.ambiguous) {
            task.slots.ambiguousReference = true;
        }
    }
    if (TASK_SLOT_SPEC[task.taskType]?.includes('quantity') && !task.slots.quantity) {
        const quantity = Number(resolved.parseQuantity(normalizedMessage) || 1);
        if (Number.isInteger(quantity) && quantity >= 1) {
            task.slots.quantity = Math.min(20, quantity);
        }
    }
    if (TASK_SLOT_SPEC[task.taskType]?.includes('requestType') && !safeString(task.slots.requestType)) {
        const requestType = detectRequestType(normalizedMessage);
        if (requestType) task.slots.requestType = requestType;
    }
    if (TASK_SLOT_SPEC[task.taskType]?.includes('orderId') && !safeString(task.slots.orderId)) {
        const resolution = await resolved.resolveOrder({ message: normalizedMessage, user });
        if (resolution?.blocked) {
            return { taskState: null, question: resolution.blocked, options: [], complete: false, action: null, cancelled: false };
        }
        if (safeString(resolution?.orderId)) task.slots.orderId = safeString(resolution.orderId);
    }

    const missing = missingSlots(task);
    if (missing.length === 0) {
        return { taskState: null, question: '', options: [], complete: true, action: buildAction(task), cancelled: false };
    }

    const nextSlot = missing[0];
    task.asked = [...new Set([...(task.asked || []), nextSlot])];
    return { taskState: task, question: nextSlot, options: [], complete: false, action: null, cancelled: false };
};

module.exports = {
    TASK_SLOT_SPEC,
    advanceTask,
    missingSlots,
};
