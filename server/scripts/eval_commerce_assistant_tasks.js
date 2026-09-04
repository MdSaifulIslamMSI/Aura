#!/usr/bin/env node

// Deterministic task-success eval for the commerce assistant. Exercises the
// multi-turn task machine, reference memory, and confirmation-token
// integrity with stubbed resolvers — no database, no network.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const fs = require('fs');
const path = require('path');

const { advanceTask } = require('../services/ai/assistantTaskService');
const { buildConfirmationToken, verifyConfirmationToken } = require('../services/ai/assistantContract');
const { __testables } = require('../services/ai/commerceAssistantService');

const fixturePath = path.join(__dirname, '..', 'evals', 'commerceAssistantTasks.json');
const runLogDir = path.join(__dirname, '..', '..', '.run-logs');

const addCheck = (checks, name, actual, expected, predicate = Object.is) => {
    const pass = predicate(actual, expected);
    checks.push({ name, pass, actual, expected });
};

const evaluateTurnsCase = async (testCase) => {
    const checks = [];
    let session = { ...(testCase.session || {}) };
    let last = null;

    for (const turn of testCase.turns || []) {
        const stubs = { ...(testCase.stubs || {}), ...(turn.stubs || {}) };
        last = await advanceTask({
            message: turn.message,
            taskType: turn.taskType || null,
            assistantSession: turn.carryTask && last?.taskState
                ? { ...session, pendingTask: last.taskState }
                : session,
            user: null,
            context: {},
            deps: {
                parseQuantity: () => Number(stubs.quantity || 1),
                resolveReference: ({ message }) => {
                    const { resolveReferringExpression } = require('../services/ai/assistantMemoryService');
                    return resolveReferringExpression({ message, assistantSession: session });
                },
                resolveOrder: async () => {
                    if (stubs.blocked) return { blocked: stubs.blocked };
                    if (stubs.orderId) return { orderId: stubs.orderId };
                    return null;
                },
            },
        });
        if (last?.taskState) session = { ...session, pendingTask: last.taskState };
    }

    const expect = testCase.expect || {};
    if ('complete' in expect) addCheck(checks, 'complete', Boolean(last?.complete), expect.complete);
    if ('cancelled' in expect) addCheck(checks, 'cancelled', Boolean(last?.cancelled), expect.cancelled);
    if ('question' in expect) addCheck(checks, 'question', last?.question || '', expect.question);
    if ('blocked' in expect) addCheck(checks, 'blocked', Boolean(last?.taskState === null && !last?.complete && !last?.cancelled), expect.blocked);
    if ('actionType' in expect) addCheck(checks, 'actionType', last?.action?.type || '', expect.actionType);
    if ('productId' in expect) addCheck(checks, 'productId', last?.action?.productId || '', expect.productId);
    if ('orderId' in expect) addCheck(checks, 'orderId', last?.action?.orderId || '', expect.orderId);
    return { id: testCase.id, pass: checks.every((check) => check.pass), checks };
};

const evaluateCase = async (testCase) => {
    if (testCase.tokenCheck) {
        const checks = [];
        const token = buildConfirmationToken(testCase.tokenCheck.action);
        addCheck(checks, 'tokenValid', verifyConfirmationToken(testCase.tokenCheck.action, token), true);
        addCheck(checks, 'tamperedRejected', verifyConfirmationToken(testCase.tokenCheck.tamperedAction, token), false);
        return { id: testCase.id, pass: checks.every((check) => check.pass), checks };
    }
    if (testCase.confirmationCheck) {
        const checks = [];
        const inferred = __testables.inferConfirmationFromMessage({
            message: testCase.confirmationCheck.message,
            assistantSession: { pendingAction: { actionId: 'x', contextVersion: 1 } },
        });
        addCheck(checks, 'inferred', inferred !== null && inferred !== undefined, false);
        return { id: testCase.id, pass: checks.every((check) => check.pass), checks };
    }
    return evaluateTurnsCase(testCase);
};

const main = async () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const results = [];
    for (const testCase of fixture.cases || []) {
        results.push(await evaluateCase(testCase));
    }
    const passed = results.filter((entry) => entry.pass).length;
    const failed = results.filter((entry) => !entry.pass);
    failed.forEach((entry) => {
        console.log(`FAIL ${entry.id}: ${entry.checks.filter((check) => !check.pass).map((check) => `${check.name} (got ${JSON.stringify(check.actual)})`).join('; ')}`);
    });
    console.log(`commerce-assistant-tasks: ${passed}/${results.length} passed`);
    fs.mkdirSync(runLogDir, { recursive: true });
    fs.writeFileSync(
        path.join(runLogDir, 'commerce-assistant-tasks-eval.json'),
        JSON.stringify({ name: fixture.name, passed, total: results.length, results }, null, 2)
    );
    if (failed.length > 0) process.exitCode = 1;
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
