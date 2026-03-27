import { useEffect, useRef } from 'react';
import { useMarket } from '@/context/MarketContext';
import { i18nApi } from '@/services/api';

const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE']);
const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt'];
const INPUT_VALUE_TYPES = new Set(['button', 'submit', 'reset']);
const WHITESPACE_ONLY_PATTERN = /^\s*$/;
const NON_TRANSLATABLE_PATTERN = /^(https?:\/\/|www\.|mailto:|tel:|\/[A-Za-z0-9._/-]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const SYMBOL_ONLY_PATTERN = /^[\d\s.,:%₹$€£¥()+\-–—/\\|[\]{}<>*_#@!?=&]+$/;

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const preserveEdgeWhitespace = (source = '', translated = '') => {
    const leading = String(source || '').match(/^\s*/)?.[0] || '';
    const trailing = String(source || '').match(/\s*$/)?.[0] || '';
    return `${leading}${String(translated || '').trim()}${trailing}`;
};

const createEntry = (value, language) => ({
    sourceText: String(value || ''),
    capturedLanguage: String(language || 'en'),
    lastAppliedValue: String(value || ''),
});

const shouldTranslate = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized || WHITESPACE_ONLY_PATTERN.test(value)) return false;
    if (normalized.length < 2) return false;
    if (NON_TRANSLATABLE_PATTERN.test(normalized)) return false;
    if (SYMBOL_ONLY_PATTERN.test(normalized)) return false;
    return /\p{L}/u.test(normalized);
};

const shouldSkipElement = (element) => {
    if (!element || BLOCKED_TAGS.has(element.tagName)) {
        return true;
    }

    if (typeof element.closest === 'function' && element.closest('[data-no-auto-translate="true"]')) {
        return true;
    }

    if (element.isContentEditable || element.tagName === 'TEXTAREA') {
        return true;
    }

    const role = String(element.getAttribute('role') || '').toLowerCase();
    return role === 'textbox';
};

const getAttributeNames = (element) => {
    const nextAttributes = [...ATTRIBUTE_NAMES];

    if (
        element.tagName === 'INPUT'
        && INPUT_VALUE_TYPES.has(String(element.getAttribute('type') || 'text').toLowerCase())
    ) {
        nextAttributes.push('value');
    }

    return nextAttributes;
};

