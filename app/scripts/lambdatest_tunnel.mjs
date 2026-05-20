import lambdaTunnel from '@lambdatest/node-tunnel';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadLocalProviderEnv = () => {
  const candidates = [
    resolve(process.cwd(), '..', '.student-pack.local.env'),
    resolve(process.cwd(), '.student-pack.local.env'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const text = readFileSync(candidate, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
};

loadLocalProviderEnv();

const user = process.env.LT_USERNAME || process.env.LAMBDATEST_USERNAME;
const key = process.env.LT_ACCESS_KEY || process.env.LAMBDATEST_ACCESS_KEY;
const tunnelName = process.env.LT_TUNNEL_NAME || 'aura-local';

if (!user || !key) {
  console.error('LT_USERNAME and LT_ACCESS_KEY are required to start the LambdaTest tunnel.');
  process.exit(1);
}

const tunnel = new lambdaTunnel();
const tunnelArgs = {
  user,
  key,
  tunnelName,
  verbose: true,
};

const stop = async () => {
  try {
    await tunnel.stop();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  await tunnel.start(tunnelArgs);
  console.log(`LambdaTest tunnel is running: ${tunnelName}`);
  await new Promise(() => {});
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
