import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderInventoryMarkdown, scanCryptoInventory } from './pqc-scanner.mjs';

const parseArgs = (argv) => {
  const options = {
    changedOnly: false,
    failOnBlocker: false,
    json: false,
    markdown: false,
    root: process.cwd(),
    reportDir: path.join(process.cwd(), 'reports', 'security'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--changed-only') options.changedOnly = true;
    if (arg === '--fail-on-blocker') options.failOnBlocker = true;
    if (arg === '--json') options.json = true;
    if (arg === '--markdown') options.markdown = true;
    if (arg === '--root') {
      options.root = argv[index + 1];
      index += 1;
    }
    if (arg === '--report-dir') {
      options.reportDir = argv[index + 1];
      index += 1;
    }
  }

  if (!options.json && !options.markdown) {
    options.json = true;
    options.markdown = true;
  }

  return options;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const inventory = scanCryptoInventory({
    root: options.root,
    changedOnly: options.changedOnly,
  });

  mkdirSync(options.reportDir, { recursive: true });
  if (options.json) {
    writeFileSync(path.join(options.reportDir, 'crypto-inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  }
  if (options.markdown) {
    writeFileSync(path.join(options.reportDir, 'crypto-inventory.md'), renderInventoryMarkdown(inventory));
  }

  console.log(`[pqc-inventory] scanned ${inventory.summary.filesScanned} file(s): ${inventory.summary.blockers} blocker(s), ${inventory.summary.warnings} warning(s), ${inventory.summary.info} info finding(s).`);

  if (options.failOnBlocker && inventory.summary.blockers > 0) {
    process.exit(1);
  }
};

try {
  main();
} catch (error) {
  console.error(`[pqc-inventory] ${error.message}`);
  process.exit(2);
}
