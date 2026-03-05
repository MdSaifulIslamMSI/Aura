const asyncHandler = require('express-async-handler');
const OpenAI = require('openai');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { resolveCategory } = require('../config/categories');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PROVIDER_TIMEOUT_MS = Number(process.env.CHAT_PROVIDER_TIMEOUT_MS || 8000);
const CHAT_WINDOW_MS = Number(process.env.CHAT_USER_WINDOW_MS || (15 * 60 * 1000));
const CHAT_MAX_REQUESTS_PER_WINDOW = Number(process.env.CHAT_USER_MAX_REQUESTS || 60);
const CIRCUIT_OPEN_MS = Number(process.env.CHAT_CIRCUIT_OPEN_MS || 60_000);
const MAX_PROVIDER_FAILURES = Number(process.env.CHAT_PROVIDER_MAX_FAILURES || 5);

const userQuotaBuckets = new Map();
const providerCircuit = {
    gemini: { failures: 0, openUntil: 0 },
    openai: { failures: 0, openUntil: 0 },
};

let openaiClient = null;
const getOpenAIClient = () => {
    if (!openaiClient && process.env.OPENAI_API_KEY) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
};

const withTimeout = async (promise, timeoutMs, label) => {
    let timeoutId = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
};

const isCircuitOpen = (providerName) => {
    const state = providerCircuit[providerName];
    if (!state) return false;
    return Date.now() < Number(state.openUntil || 0);
};

const markProviderSuccess = (providerName) => {
    if (!providerCircuit[providerName]) return;
    providerCircuit[providerName].failures = 0;
    providerCircuit[providerName].openUntil = 0;
};

const markProviderFailure = (providerName) => {
    if (!providerCircuit[providerName]) return;
    const state = providerCircuit[providerName];
    state.failures += 1;
    if (state.failures >= MAX_PROVIDER_FAILURES) {
        state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
    }
};

const assertPrivateQuota = (userId) => {
    const key = String(userId || '').trim();
    if (!key) throw new AppError('User identity is required for private chat', 401);

    const now = Date.now();
    const current = userQuotaBuckets.get(key);
    if (!current || current.expiresAt <= now) {
        userQuotaBuckets.set(key, { count: 1, expiresAt: now + CHAT_WINDOW_MS });
        return;
    }

    if (current.count >= CHAT_MAX_REQUESTS_PER_WINDOW) {
        throw new AppError('Private AI chat quota exceeded. Please retry later.', 429);
    }

    current.count += 1;
    userQuotaBuckets.set(key, current);
};

const SYSTEM_PROMPT = `You are AuraBot, an advanced assistant for the AURA platform.

Primary domains:
1) Commerce: product discovery, deals, comparisons, budgeting, accessories
2) Productivity: planning, checklists, prioritization, schedules
3) Writing: emails, messages, rewrite, summarize, polish
4) Learning: explain concepts, examples, quizzes, step-by-step tutoring
5) Technical help: coding guidance, debugging strategy, architecture tradeoffs

Behavior rules:
- Be direct, practical, and concise.
- If user asks shopping questions, return shopping actions when useful.
- If user asks non-shopping questions, answer fully with no fake product results.
- Never invent order/payment/account data.
- If unsure, say what is unknown and provide next best action.

When shopping retrieval is needed, append one or more action blocks at the end:
[SEARCH: {"category":"...","keyword":"...","maxPrice":number,"minPrice":number,"sort":"price-asc|price-desc|rating|discount|newest"}]
[COMPARE: {"keyword1":"...","keyword2":"..."}]
[DEALS: {"category":"...","minDiscount":number}]
[TRENDING: {"category":"...","limit":number}]

Allowed categories:
Mobiles, Laptops, Electronics, Men's Fashion, Women's Fashion, Home & Kitchen, Gaming & Accessories, Books, Footwear
`;

