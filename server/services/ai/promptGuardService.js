/**
 * Prompt guard — deterministic OWASP LLM Top 10 mitigations for the Aura
 * assistant. No dependencies, no model calls: every check is a fixed
 * pattern so CI can red-team the guard itself (security/ai/promptfooconfig.yaml).
 *
 * Design constraints:
 *  - High precision over recall: anything classified here becomes a hard
 *    rejection, so each pattern must be unambiguous. Over-blocking legitimate
 *    commerce questions is a worse failure than a rare miss caught downstream.
 *  - Never include raw user text in logs or errors (the controller logs only
 *    category flags); the reasons are stable machine-readable identifiers.
 */

const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier|preceding)\s+(instructions|prompts?|directions|rules)/i,
    /disregard\s+(all\s+|any\s+)?(previous|prior|above|your)\s+(instructions|prompts?|directions|rules)/i,
    /forget\s+(all\s+|any\s+)?(previous|prior|above|your)\s+(instructions|prompts?|training)/i,
    /new\s+(instructions?|rules?)\s*:\s*(you\s+)?(are|must|should)/i,
    /\boverride\s+(your\s+)?(instructions|system\s+prompt|programming|rules)/i,
];

const ROLE_CONFUSION_PATTERNS = [
    /you\s+are\s+now\s+(an?\s+)?(unrestricted|uncensored|evil|dan|hacked|jailbroken|different)/i,
    /\bdo\s+anything\s+now\b/i,
    /\bstay\s+in\s+character\s+as\s+(an?\s+)?(unrestricted|uncensored|evil)/i,
    /\b(?:enable|activate|turn\s+on|enter)\s+developer\s+mode\b/i,
    /\bdeveloper\s+(mode|messages?)\s+(enabled|on|activated)\b/i,
    /\bpretend\s+(that\s+)?(you\s+have\s+no|there\s+are\s+no)\s+(rules|restrictions|guidelines|filters)/i,
    // Chat-template role markers appearing inside user text.
    /<\|im_start\|>|<\|im_end\|>|<\|system\|>|\[INST\]|\[\/INST\]|<<\s*SYS\s*>>/i,
    /^#{1,6}\s*system\s*:/im,
];

const SYSTEM_PROMPT_EXTRACTION_PATTERNS = [
    /(?:reveal|show|print|repeat|display|output|recite|expose|leak)\s+(?:me\s+)?(?:your\s+)?(full\s+|complete\s+|entire\s+|original\s+|initial\s+)?(system\s+prompt|system\s+instructions|initial\s+instructions?|secret\s+prompt|hidden\s+prompt)/i,
    /what\s+(is|are)\s+your\s+(system\s+prompt|system\s+instructions|initial\s+instructions|hidden\s+rules)/i,
    /(?:repeat|echo|print|output|recite)\s+(?:the\s+|everything\s+|all\s+)?(text|words|content|instructions?)\s+(?:above|before\s+this|from\s+earlier)/i,
];

const SECRET_EXFILTRATION_PATTERNS = [
    /(?:reveal|show|print|give|send|display|output|leak|expose)\s+(?:me\s+|your\s+|us\s+)?(?:the\s+)?(api\s*_?key|api\s+secret|access\s+token|bearer\s+token|private\s+key|env(ironment)?\s+variables?|credentials?|connection\s+string|database\s+password)/i,
    /(?:dump|exfiltrate|base64\s+encode)\s+(?:the\s+|your\s+)?(env(ironment)?|\.env|secrets?|credentials)/i,
];

const EXCESSIVE_AGENCY_PATTERNS = [
    /\b(?:delete|remove|wipe|purge)\s+(?:all\s+|my\s+|the\s+)?(?:orders?|account|data|records?|users?|payments?)\b/i,
    /\b(?:transfer|send|wire)\s+(?:all\s+)?(?:my\s+)?(?:money|funds|\$|usd|inr)\b/i,
    /\b(?:change|reset)\s+(?:my\s+|the\s+)?password\s+(?:to|for)\b/i,
    /\b(?:purchase|buy|checkout|order)\s+(?:it|this|that|everything|all\s+of\s+it)\s+(?:without\s+confirmation|immediately|right\s+now\s+without)\b/i,
    /\bgive\s+yourself\s+(admin|root|sudo|owner)\b/i,
];

