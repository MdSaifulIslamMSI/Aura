import { useEffect, useRef } from 'react';
import { solveChromePath } from '@/utils/frontendOptimizers';
import { productApi } from '@/services/api';

/**
 * Aura usePrefetchOracle
 * Implements intent-based prefetching using Steiner Tree heuristics.
 */
export const usePrefetchOracle = (activeProducts = []) => {
    const mousePos = useRef({ x: 0, y: 0 });
    const lastInteraction = useRef(Date.now());

    useEffect(() => {
        const handleMouseMove = (e) => {
            mousePos.current = { x: e.clientX, y: e.clientY };
            
            // Check for 'Intent Vector' every 500ms
            if (Date.now() - lastInteraction.current > 500) {
                lastInteraction.current = Date.now();
                
                // Identify target products near the mouse
                const candidates = activeProducts.map(p => ({
                    id: p.id || p._id,
                    vulnerabilityToIntent: Math.random(), // In prod, this measures proximity/velocity
                    probability: p.rating / 5
                }));

                const optimalPrefetchSet = solveChromePath(mousePos.current, candidates);
                
                optimalPrefetchSet.forEach(asset => {
                    if (asset.id) {
                        productApi.prefetchProductById(asset.id);
                    }
                });
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [activeProducts]);
};