const parseActions = (text) => {
    const actions = [];
    const patterns = [
        { type: 'search', regex: /\[SEARCH:\s*({.*?})\]/gs },
        { type: 'compare', regex: /\[COMPARE:\s*({.*?})\]/gs },
        { type: 'deals', regex: /\[DEALS:\s*({.*?})\]/gs },
        { type: 'trending', regex: /\[TRENDING:\s*({.*?})\]/gs }
    ];

    for (const { type, regex } of patterns) {
        let match;
        while ((match = regex.exec(text)) !== null) {
            try {
                actions.push({ type, params: JSON.parse(match[1]) });
            } catch (_) {
                // Skip malformed JSON action blocks
            }
        }
    }

    return actions;
};

const cleanResponse = (text) => String(text || '')
    .replace(/\[SEARCH:\s*{.*?}\]/gs, '')
    .replace(/\[COMPARE:\s*{.*?}\]/gs, '')
    .replace(/\[DEALS:\s*{.*?}\]/gs, '')
    .replace(/\[TRENDING:\s*{.*?}\]/gs, '')
    .trim();

const buildSort = (sort) => {
    const sortMap = {
        'price-asc': { price: 1 },
        'price-desc': { price: -1 },
        rating: { rating: -1 },
        discount: { discountPercentage: -1 },
        newest: { createdAt: -1 }
    };
    return sortMap[sort] || { ratingCount: -1 };
};

const normalizeCategory = (category) => {
    if (!category) return null;
    const resolved = resolveCategory(category);
    return resolved || { $regex: new RegExp(category, 'i') };
};

const searchProducts = async (params = {}) => {
    const query = {};

    if (params.category) {
        query.category = normalizeCategory(params.category);
    }

    if (params.keyword) {
        const regex = { $regex: String(params.keyword), $options: 'i' };
        query.$or = [{ title: regex }, { brand: regex }, { description: regex }, { category: regex }];
    }

    if (params.maxPrice || params.minPrice) {
        query.price = {};
        if (params.minPrice) query.price.$gte = Number(params.minPrice);
        if (params.maxPrice) query.price.$lte = Number(params.maxPrice);
    }

    return Product.find(query)
        .sort(buildSort(params.sort))
        .limit(Number(params.limit) || 6)
        .select('id title price originalPrice discountPercentage image category rating ratingCount brand stock deliveryTime')
        .lean();
};

const compareProducts = async (keyword1, keyword2) => {
    const safe1 = String(keyword1 || '').trim();
    const safe2 = String(keyword2 || '').trim();

    if (!safe1 || !safe2) return [];

    const [a, b] = await Promise.all([
        Product.find({
            $or: [
                { title: { $regex: safe1, $options: 'i' } },
                { brand: { $regex: safe1, $options: 'i' } }
            ]
        }).sort({ ratingCount: -1 }).limit(1).lean(),
        Product.find({
            $or: [
                { title: { $regex: safe2, $options: 'i' } },
                { brand: { $regex: safe2, $options: 'i' } }
            ]
        }).sort({ ratingCount: -1 }).limit(1).lean()
    ]);

    return [...a, ...b];
};

const getDeals = async (params = {}) => {
    const query = {
        discountPercentage: { $gte: Number(params.minDiscount) || 10 }
    };

    if (params.category) {
        query.category = normalizeCategory(params.category);
    }

    return Product.find(query)
        .sort({ discountPercentage: -1 })
        .limit(Number(params.limit) || 6)
        .select('id title price originalPrice discountPercentage image category rating brand')
        .lean();
};

const getTrending = async (params = {}) => {
    const query = {};
    if (params.category) {
        query.category = normalizeCategory(params.category);
    }

    return Product.find(query)
        .sort({ ratingCount: -1 })
        .limit(Number(params.limit) || 6)
        .select('id title price originalPrice discountPercentage image category rating ratingCount brand')
        .lean();
};

