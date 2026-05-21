#!/usr/bin/env node
import { loadStudentPackEnv } from './lib/student-pack-env.mjs';

loadStudentPackEnv();

const args = new Set(process.argv.slice(2));
const isDoctor = args.has('--doctor');
const apiKey = String(process.env.TESTMAIL_APIKEY || '').trim();
const namespace = String(process.env.TESTMAIL_NAMESPACE || '').trim();
const tagArg = process.argv.find((arg) => arg.startsWith('--tag='));
const tag = String(tagArg ? tagArg.slice('--tag='.length) : process.env.TESTMAIL_TAG || '').trim();

if (!apiKey || !namespace) {
  console.log('TESTMAIL_APIKEY and TESTMAIL_NAMESPACE are required for Testmail.app checks.');
  process.exit(isDoctor ? 0 : 1);
}

const url = new URL('https://api.testmail.app/api/json');
url.searchParams.set('apikey', apiKey);
url.searchParams.set('namespace', namespace);
if (tag) {
  url.searchParams.set('tag', tag);
}
url.searchParams.set('limit', '1');

try {
  let parsed;
  if (apiKey.includes('mock') || namespace.includes('mock')) {
    parsed = { count: 0, emails: [] };
  } else {
    const response = await fetch(url);
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Testmail.app returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    parsed = JSON.parse(body);
  }
  const emails = Array.isArray(parsed.emails) ? parsed.emails : [];
  console.log(JSON.stringify({
    ok: true,
    namespace,
    tag: tag || null,
    count: Number(parsed.count || emails.length || 0),
    latestSubject: emails[0]?.subject || null,
    latestTimestamp: emails[0]?.timestamp || emails[0]?.date || null,
  }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
