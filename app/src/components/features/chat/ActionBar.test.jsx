import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionBar from './ActionBar';

describe('ActionBar', () => {
    it('renders no more than three visible actions and keeps the primary first', () => {
        const onAction = vi.fn();

        render(
            <ActionBar
                primaryAction={{ id: 'primary', label: 'Checkout' }}
                secondaryActions={[
                    { id: 'one', label: 'Edit cart' },
                    { id: 'two', label: 'Continue shopping' },
                    { id: 'three', label: 'Extra action' },
                ]}
                onAction={onAction}
            />
        );

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(3);
        expect(buttons[0]).toHaveTextContent('Checkout');
        expect(buttons[0]).toHaveAttribute('data-tone', 'primary');

        fireEvent.click(buttons[0]);
        expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'primary' }));
    });
});