const executeActions = async (actions = []) => {
    let products = [];
    let actionType = 'assistant';

    for (const action of actions) {
        actionType = action.type;
        switch (action.type) {
            case 'search':
                products = await searchProducts(action.params);
                break;
            case 'compare':
                products = await compareProducts(action.params?.keyword1, action.params?.keyword2);
                break;
            case 'deals':
                products = await getDeals(action.params);
                break;
            case 'trending':
                products = await getTrending(action.params);
                break;
            default:
                actionType = 'assistant';
        }

        if (products.length > 0) break;
    }

    if (!actions.length) {
        actionType = 'assistant';
    }

    return { products, actionType };
};

const generateSuggestions = (products, actionType, lastMessage) => {
    if (actionType === 'compare' && products.length >= 2) {
        return ['Which one is better value?', 'Show alternatives', 'Compare budget options'];
    }

    if (actionType === 'deals') {
        return ['Show more deals', 'Best under 30000', 'Trending products'];
    }

    if (products.length > 0) {
        return ['Compare top 2', 'Show cheaper options', 'Best rated picks', 'Add accessories'];
    }

    const lower = String(lastMessage || '').toLowerCase();

    if (/code|bug|debug|javascript|react|node/i.test(lower)) {
        return ['Explain this error', 'Show fix steps', 'Refactor approach'];
    }

    if (/email|write|rewrite|message|draft/i.test(lower)) {
        return ['Write a formal email', 'Shorten this text', 'Improve tone'];
    }

    if (/plan|schedule|study|roadmap|learn/i.test(lower)) {
        return ['Create a 7-day plan', 'Give checklist', 'Explain with examples'];
    }

    return ['Best deals today', 'Help me write an email', 'Explain a concept simply', 'Create a task plan'];
};

const CATEGORY_HINTS = [
    { keys: ['mobile', 'phone', 'smartphone', 'iphone', 'samsung', 'pixel'], category: 'Mobiles' },
    { keys: ['laptop', 'notebook', 'macbook'], category: 'Laptops' },
    { keys: ['electronics', 'earbuds', 'speaker', 'headphone', 'audio'], category: 'Electronics' },
    { keys: ['men', 'mens', 'shirt', 'jacket', 'trouser'], category: "Men's Fashion" },
    { keys: ['women', 'womens', 'dress', 'saree', 'kurti'], category: "Women's Fashion" },
    { keys: ['home', 'kitchen', 'furniture', 'appliance'], category: 'Home & Kitchen' },
    { keys: ['gaming', 'controller', 'mouse', 'keyboard'], category: 'Gaming & Accessories' },
    { keys: ['book', 'novel', 'reading'], category: 'Books' },
    { keys: ['shoe', 'sneaker', 'footwear', 'boot', 'sandal'], category: 'Footwear' }
];

const detectCategoryHint = (text) => {
    const lower = String(text || '').toLowerCase();
    const hit = CATEGORY_HINTS.find((group) => group.keys.some((k) => lower.includes(k)));
    return hit ? hit.category : '';
};

const extractBudget = (text) => {
    const match = String(text || '').toLowerCase().match(/(?:under|below|less than|max|within)\s*(?:rs\.?|inr|₹)?\s*(\d{3,7})/i)
        || String(text || '').match(/(\d{4,7})/);
    return match ? Number(match[1]) : 0;
};

const buildLeaveEmailDraft = (message) => {
    const lower = String(message || '').toLowerCase();
    const dayMatch = lower.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    const dateToken = dayMatch ? dayMatch[1] : 'tomorrow';

    const reasonMatch =
        String(message || '').match(/(?:due to|because of)\s+([^.!,\n]+)/i) ||
        String(message || '').match(/\b(fever|cold|migraine|health issue|medical issue|illness)\b/i);
    const reasonRaw = reasonMatch
        ? (reasonMatch[1] || reasonMatch[0]).trim()
        : 'a personal health issue';
    const reason = reasonRaw.charAt(0).toUpperCase() + reasonRaw.slice(1);

    return [
        `Subject: Leave Request for ${dateToken.charAt(0).toUpperCase() + dateToken.slice(1)}`,
        '',
        'Hi [Manager Name],',
        '',
        `I am not feeling well due to ${reason.toLowerCase()} and would like to request leave for ${dateToken}.`,
        'I will ensure any urgent items are handed over and will be reachable for critical matters if needed.',
        '',
        'Thank you for your understanding.',
        '',
        'Regards,',
        '[Your Name]'
    ].join('\n');
};

