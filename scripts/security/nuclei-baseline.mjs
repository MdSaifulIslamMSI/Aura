// Nuclei baseline filtering.
//
// Kept separate from run-docker-tool.mjs so the exception/expiry rules (the
// anti-rot control documented in docs/security/nuclei-policy.md) can be unit
// tested without a Docker engine: node --test scripts/security/nuclei-baseline.test.mjs

import fs from 'node:fs';

export const loadNucleiExceptions = (exceptionsPath) => {
  if (!exceptionsPath || !fs.existsSync(exceptionsPath)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
  } catch (error) {
    throw new Error(`nuclei-exceptions.json is not valid JSON: ${error.message}`);
  }
  return Array.isArray(parsed?.exceptions) ? parsed.exceptions : [];
};

export const isExpiredNucleiException = (exception) => {
  const expiresOn = String(exception?.expiresOn || '').trim();
  if (!expiresOn) return false;
  const parsed = new Date(`${expiresOn}T23:59:59Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < Date.now();
};

export const nucleiTemplateId = (finding) => String(
  finding?.templateID || finding?.['template-id'] || finding?.info?.name || ''
);

export const nucleiMatchedHost = (finding) => String(
  finding?.matchedAt || finding?.['matched-at'] || finding?.matched_at || finding?.host || ''
);

// Nuclei's SARIF export records only the hostname in the result message and
// location, while the JSONL export records the full URL including the port. An
// exception written against the JSONL host ("host.docker.internal:8099") must
// still match the SARIF text ("host.docker.internal"), otherwise the finding is
// suppressed in the JSONL gate but reappears as a live alert in the uploaded
// SARIF. Compare on the host portion of the exception, with and without its
// port, matched as a WHOLE token: plain substring matching lets an exception
// for "example.com" suppress findings on "evil-example.com" or
// "host.example.com", so the candidate must be bounded by characters that
// cannot appear inside a hostname.
const hostMatchesException = (text, host) => {
  if (!host) return true;
  const haystack = String(text || '');
  const candidates = [host];
  const hostWithoutPort = host.replace(/:\d+$/, '');
  if (hostWithoutPort && hostWithoutPort !== host) candidates.push(hostWithoutPort);

  return candidates.some((candidate) => {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Leading and trailing boundaries exclude hostname characters (letters,
    // digits, dots, hyphens) so the host never matches as a suffix or
    // substring of a longer domain.
    const pattern = new RegExp(`(^|[^a-z0-9.-])${escaped}([^a-z0-9.-]|$)`, 'i');
    return pattern.test(haystack);
  });
};

export const isAcceptedNucleiFinding = (finding, exceptions) => exceptions.some((exception) => {
  if (isExpiredNucleiException(exception)) return false;
  // Fail closed on malformed entries: the policy (docs/security/nuclei-policy.md)
  // requires template, reason, and expiresOn. A missing field never suppresses.
  const template = String(exception?.template || '').trim();
  const reason = String(exception?.reason || '').trim();
  const expiresOn = String(exception?.expiresOn || '').trim();
  if (!template || !reason || !expiresOn) return false;
  if (template !== nucleiTemplateId(finding)) return false;
  const host = String(exception?.host || '').trim();
  if (!host) return true;
  return hostMatchesException(nucleiMatchedHost(finding), host);
});

export const readNucleiJsonlFindings = (reportPath) => {
  if (!reportPath || !fs.existsSync(reportPath)) return [];
  return fs.readFileSync(reportPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const replaceReportFile = (reportPath, contents) => {
  const tempPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, contents);
  fs.renameSync(tempPath, reportPath);
};

export const filterNucleiJsonlReport = (reportPath, exceptions) => {
  if (!reportPath || !fs.existsSync(reportPath)) return 0;
  const findings = readNucleiJsonlFindings(reportPath);
  const keptFindings = findings.filter((finding) => !isAcceptedNucleiFinding(finding, exceptions));
  const removed = findings.length - keptFindings.length;
  if (removed > 0) {
    replaceReportFile(reportPath, keptFindings.map((finding) => JSON.stringify(finding)).join('\n') + '\n');
  }
  return removed;
};

export const filterNucleiSarifReport = (reportPath, exceptions) => {
  if (!reportPath || !fs.existsSync(reportPath)) return 0;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  let removed = 0;
  for (const runReport of report.runs || []) {
    if (!Array.isArray(runReport.results)) continue;
    runReport.results = runReport.results.filter((result) => {
      const ruleId = String(result.ruleId || result.rule?.id || '');
      // The SARIF host appears in the message text and again in the first
      // location; check both so a host-scoped exception matches either way.
      const resultText = [
        String(result.message?.text || ''),
        ...(result.locations || []).map((location) => String(location?.message?.text || '')),
      ].join(' ');
      const accepted = exceptions.some((exception) => {
        if (isExpiredNucleiException(exception)) return false;
        const template = String(exception?.template || '').trim();
        const reason = String(exception?.reason || '').trim();
        const expiresOn = String(exception?.expiresOn || '').trim();
        if (!template || !reason || !expiresOn) return false;
        if (template !== ruleId) return false;
        const host = String(exception?.host || '').trim();
        return hostMatchesException(resultText, host);
      });
      if (accepted) removed += 1;
      return !accepted;
    });
  }
  if (removed > 0) {
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return removed;
};

// Nuclei's SARIF exporter writes "executionSuccessful": false on every scan —
// observed on v3.11.1 even for a clean run (exit code 0, "Errors: 0"). GitHub
// reads that flag when the SARIF is uploaded to code scanning and attaches the
// warning "unsuccessful tool execution, exit code 0" to the analysis, which
// puts the nuclei tool into an error state on the Security > Code scanning
// tool status page. runNuclei only calls this after the scan container exited
// cleanly (run() propagates a non-zero docker exit code), so the flag is
// corrected to match the real outcome; a genuinely failed scan never reaches
// this call and keeps its flag.
export const markNucleiSarifExecutionSuccessful = (reportPath) => {
  if (!reportPath || !fs.existsSync(reportPath)) return false;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  let patched = false;
  for (const runReport of report.runs || []) {
    for (const invocation of runReport.invocations || []) {
      if (invocation?.executionSuccessful === false) {
        invocation.executionSuccessful = true;
        patched = true;
      }
    }
  }
  if (patched) {
    replaceReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return patched;
};

export const countNucleiGatingFindings = (reportPath) => readNucleiJsonlFindings(reportPath)
  .filter((finding) => ['critical', 'high'].includes(String(finding?.info?.severity || '').toLowerCase()));
