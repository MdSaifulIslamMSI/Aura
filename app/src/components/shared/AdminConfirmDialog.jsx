import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

// In-portal replacement for window.confirm/window.prompt so destructive admin
// actions stay inside the premium shell instead of dropping to native dialogs.
export default function AdminConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    busy = false,
    tone = 'danger',
    reasonLabel,
    reasonValue,
    onReasonChange,
}) {
    const confirmRef = useRef(null);
    const dialogRef = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        confirmRef.current?.focus();
        const getFocusableElements = () => (
            [...(dialogRef.current?.querySelectorAll('button, input, textarea, select') || [])]
                .filter((element) => !element.disabled)
        );
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && !busy) {
                onCancel();
                return;
            }
            if (event.key === 'Tab') {
                // Keep keyboard focus cycling inside the dialog while it is open.
                const focusable = getFocusableElements();
                if (focusable.length === 0) {
                    event.preventDefault();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, busy, onCancel]);

    if (!open || typeof document === 'undefined') return null;

    const toneClass = tone === 'danger' ? 'admin-premium-button-danger' : 'admin-premium-button-primary';

    return createPortal(
        <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) onCancel();
            }}
        >
            <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-busy={busy || undefined}
                aria-label={title}
                className="admin-premium-subpanel w-full max-w-md border-white/12 p-5 shadow-2xl"
            >
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-rose-300">
                        <AlertTriangle className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="admin-premium-text-strong text-base font-bold leading-6">{title}</h2>
                        {description ? (
                            <p className="admin-premium-text-muted mt-1.5 whitespace-pre-line text-sm leading-6">{description}</p>
                        ) : null}
                    </div>
                </div>

                {reasonLabel ? (
                    <label className="mt-4 block">
                        <span className="premium-kicker">{reasonLabel}</span>
                        <textarea
                            value={reasonValue}
                            onChange={(event) => onReasonChange?.(event.target.value)}
                            rows={2}
                            className="admin-premium-control mt-1 resize-none"
                        />
                    </label>
                ) : null}

                <div className="mt-5 flex justify-end gap-2">
                    <button type="button" onClick={onCancel} disabled={busy} className="admin-premium-button px-4 py-2 text-sm">
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        ref={confirmRef}
                        onClick={onConfirm}
                        disabled={busy}
                        className={`admin-premium-button ${toneClass} px-4 py-2 text-sm`}
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
