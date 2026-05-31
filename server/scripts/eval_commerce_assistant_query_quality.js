#!/usr/bin/env node

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA || 'false';
process.env.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED = process.env.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED || 'false';

const fs = require('fs');
const path = require('path');

const {
    __testables,
} = require('../services/ai/commerceAssistantService');

const fixturePath = path.join(__dirname, '..', 'evals', 'commerceAssistantQueryQuality.json');
const runLogDir = path.join(__dirname, '..', '..', '.run-logs');
const jsonReportPath = path.join(runLogDir, 'commerce-assistant-query-quality-eval.json');
const markdownReportPath = path.join(runLogDir, 'commerce-assistant-query-quality-eval.md');

const readFixture = () => {
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.cases) || parsed.cases.length === 0) {
        throw new Error(`Eval fixture has no cases: ${fixturePath}`);
    }
    return parsed;
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const inspectValue = (value) => JSON.stringify(value);

const addCheck = (checks, name, actual, expected, predicate = Object.is) => {
    const pass = predicate(actual, expected);
    checks.push({
        name,
        pass,
        actual,
        expected,
    });
};

const normalizeTerm = (value) => String(value || '').trim().toLowerCase();

const includesAllTerms = (actualTerms = [], expectedTerms = []) => {
    const actual = new Set((Array.isArray(actualTerms) ? actualTerms : []).map(normalizeTerm).filter(Boolean));
    return (Array.isArray(expectedTerms) ? expectedTerms : []).every((term) => actual.has(normalizeTerm(term)));
};

const shouldEvaluateRetrievalQuery = (testCase) => (
    !testCase.skipRetrievalQuery
    && hasOwn(testCase.expect, 'query')
);

const evaluateCase = async (testCase) => {
    const message = String(testCase.message || '');
    const assistantSession = testCase.assistantSession || {};
    const conversationHistory = Array.isArray(testCase.conversationHistory) ? testCase.conversationHistory : [];
    const actionRequest = testCase.actionRequest || null;
    const expect = testCase.expect || {};

    const routeDecision = __testables.detectRoute({
        message,
        assistantSession,
        actionRequest,
    });
    const filters = __testables.inferStructuredRetrievalFilters({
        message,
        assistantSession,
    });

    let retrieval = null;
    if (shouldEvaluateRetrievalQuery(testCase)) {
        retrieval = await __testables.deriveRetrievalQuery({
            message,
            assistantSession,
            conversationHistory,
            route: routeDecision.route,
        });
    }

    const checks = [];
    if (hasOwn(expect, 'route')) addCheck(checks, 'route', routeDecision.route, expect.route);
    if (hasOwn(expect, 'category')) addCheck(checks, 'category', filters.category, expect.category);
    if (hasOwn(expect, 'brand')) addCheck(checks, 'brand', filters.brand, expect.brand);
    if (hasOwn(expect, 'minPrice')) addCheck(checks, 'minPrice', filters.minPrice, expect.minPrice);
    if (hasOwn(expect, 'maxPrice')) addCheck(checks, 'maxPrice', filters.maxPrice, expect.maxPrice);
    if (hasOwn(expect, 'minRating')) addCheck(checks, 'minRating', filters.minRating, expect.minRating);
    if (hasOwn(expect, 'inStock')) addCheck(checks, 'inStock', filters.inStock, expect.inStock);
    if (hasOwn(expect, 'sortBy')) addCheck(checks, 'sortBy', filters.sortBy, expect.sortBy);
    if (hasOwn(expect, 'requiredTerms')) {
        addCheck(
            checks,
            'requiredTerms',
            filters.requiredTerms,
            expect.requiredTerms,
            includesAllTerms
        );
    }
    if (hasOwn(expect, 'query')) {
        addCheck(checks, 'query', retrieval?.query || '', expect.query);
    }

    const failedChecks = checks.filter((check) => !check.pass);
    return {
        id: testCase.id,
        message,
        pass: failedChecks.length === 0,
        routeDecision,
        filters,
        retrieval,
        checks,
        failedChecks,
    };
};

const escapeMarkdownCell = (value) => String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

const formatFailedChecks = (failedChecks = []) => {
    if (failedChecks.length === 0) return '';
    return failedChecks
        .map((check) => `${check.name}: expected ${inspectValue(check.expected)}, got ${inspectValue(check.actual)}`)
        .join('; ');
};

const writeReports = ({ fixture, results, startedAt, finishedAt }) => {
    fs.mkdirSync(runLogDir, { recursive: true });
    const passed = results.filter((entry) => entry.pass).length;
    const failed = results.length - passed;
    const report = {
        name: fixture.name,
        version: fixture.version,
        startedAt,
        finishedAt,
        summary: {
            total: results.length,
            passed,
            failed,
        },
        results,
    };

    fs.writeFileSync(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`);

    const rows = results.map((entry) => (
        `| ${entry.pass ? 'PASS' : 'FAIL'} | ${escapeMarkdownCell(entry.id)} | ${escapeMarkdownCell(entry.message)} | ${escapeMarkdownCell(formatFailedChecks(entry.failedChecks))} |`
    ));
    const markdown = [
        `# ${fixture.name}`,
        '',
        `Started: ${startedAt}`,
        `Finished: ${finishedAt}`,
        `Result: ${passed}/${results.length} passed`,
        '',
        '| Status | Case | Message | Failed checks |',
        '| --- | --- | --- | --- |',
        ...rows,
        '',
    ].join('\n');
    fs.writeFileSync(markdownReportPath, markdown);
};

const main = async () => {
    const startedAt = new Date().toISOString();
    const fixture = readFixture();
    const results = [];
    for (const testCase of fixture.cases) {
        results.push(await evaluateCase(testCase));
    }
    const finishedAt = new Date().toISOString();
    writeReports({ fixture, results, startedAt, finishedAt });

    const passed = results.filter((entry) => entry.pass).length;
    const failed = results.length - passed;
    console.log(`commerce-assistant-query-quality: ${passed}/${results.length} passed`);
    console.log(`JSON report: ${jsonReportPath}`);
    console.log(`Markdown report: ${markdownReportPath}`);

    if (failed > 0) {
        console.log('');
        console.log('Failures:');
        results
            .filter((entry) => !entry.pass)
            .forEach((entry) => {
                console.log(`- ${entry.id}: ${formatFailedChecks(entry.failedChecks)}`);
            });
        process.exitCode = 1;
    }
};

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