export default function MarketAutoLocalizer() {
    const { language } = useMarket();
    const textEntriesRef = useRef(new WeakMap());
    const attributeEntriesRef = useRef(new WeakMap());
    const titleEntryRef = useRef(null);
    const cacheRef = useRef(new Map());
    const applyingRef = useRef(false);
    const scheduledRef = useRef(0);
    const runIdRef = useRef(0);

    useEffect(() => {
        if (typeof document === 'undefined') {
            return undefined;
        }

        const updateTextEntry = (node) => {
            const currentValue = String(node.nodeValue || '');
            let entry = textEntriesRef.current.get(node);

            if (!entry) {
                entry = createEntry(currentValue, language);
                textEntriesRef.current.set(node, entry);
                return entry;
            }

            if (currentValue !== entry.lastAppliedValue) {
                entry.sourceText = currentValue;
                entry.capturedLanguage = language;
                entry.lastAppliedValue = currentValue;
            }

            return entry;
        };

        const updateAttributeEntry = (element, attributeName) => {
            const currentValue = String(element.getAttribute(attributeName) || '');
            let attributeMap = attributeEntriesRef.current.get(element);
            if (!attributeMap) {
                attributeMap = new Map();
                attributeEntriesRef.current.set(element, attributeMap);
            }

            let entry = attributeMap.get(attributeName);
            if (!entry) {
                entry = createEntry(currentValue, language);
                attributeMap.set(attributeName, entry);
                return entry;
            }

            if (currentValue !== entry.lastAppliedValue) {
                entry.sourceText = currentValue;
                entry.capturedLanguage = language;
                entry.lastAppliedValue = currentValue;
            }

            return entry;
        };

        const updateTitleEntry = () => {
            const currentTitle = String(document.title || '');
            if (!titleEntryRef.current) {
                titleEntryRef.current = createEntry(currentTitle, language);
                return titleEntryRef.current;
            }

            if (currentTitle !== titleEntryRef.current.lastAppliedValue) {
                titleEntryRef.current = createEntry(currentTitle, language);
            }

            return titleEntryRef.current;
        };

        const translateSources = async (targetLanguage, sources) => {
            const uniqueSources = [...new Set(
                sources
                    .map(normalizeText)
                    .filter(Boolean)
            )];

            const missing = uniqueSources.filter((source) => !cacheRef.current.has(`${targetLanguage}::${source}`));

            if (missing.length > 0) {
                const translated = await i18nApi.translateTexts({
                    texts: missing,
                    language: targetLanguage,
                    sourceLanguage: 'auto',
                });

                Object.entries(translated).forEach(([source, value]) => {
                    cacheRef.current.set(`${targetLanguage}::${source}`, String(value || source));
                });
            }
        };

        const resolveTranslation = (entry, targetLanguage) => {
            const normalizedSource = normalizeText(entry.sourceText);
            if (!normalizedSource) {
                return entry.sourceText;
            }

            if (targetLanguage === 'en' && entry.capturedLanguage === 'en') {
                return entry.sourceText;
            }

            const cached = cacheRef.current.get(`${targetLanguage}::${normalizedSource}`) || normalizedSource;
            return preserveEdgeWhitespace(entry.sourceText, cached);
        };

        const processDom = async () => {
            const activeRunId = ++runIdRef.current;
            const root = document.body;
            if (!root) {
                return;
            }

            const textBindings = [];
            const attributeBindings = [];
            const sourceTexts = [];

            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let currentNode = walker.nextNode();

            while (currentNode) {
                const parentElement = currentNode.parentElement;
                if (!shouldSkipElement(parentElement)) {
                    const entry = updateTextEntry(currentNode);
                    if (shouldTranslate(entry.sourceText)) {
                        textBindings.push({ node: currentNode, entry });
                        if (!(language === 'en' && entry.capturedLanguage === 'en')) {
                            sourceTexts.push(entry.sourceText);
                        }
                    }
                }
                currentNode = walker.nextNode();
            }

            root.querySelectorAll('*').forEach((element) => {
                if (shouldSkipElement(element)) {
                    return;
                }

                getAttributeNames(element).forEach((attributeName) => {
                    if (!element.hasAttribute(attributeName)) {
                        return;
                    }

                    const entry = updateAttributeEntry(element, attributeName);
                    if (!shouldTranslate(entry.sourceText)) {
                        return;
                    }

                    attributeBindings.push({ element, attributeName, entry });
                    if (!(language === 'en' && entry.capturedLanguage === 'en')) {
                        sourceTexts.push(entry.sourceText);
                    }
                });
            });

            const titleEntry = updateTitleEntry();
            const shouldTranslateTitle = shouldTranslate(titleEntry?.sourceText || '');
            if (shouldTranslateTitle && !(language === 'en' && titleEntry.capturedLanguage === 'en')) {
                sourceTexts.push(titleEntry.sourceText);
            }

            await translateSources(language, sourceTexts);

            if (activeRunId !== runIdRef.current) {
                return;
            }

            applyingRef.current = true;

            try {
                textBindings.forEach(({ node, entry }) => {
                    if (!node.isConnected) return;
                    const nextValue = resolveTranslation(entry, language);
                    if (String(node.nodeValue || '') !== nextValue) {
                        node.nodeValue = nextValue;
                    }
                    entry.lastAppliedValue = nextValue;
                });

                attributeBindings.forEach(({ element, attributeName, entry }) => {
                    if (!element.isConnected) return;
                    const nextValue = resolveTranslation(entry, language);
                    if (String(element.getAttribute(attributeName) || '') !== nextValue) {
                        element.setAttribute(attributeName, nextValue);
                    }
                    entry.lastAppliedValue = nextValue;
                });

                if (shouldTranslateTitle) {
                    const nextTitle = resolveTranslation(titleEntry, language);
                    if (document.title !== nextTitle) {
                        document.title = nextTitle;
                    }
                    titleEntry.lastAppliedValue = nextTitle;
                }
            } finally {
                applyingRef.current = false;
            }
        };

        const scheduleProcess = () => {
            if (scheduledRef.current) {
                window.clearTimeout(scheduledRef.current);
            }

            scheduledRef.current = window.setTimeout(() => {
                scheduledRef.current = 0;
                void processDom();
            }, 80);
        };

        const observer = new MutationObserver(() => {
            if (applyingRef.current) {
                return;
            }
            scheduleProcess();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ATTRIBUTE_NAMES,
        });

        scheduleProcess();

        return () => {
            runIdRef.current += 1;
            observer.disconnect();
            if (scheduledRef.current) {
                window.clearTimeout(scheduledRef.current);
                scheduledRef.current = 0;
            }
        };
    }, [language]);

    return null;
}
