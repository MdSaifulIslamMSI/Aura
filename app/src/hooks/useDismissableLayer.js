import { useEffect } from 'react';

const toArray = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean);

const targetWithinRefs = (target, refs = []) => toArray(refs).some((ref) => {
    const node = ref?.current;
    return Boolean(node && target && (node === target || node.contains(target)));
});

const targetMatchesSelectors = (target, selectors = []) => {
    if (!target || typeof target.closest !== 'function') {
        return false;
    }
    return toArray(selectors).some((selector) => target.closest(selector));
};

export const useDismissableLayer = ({
    enabled = true,
    refs = [],
    onDismiss,
    onEscape,
    ignoreSelectors = [],
} = {}) => {
    useEffect(() => {
        if (!enabled || typeof document === 'undefined') {
            return undefined;
        }

        const handlePointerDown = (event) => {
            const target = event?.target;
            if (targetWithinRefs(target, refs) || targetMatchesSelectors(target, ignoreSelectors)) {
                return;
            }
            onDismiss?.(event);
        };

        const handleKeyDown = (event) => {
            if (event.key !== 'Escape') {
                return;
            }

            if (typeof onEscape === 'function') {
                onEscape(event);
                return;
            }

            onDismiss?.(event);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [enabled, ignoreSelectors, onDismiss, onEscape, refs]);
};

export default useDismissableLayer;
