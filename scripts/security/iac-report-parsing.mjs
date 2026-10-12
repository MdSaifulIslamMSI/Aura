// Pure, Docker-free helpers for the IaC gate's report parsing.
//
// Kept in its own module (the same pattern as nuclei-baseline.mjs) so the
// gate logic can be unit-tested without a Docker engine. The runners
// (run-docker-tool.mjs) stay thin wrappers around these functions.
//
// Report shapes, as actually observed in CI:
//   checkov --compact --output json
//     -> ARRAY of { check_type, results: { failed_checks: [...] } }
//   checkov (non-compact)
//     -> { results: { failed_checks: [...] }, summary: {...} }
//   tfsec --format json
//     -> { results: [ ... ] }
//   terrascan -o json
//     -> { results: { violations: [...], scan_errors: [...] }, scan_summary: {...} }

/** Checkov's compact output is an array of per-check-type entries; the plain
 *  object form carries the same shape at the top level. Normalise to a list. */
export const checkovReportEntries = (report) => (Array.isArray(report) ? report : [report]);

/** Total failed checks across every checkov entry (both report shapes). */
export const countCheckovFailedChecks = (report) => checkovReportEntries(report)
    .reduce((total, entry) => {
        const checks = entry?.results?.failed_checks;
        return total + (Array.isArray(checks) ? checks.length : 0);
    }, 0);

/**
 * Remove accepted findings from a checkov JSON report in place.
 * `isAccepted(ruleId, filePath)` decides what the baseline accepts.
 * Returns the number of removed checks.
 */
export const filterAcceptedCheckovChecks = (report, isAccepted) => {
    let removed = 0;
    for (const entry of checkovReportEntries(report)) {
        const failedChecks = entry?.results?.failed_checks;
        if (!Array.isArray(failedChecks)) continue;
        const kept = failedChecks.filter(
            (check) => !isAccepted(check?.check_id, check?.file_path),
        );
        removed += failedChecks.length - kept.length;
        entry.results.failed_checks = kept;
    }
    return removed;
};

/** tfsec findings (an array of result objects). */
export const countTfsecFindings = (report) => (
    Array.isArray(report?.results) ? report.results.length : 0
);

/** terrascan policy violations. */
export const countTerrascanViolations = (report) => (
    Array.isArray(report?.results?.violations) ? report.results.violations.length : 0
);
