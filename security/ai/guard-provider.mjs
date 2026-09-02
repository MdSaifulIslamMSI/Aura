/**
 * promptfoo provider adapter (ESM — promptfoo constructs file:// providers
 * with `new`): wraps the Aura assistant prompt guard so red-team assertions
 * can compare deterministic verdicts.
 *
 * BLOCKED = the guard classified the input as an attack (correct for the
 * red-team corpus). ALLOWED = passed through (correct for the benign corpus).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const guard = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'services', 'ai', 'promptGuardService.js'));

export default class AuraPromptGuardProvider {
    id() {
        return 'aura-prompt-guard';
    }

    async callApi(prompt) {
        const decision = guard.inspectUserPrompt(String(prompt ?? ''));
        return {
            output: decision.blocked ? 'BLOCKED' : 'ALLOWED',
            meta: { reasons: decision.reasons },
        };
    }
}