const buildPlanDraft = (message) => {
    const lower = String(message || '').toLowerCase();

    if (/study|exam|interview|dsa|leetcode|learning/i.test(lower)) {
        return [
            '7-Day Focus Plan:',
            'Day 1: Define goal, assess current level, list top 3 weak areas.',
            'Day 2: Deep practice block 1 (90 min) + short revision.',
            'Day 3: Deep practice block 2 + timed problem set.',
            'Day 4: Review mistakes, create error log, retry weak topics.',
            'Day 5: Mock session under realistic constraints.',
            'Day 6: Targeted revision + concise notes.',
            'Day 7: Final mock + retrospective + next-week plan.',
            '',
            'Daily cadence: 90 min focus, 20 min review, 10 min planning.'
        ].join('\n');
    }

    return [
        'Action Plan Template:',
        '1. Define outcome and deadline clearly.',
        '2. Break work into 3 milestones.',
        '3. Assign daily 60-90 minute focus blocks.',
        '4. Track blockers and resolve one per day.',
        '5. Review progress every evening and adjust next day.'
    ].join('\n');
};

const buildCodingPlaybook = () => ([
    'Debug Playbook:',
    '1. Reproduce consistently with minimal steps.',
    '2. Check logs/stack trace and isolate failing layer.',
    '3. Validate inputs, null cases, and async timing.',
    '4. Write/adjust a focused test for the bug.',
    '5. Implement the smallest safe fix, then re-run tests.',
    '6. Add guardrails (validation, error handling, monitoring).'
].join('\n'));

const extractGeminiText = (payload) => {
    const first = payload?.candidates?.[0];
    const parts = first?.content?.parts || [];
    return parts.map((p) => p?.text || '').join('\n').trim();
};

const toGeminiHistory = (conversationHistory = []) => {
    return conversationHistory
        .slice(-8)
        .map((item) => {
            const role = item?.role === 'assistant' ? 'model' : 'user';
            const text = String(item?.content || '').trim().slice(0, 1200);
            if (!text) return null;
            return { role, parts: [{ text }] };
        })
        .filter(Boolean);
};