// Long base64 runs and data: URIs are a common payload-smuggling vector;
// legitimate commerce chat does not include 80+ char base64 blobs.
const ENCODED_PAYLOAD_PATTERN = /(?:[A-Za-z0-9+/=]{80,})|(?:data:(?:text|application)\/[a-z+.-]*;base64,[A-Za-z0-9+/=]{40,})/i;

// Invisible/ control characters used to smuggle instructions past filters.
const INVISIBLE_CHARACTER_PATTERN = /[\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{FEFF}\u{E0000}-\u{E007F}]/u;

const OUTPUT_SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    /\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
];


const categories = {
    instructionOverride: 'llm01.instruction_override',
    roleConfusion: 'llm01.role_confusion',
    systemPromptExtraction: 'llm01.system_prompt_extraction',
    secretExfiltration: 'llm02.secret_exfiltration',
    excessiveAgency: 'llm06.excessive_agency',
    encodedPayload: 'llm01.encoded_payload',
    invisibleCharacters: 'llm01.invisible_characters',
};

const checkPatterns = (text, patterns) => patterns.filter((pattern) => pattern.test(text));

/**
 * Inspect user-supplied assistant input. Returns a decision object; callers
 * reject the request when `blocked` is true and must never log raw text.
 *
 * @param {string} text raw user message
 * @returns {{ blocked: boolean, reasons: string[], categories: string[] }}
 */
const inspectUserPrompt = (text) => {
    const value = typeof text === 'string' ? text : '';
    const reasons = [];

    const addCategory = (category, matches) => {
        if (matches.length > 0) reasons.push(category);
    };

    addCategory(categories.instructionOverride, checkPatterns(value, PROMPT_INJECTION_PATTERNS));
    addCategory(categories.roleConfusion, checkPatterns(value, ROLE_CONFUSION_PATTERNS));
    addCategory(categories.systemPromptExtraction, checkPatterns(value, SYSTEM_PROMPT_EXTRACTION_PATTERNS));
    addCategory(categories.secretExfiltration, checkPatterns(value, SECRET_EXFILTRATION_PATTERNS));
    addCategory(categories.excessiveAgency, checkPatterns(value, EXCESSIVE_AGENCY_PATTERNS));

    if (ENCODED_PAYLOAD_PATTERN.test(value)) reasons.push(categories.encodedPayload);
    if (INVISIBLE_CHARACTER_PATTERN.test(value)) reasons.push(categories.invisibleCharacters);

    return {
        blocked: reasons.length > 0,
        reasons,
        categories: reasons,
    };
};

/**
 * Inspect assistant/tool output before it reaches the client. Catches secret
 * material and delayed (second-order) prompt injection smuggled through
 * retrieved documents or tool results.
 *
 * @param {string} text assistant or tool output
 * @returns {{ blocked: boolean, reasons: string[] }}
 */
const inspectAssistantOutput = (text) => {
    const value = typeof text === 'string' ? text : '';
    const reasons = [];

    if (OUTPUT_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
        reasons.push('llm02.output_secret_material');
    }
    if (PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
        reasons.push('llm01.output_delayed_injection');
    }

    return { blocked: reasons.length > 0, reasons };
};

/**
 * Inspect multi-turn conversation history for delayed (second-order) prompt
 * injection planted in earlier user turns. Only `user`-role entries are
 * evaluated — assistant/system entries are model-managed content.
 *
 * @param {Array<{ role?: string, content?: string }>} history
 * @returns {{ blocked: boolean, entries: Array<{ index: number, reasons: string[] }> }}
 */
const inspectConversationHistory = (history) => {
    if (!Array.isArray(history)) return { blocked: false, entries: [] };
    const flagged = [];
    history.forEach((entry, index) => {
        if (String(entry?.role || '') !== 'user') return;
        const decision = inspectUserPrompt(typeof entry?.content === 'string' ? entry.content : '');
        if (decision.blocked) flagged.push({ index, reasons: decision.reasons });
    });
    return { blocked: flagged.length > 0, entries: flagged };
};

module.exports = {
    categories,
    inspectAssistantOutput,
    inspectConversationHistory,
    inspectUserPrompt,
};
