import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProductCardInline from './ProductCardInline';

const product = {
    id: '101',
    title: 'Aura Focus Phone',
    brand: 'Aura',
    price: 54999,
    originalPrice: 59999,
    image: '/phone.png',
    rating: 4.5,
};

describe('ProductCardInline', () => {
    it('shows a single select action in explore mode', () => {
        const onSelect = vi.fn();

        render(
            <ProductCardInline
                product={product}
                mode="explore"
                onSelect={onSelect}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /select/i }));

        expect(onSelect).toHaveBeenCalledWith('101');
        expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /view details/i })).not.toBeInTheDocument();
    });

    it('shows add-to-cart and detail actions in product mode', () => {
        const onAddToCart = vi.fn();
        const onViewDetails = vi.fn();

        render(
            <ProductCardInline
                product={product}
                mode="product"
                onAddToCart={onAddToCart}
                onViewDetails={onViewDetails}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));
        fireEvent.click(screen.getByRole('button', { name: /view details/i }));

        expect(onAddToCart).toHaveBeenCalledWith('101');
        expect(onViewDetails).toHaveBeenCalledWith('101');
    });
});