const callGemini = async (message, conversationHistory) => {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    if (!key) return null;
    if (isCircuitOpen('gemini')) return null;

    const url = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${key}`;
    const body = {
        systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: [
            ...toGeminiHistory(conversationHistory),
            { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            maxOutputTokens: 600
        }
    };

    const response = await withTimeout(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }), PROVIDER_TIMEOUT_MS, 'Gemini provider');

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini request failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const text = extractGeminiText(data);
    if (!text) throw new Error('Gemini returned empty response');
    return text;
};

const callOpenAI = async (message, conversationHistory) => {
    const client = getOpenAIClient();
    if (!client) return null;
    if (isCircuitOpen('openai')) return null;

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversationHistory.slice(-8).map((item) => ({
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            content: String(item?.content || '').slice(0, 1200)
        })),
        { role: 'user', content: message }
    ];

    const completion = await withTimeout(client.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 600,
    }), PROVIDER_TIMEOUT_MS, 'OpenAI provider');

    return completion?.choices?.[0]?.message?.content?.trim() || '';
};

const handleSmartFallback = async (message) => {
    const lower = String(message || '').toLowerCase();

    if (/^(hi|hello|hey|yo|good morning|good evening)/i.test(lower)) {
        return {
            text: 'Hi! I can help with shopping, writing, planning, learning, and technical questions. What do you want to do?',
            products: [],
            suggestions: ['Best deals today', 'Write a formal email', 'Create a study plan', 'Explain React hooks'],
            actionType: 'greeting',
            isAI: false
        };
    }

    if (/^(thanks|thank you|bye|goodbye|see you)/i.test(lower)) {
        return {
            text: 'Anytime. If you need shopping help or a quick plan, ask me directly.',
            products: [],
            suggestions: ['Show trending products', 'Draft a message', 'Build a checklist'],
            actionType: 'farewell',
            isAI: false
        };
    }

    if (/^[0-9+\-*/().%\s]+$/.test(lower)) {
        return {
            text: 'I cannot execute expressions directly for safety. Ask me to explain or solve it step-by-step.',
            products: [],
            suggestions: ['Explain this expression', 'Show manual calculation steps', 'Convert this formula'],
            actionType: 'assistant',
            isAI: false,
        };
    }

    if (/email|mail|message|draft|reply|rewrite|formal|professional/i.test(lower)) {
        return {
            text: /leave|vacation|sick|fever|absence/i.test(lower)
                ? buildLeaveEmailDraft(message)
                : 'Share recipient, tone, and key points. I will draft a clean message instantly.',
            products: [],
            suggestions: ['Write a leave email', 'Draft a follow-up email', 'Rewrite politely'],
            actionType: 'assistant',
            isAI: false
        };
    }

    if (/plan|roadmap|schedule|checklist|study|routine|timeline/i.test(lower)) {
        return {
            text: buildPlanDraft(message),
            products: [],
            suggestions: ['Create 7-day plan', 'Build exam schedule', 'Make a daily checklist'],
            actionType: 'assistant',
            isAI: false
        };
    }

    if (/code|coding|javascript|react|node|python|debug|bug|api|database/i.test(lower)) {
        return {
            text: buildCodingPlaybook(),
            products: [],
            suggestions: ['Explain this error', 'Refactor strategy', 'Design API contract'],
            actionType: 'assistant',
            isAI: false
        };
    }

    if (/deal|discount|offer|sale|cheap|affordable|budget/i.test(lower)) {
        const category = detectCategoryHint(lower);
        const products = await getDeals({ category, minDiscount: 10, limit: 6 });
        return {
            text: products.length
                ? `Found ${products.length} strong deal options${category ? ` in ${category}` : ''}.`
                : 'No major discounts found right now. I can search alternatives by budget.',
            products,
            suggestions: ['Show more deals', 'Trending products', 'Best under 30000'],
            actionType: 'deals',
            isAI: false
        };
    }

    if (/trend|trending|popular|best seller|hot/i.test(lower)) {
        const category = detectCategoryHint(lower);
        const products = await getTrending({ category, limit: 6 });
        return {
            text: products.length
                ? `These are currently trending${category ? ` in ${category}` : ''}.`
                : 'I could not find trending data right now, try a specific category.',
            products,
            suggestions: ['Show deals', 'Compare top 2', 'Best rated options'],
            actionType: 'trending',
            isAI: false
        };
    }

    if (/compare|vs|versus|better/i.test(lower)) {
        const vsMatch = lower.match(/(?:compare\s+)?(.+?)\s*(?:vs|versus|and)\s+(.+)/i);
        if (vsMatch) {
            const budget = extractBudget(lower);
            const lhs = vsMatch[1].replace(/(?:under|below|less than|max|within).*/i, '').trim();
            const rhs = vsMatch[2].replace(/(?:under|below|less than|max|within).*/i, '').trim();

            let products = [];
            if (budget > 0) {
                const [p1, p2] = await Promise.all([
                    searchProducts({ keyword: lhs, maxPrice: budget, limit: 1, sort: 'rating' }),
                    searchProducts({ keyword: rhs, maxPrice: budget, limit: 1, sort: 'rating' })
                ]);
                products = [...p1, ...p2];
            }
            if (products.length < 2) {
                products = await compareProducts(lhs, rhs);
            }

            return {
                text: products.length >= 2
                    ? 'Comparison ready. Check the side-by-side options below.'
                    : budget > 0
                        ? `I could not find a strong pair under INR ${budget.toLocaleString('en-IN')}. Try a slightly higher budget.`
                        : 'I need two clearer product names to compare properly.',
                products,
                suggestions: ['Which is better value?', 'Show alternatives', 'Compare budget models'],
                actionType: 'compare',
                isAI: false
            };
        }
    }

    if (/under|below|less than|max|within/i.test(lower)) {
        const priceMatch = lower.match(/(\d{3,7})/);
        const maxPrice = priceMatch ? Number(priceMatch[1]) : 30000;
        const category = detectCategoryHint(lower);
        const products = await searchProducts({
            keyword: category ? '' : message,
            category,
            maxPrice,
            sort: 'rating',
            limit: 6
        });
        return {
            text: products.length
                ? `Found ${products.length} options under INR ${maxPrice.toLocaleString('en-IN')}.`
                : `No matches found under INR ${maxPrice.toLocaleString('en-IN')}. Try a higher budget.`,
            products,
            suggestions: ['Show cheaper options', 'Top rated in budget', 'Show deals'],
            actionType: 'search',
            isAI: false
        };
    }

    const category = detectCategoryHint(lower);
    if (category) {
        const products = await getTrending({ category, limit: 6 });
        return {
            text: products.length
                ? `Here are popular picks in ${category}.`
                : `I could not find products in ${category} right now.`,
            products,
            suggestions: ['Show deals', 'Compare top 2', 'Best budget picks'],
            actionType: 'search',
            isAI: false
        };
    }

    const products = await searchProducts({ keyword: message, limit: 6, sort: 'rating' });
    if (products.length) {
        return {
            text: `Found ${products.length} matching products. Here are the best picks.`,
            products,
            suggestions: ['Compare top 2', 'Show cheaper options', 'Show deals'],
            actionType: 'search',
            isAI: false
        };
    }

    return {
        text: 'I can help with shopping, writing, planning, coding guidance, and explainers. Tell me your goal plus constraints, and I will produce a concrete answer.',
        products: [],
        suggestions: ['Best deals in mobiles', 'Draft a support email', 'Create a daily schedule', 'Explain APIs simply'],
        actionType: 'assistant',
        isAI: false
    };
};

const handlePublicChat = asyncHandler(async (req, res, next) => {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
        return next(new AppError('Message is required', 400));
    }

    const trimmedMessage = message.trim().slice(0, 600);
    const fallback = await handleSmartFallback(trimmedMessage);
    return res.json({
        ...fallback,
        suggestions: fallback.suggestions?.slice(0, 4) || [],
        provider: 'local',
        mode: 'public',
    });
});

const handleChat = asyncHandler(async (req, res, next) => {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
        return next(new AppError('Message is required', 400));
    }

    const trimmedMessage = message.trim().slice(0, 600);
    assertPrivateQuota(req.user?._id);

    let aiRaw = '';
    let provider = '';

    try {
        aiRaw = await callGemini(trimmedMessage, conversationHistory);
        if (aiRaw) {
            provider = 'gemini';
            markProviderSuccess('gemini');
        }
    } catch (error) {
        markProviderFailure('gemini');
        logger.warn('chat.provider_failed', {
            provider: 'gemini',
            requestId: req.requestId,
            userId: String(req.user?._id || ''),
            error: error.message,
        });
    }

    if (!aiRaw) {
        try {
            aiRaw = await callOpenAI(trimmedMessage, conversationHistory);
            if (aiRaw) {
                provider = 'openai';
                markProviderSuccess('openai');
            }
        } catch (error) {
            markProviderFailure('openai');
            logger.warn('chat.provider_failed', {
                provider: 'openai',
                requestId: req.requestId,
                userId: String(req.user?._id || ''),
                error: error.message,
            });
        }
    }

    if (!aiRaw) {
        const fallback = await handleSmartFallback(trimmedMessage);
        return res.json(fallback);
    }

    const actions = parseActions(aiRaw);
    const cleanText = cleanResponse(aiRaw);
    const { products, actionType } = await executeActions(actions);

    return res.json({
        text: cleanText || 'I am here. Tell me what you want to achieve.',
        products,
        suggestions: generateSuggestions(products, actionType, trimmedMessage),
        actionType,
        isAI: true,
        provider,
        mode: 'private',
    });
});

module.exports = { handleChat, handlePublicChat };
