import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminConfirmDialog from './AdminConfirmDialog';

describe('AdminConfirmDialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<AdminConfirmDialog open={false} title="Delete?" confirmLabel="Delete" cancelLabel="Cancel" onConfirm={() => {}} onCancel={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows title, description and optional reason field', () => {
        render(
            <AdminConfirmDialog
                open
                title="Delete this product?"
                description="This cannot be undone."
                reasonLabel="Reason"
                reasonValue="cleanup"
                onReasonChange={() => {}}
                confirmLabel="Delete product"
                cancelLabel="Cancel"
                onConfirm={() => {}}
                onCancel={() => {}}
            />
        );
        expect(screen.getByText('Delete this product?')).toBeInTheDocument();
        expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
        expect(screen.getByDisplayValue('cleanup')).toBeInTheDocument();
        expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('invokes confirm and cancel handlers', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(<AdminConfirmDialog open title="Sure?" confirmLabel="Confirm" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} />);
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('blocks interactions while busy', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(<AdminConfirmDialog open busy title="Sure?" confirmLabel="Confirm" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} />);
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('traps Tab focus inside the dialog', () => {
        render(
            <div>
                <button type="button">Outside</button>
                <AdminConfirmDialog open title="Sure?" confirmLabel="Confirm" cancelLabel="Cancel" onConfirm={() => {}} onCancel={() => {}} />
            </div>
        );
        const dialog = screen.getByRole('alertdialog');
        const confirmButton = screen.getByRole('button', { name: 'Confirm' });
        const cancelButton = screen.getByRole('button', { name: 'Cancel' });

        // Confirm gets initial focus; Tab from the last control wraps to the first.
        expect(confirmButton).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(cancelButton).toHaveFocus();

        // Shift+Tab from the first control wraps back to the last.
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(confirmButton).toHaveFocus();

        // Focus never reaches the element outside the dialog.
        expect(screen.getByRole('button', { name: 'Outside' })).not.toHaveFocus();
        expect(dialog.contains(document.activeElement)).toBe(true);
    });
});
