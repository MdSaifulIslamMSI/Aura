import {
    Children,
    cloneElement,
    isValidElement,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDismissableLayer } from '@/hooks/useDismissableLayer';

const getOptionNodes = (children) => Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === 'option')
    .map((child, index) => ({
        key: child.key ?? `${child.props.value ?? 'option'}-${index}`,
        rawValue: child.props.value,
        value: String(child.props.value ?? ''),
        label: child.props.children,
        disabled: Boolean(child.props.disabled),
    }));

const buildSyntheticEvent = (value, name) => ({
    target: { value, name },
    currentTarget: { value, name },
});

export default function PremiumSelect({
    children,
    className,
    value,
    defaultValue,
    onChange,
    onValueChange,
    disabled = false,
    name,
    id,
    ...props
}) {
    const optionNodes = useMemo(() => getOptionNodes(children), [children]);
    const generatedId = useId();
    const selectId = id || `premium-select-${generatedId}`;
    const buttonRef = useRef(null);
    const menuRef = useRef(null);
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState(null);
    const [internalValue, setInternalValue] = useState(defaultValue ?? optionNodes[0]?.rawValue ?? '');
    const controlled = value !== undefined;
    const selectedValue = controlled ? value : internalValue;
    const selectedOption = optionNodes.find((option) => option.value === String(selectedValue ?? '')) || optionNodes[0] || null;
    const [highlightedValue, setHighlightedValue] = useState(() => String(selectedOption?.rawValue ?? ''));

    useEffect(() => {
        setHighlightedValue(String(selectedOption?.rawValue ?? ''));
    }, [selectedOption?.rawValue]);

    const closeMenu = useCallback(() => setOpen(false), []);

    const updatePosition = useCallback(() => {
        if (!buttonRef.current) return;
        const rect = buttonRef.current.getBoundingClientRect();
        const availableHeight = Math.max(window.innerHeight - rect.bottom - 20, 180);
        setMenuStyle({
            top: rect.bottom + 8,
            left: rect.left,
            width: rect.width,
            maxHeight: Math.min(availableHeight, 320),
        });
    }, []);

    useDismissableLayer({
        enabled: open,
        refs: [buttonRef, menuRef],
        onDismiss: closeMenu,
    });

    useEffect(() => {
        if (!open) return undefined;

        updatePosition();

        const handleScrollOrResize = () => updatePosition();

        window.addEventListener('resize', handleScrollOrResize);
        window.addEventListener('scroll', handleScrollOrResize, true);

        return () => {
            window.removeEventListener('resize', handleScrollOrResize);
            window.removeEventListener('scroll', handleScrollOrResize, true);
        };
    }, [open, updatePosition]);

    const commitValue = useCallback((option) => {
        if (!option || option.disabled) return;
        if (!controlled) {
            setInternalValue(option.rawValue);
        }
        onChange?.(buildSyntheticEvent(option.rawValue, name));
        onValueChange?.(option.rawValue);
        closeMenu();
    }, [closeMenu, controlled, name, onChange, onValueChange]);

    const moveHighlight = useCallback((direction) => {
        if (optionNodes.length === 0) return;
        const enabled = optionNodes.filter((option) => !option.disabled);
        if (enabled.length === 0) return;

        const currentIndex = enabled.findIndex((option) => option.value === highlightedValue);
        const safeIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (safeIndex + direction + enabled.length) % enabled.length;
        setHighlightedValue(enabled[nextIndex].value);
    }, [highlightedValue, optionNodes]);

    const handleKeyDown = (event) => {
        if (disabled) return;
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                if (!open) {
                    setOpen(true);
                    updatePosition();
                } else {
                    moveHighlight(1);
                }
                break;
            case 'ArrowUp':
                event.preventDefault();
                if (!open) {
                    setOpen(true);
                    updatePosition();
                } else {
                    moveHighlight(-1);
                }
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                if (!open) {
                    setOpen(true);
                    updatePosition();
                    break;
                }
                commitValue(optionNodes.find((option) => option.value === highlightedValue) || selectedOption);
                break;
            case 'Escape':
                if (open) {
                    event.preventDefault();
                    closeMenu();
                }
                break;
            default:
                break;
        }
    };

    return (
        <>
            <button
                {...props}
                id={selectId}
                ref={buttonRef}
                type="button"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={cn(
                    'premium-select-trigger relative flex w-full items-center justify-between gap-3 text-left',
                    className
                )}
                onClick={() => {
                    if (disabled) return;
                    setOpen((prev) => !prev);
                    if (!open) updatePosition();
                }}
                onKeyDown={handleKeyDown}
            >
                <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? ''}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-200', open && 'rotate-180')} />
            </button>

            {name ? <input type="hidden" name={name} value={selectedOption?.value ?? ''} /> : null}

            {open && menuStyle
                ? createPortal(
                    <div
                        ref={menuRef}
                        className="premium-select-menu"
                        style={{
                            top: menuStyle.top,
                            left: menuStyle.left,
                            width: menuStyle.width,
                            maxHeight: menuStyle.maxHeight,
                        }}
                    >
                        {optionNodes.map((option) => {
                            const active = option.value === String(selectedOption?.rawValue ?? '');
                            const highlighted = option.value === highlightedValue;

                            return (
                                <button
                                    key={option.key}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    disabled={option.disabled}
                                    className={cn(
                                        'premium-select-option',
                                        active && 'premium-select-option-active',
                                        highlighted && 'premium-select-option-highlighted'
                                    )}
                                    onMouseEnter={() => setHighlightedValue(option.value)}
                                    onClick={() => commitValue(option)}
                                >
                                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                    <Check className={cn('premium-select-option-check h-4 w-4 shrink-0', active && 'opacity-100')} />
                                </button>
                            );
                        })}
                    </div>,
                    document.body
                )
                : null}
        </>
    );
}
