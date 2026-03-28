import { useEffect, useRef } from 'react';
import { useMarket } from '@/context/MarketContext';
import {
    getCachedRuntimeTranslation,
    normalizeRuntimeTranslationText,
    preserveRuntimeTranslationWhitespace,
    requestRuntimeTranslations,
    shouldTranslateRuntimeText,
} from '@/services/runtimeTranslation';

const BLOCKED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE']);
const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'aria-description', 'alt'];
const OBSERVED_ATTRIBUTE_NAMES = [...new Set([...ATTRIBUTE_NAMES, 'value'])];
const INPUT_VALUE_TYPES = new Set(['button', 'submit', 'reset']);

const createEntry = (value, language) => ({
    sourceText: String(value || ''),
    capturedLanguage: String(language || 'en'),
    lastAppliedValue: String(value || ''),
});

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
    const market = useMarket();
    const language = market?.languageCode || market?.language || market?.languageConfig?.code || 'en';
    const textEntriesRef = useRef(new WeakMap());
    const attributeEntriesRef = useRef(new WeakMap());
    const titleEntryRef = useRef(null);
    const applyingRef = useRef(false);
    const scheduledRef = useRef(0);
    const runIdRef = useRef(0);

    useEffect(() => {
        if (typeof document === 'undefined') {
            return undefined;
        }

        let pendingFullScan = true;
        const pendingRoots = new Set();

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

        const collectSourceText = (entry, sourceTexts) => {
            if (!entry || language === 'en' || !shouldTranslateRuntimeText(entry.sourceText)) {
                return;
            }

            sourceTexts.push(entry.sourceText);
        };

        const collectBindingsFromRoot = (root, textBindings, attributeBindings, sourceTexts) => {
            if (!root) {
                return;
            }

            const stack = [root];

            while (stack.length > 0) {
                const currentNode = stack.pop();
                if (!currentNode) {
                    continue;
                }

                if (currentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                    const fragmentChildren = currentNode.childNodes || [];
                    for (let index = fragmentChildren.length - 1; index >= 0; index -= 1) {
                        stack.push(fragmentChildren[index]);
                    }
                    continue;
                }

                if (currentNode.nodeType === Node.TEXT_NODE) {
                    if (!currentNode.isConnected) {
                        continue;
                    }

                    const parentElement = currentNode.parentElement;
                    if (shouldSkipElement(parentElement)) {
                        continue;
                    }

                    const entry = updateTextEntry(currentNode);
                    if (!shouldTranslateRuntimeText(entry.sourceText)) {
                        continue;
                    }

                    textBindings.push({ node: currentNode, entry });
                    collectSourceText(entry, sourceTexts);
                    continue;
                }

                if (currentNode.nodeType !== Node.ELEMENT_NODE || !currentNode.isConnected) {
                    continue;
                }

                if (shouldSkipElement(currentNode)) {
                    continue;
                }

                getAttributeNames(currentNode).forEach((attributeName) => {
                    if (!currentNode.hasAttribute(attributeName)) {
                        return;
                    }

                    const entry = updateAttributeEntry(currentNode, attributeName);
                    if (!shouldTranslateRuntimeText(entry.sourceText)) {
                        return;
                    }

                    attributeBindings.push({ element: currentNode, attributeName, entry });
                    collectSourceText(entry, sourceTexts);
                });

                const childNodes = currentNode.childNodes || [];
                for (let index = childNodes.length - 1; index >= 0; index -= 1) {
                    stack.push(childNodes[index]);
                }
            }
        };

        const translateSources = async (targetLanguage, sources) => {
            const uniqueSources = [...new Set(
                sources
                    .map(normalizeRuntimeTranslationText)
                    .filter(Boolean)
            )];

            if (uniqueSources.length === 0 || targetLanguage === 'en') {
                return;
            }

            await requestRuntimeTranslations({
                texts: uniqueSources,
                language: targetLanguage,
                sourceLanguage: 'auto',
            });
        };

        const resolveTranslation = (entry, targetLanguage) => {
            const normalizedSource = normalizeRuntimeTranslationText(entry.sourceText);
            if (!normalizedSource) {
                return entry.sourceText;
            }

            if (targetLanguage === 'en') {
                return entry.sourceText;
            }

            const cachedTranslation = getCachedRuntimeTranslation({
                language: targetLanguage,
                text: normalizedSource,
            }) || normalizedSource;

            return preserveRuntimeTranslationWhitespace(entry.sourceText, cachedTranslation);
        };

        const processDom = async () => {
            const activeRunId = ++runIdRef.current;
            const root = document.body;
            if (!root) {
                return;
            }

            const rootsToProcess = pendingFullScan ? [root] : [...pendingRoots];
            pendingFullScan = false;
            pendingRoots.clear();

            const textBindings = [];
            const attributeBindings = [];
            const sourceTexts = [];

            rootsToProcess.forEach((rootNode) => {
                collectBindingsFromRoot(rootNode, textBindings, attributeBindings, sourceTexts);
            });

            const titleEntry = updateTitleEntry();
            const shouldTranslateTitle = shouldTranslateRuntimeText(titleEntry?.sourceText || '');
            if (shouldTranslateTitle) {
                collectSourceText(titleEntry, sourceTexts);
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

        const queueRoot = (node) => {
            if (!node) {
                return;
            }

            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                const fragmentChildren = node.childNodes || [];
                for (let index = 0; index < fragmentChildren.length; index += 1) {
                    queueRoot(fragmentChildren[index]);
                }
                return;
            }

            pendingRoots.add(node);
        };

        const observer = new MutationObserver((mutations) => {
            if (applyingRef.current) {
                return;
            }

            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData') {
                    queueRoot(mutation.target);
                    return;
                }

                if (mutation.type === 'attributes') {
                    queueRoot(mutation.target);
                    return;
                }

                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        queueRoot(node);
                    });
                }
            });

            if (pendingFullScan || pendingRoots.size > 0) {
                scheduleProcess();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTE_NAMES,
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
