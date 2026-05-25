#!/usr/bin/env node
import process from 'node:process';
import {
  printContractReport,
  validateContract,
} from './env-contract-lib.mjs';

const result = validateContract({ env: process.env, mode: 'validate' });
printContractReport(result);

if (!result.safe) {
  process.exitCode = 1;
}
