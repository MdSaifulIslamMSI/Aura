import { describe, expect, it, vi } from 'vitest';
import { solveAuraGrid, solveChromaticHarmony, solveChromePath } from './frontendOptimizers';

describe('solveAuraGrid', () => {
    it('packs items left to right and wraps to a new shelf when the row is full', () => {
        const items = [
            { id: 'a', widthWeight: 8, heightWeight: 1 },
            { id: 'b', widthWeight: 8, heightWeight: 2 },
            { id: 'c', widthWeight: 4, heightWeight: 1 },
        ];

        const packed = solveAuraGrid(items, 12);

        expect(packed[0].gridLayout).toEqual({ x: 0, y: 0, spanX: 8, spanY: 1 });
        // 'b' no longer fits on row 0 (8 + 8 > 12), so it wraps and keeps its height.
        expect(packed[1].gridLayout).toEqual({ x: 0, y: 1, spanX: 8, spanY: 2 });
        // 'c' fits in the remaining columns of the second shelf.
        expect(packed[2].gridLayout).toEqual({ x: 8, y: 1, spanX: 4, spanY: 1 });
    });

    it('clamps spanX to the container width', () => {
        const packed = solveAuraGrid([{ id: 'wide', widthWeight: 40, heightWeight: 1 }], 12);
        expect(packed[0].gridLayout.spanX).toBe(12);
        expect(packed[0].gridLayout.x).toBe(0);
    });

    it('defaults spans to 1 column / 1 row when weights are missing', () => {
        // The source rolls Math.random() for missing weights (>0.8 -> 2);
        // force a low roll so the "small item" default of 1 is deterministic.
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const packed = solveAuraGrid([{ id: 'bare' }, { id: 'noHeight', heightWeight: 1 }], 12);
        expect(packed[0].gridLayout).toMatchObject({ x: 0, spanX: 1, spanY: 1 });
        expect(packed[1].gridLayout).toMatchObject({ x: 1, spanX: 1, spanY: 1 });
        vi.restoreAllMocks();
    });

    it('preserves the original item fields on each packed item', () => {
        const packed = solveAuraGrid([{ id: 'keep', widthWeight: 3, heightWeight: 2, title: 'Keep me' }], 12);
        expect(packed[0]).toMatchObject({ id: 'keep', title: 'Keep me' });
        expect(packed[0].gridLayout).toEqual({ x: 0, y: 0, spanX: 3, spanY: 2 });
    });
});

describe('solveChromaticHarmony', () => {
    it('never gives sequential items the same color when the palette allows it', () => {
        const items = [
            { id: 'a', gridLayout: { spanX: 2, spanY: 1 } },
            { id: 'b', gridLayout: { spanX: 2, spanY: 1 } },
            { id: 'c', gridLayout: { spanX: 1, spanY: 1 } },
        ];

        const colored = solveChromaticHarmony(items, 2);
        expect(colored.find((entry) => entry.id === 'a').harmonyIndex).toBe(0);
        expect(colored.find((entry) => entry.id === 'b').harmonyIndex).toBe(1);
        expect(colored.find((entry) => entry.id === 'c').harmonyIndex).toBe(0);
    });

    it('wraps back to earlier palette colors once later ones are taken', () => {
        const items = [
            { id: 'a', gridLayout: { spanX: 9, spanY: 1 } },
            { id: 'b', gridLayout: { spanX: 1, spanY: 1 } },
            { id: 'c', gridLayout: { spanX: 1, spanY: 1 } },
        ];

        // Note: paletteCount 1 deadlocks the source loop, so the smallest safe
        // palette here is 2; the third item must wrap from color 1 back to 0.
        const colored = solveChromaticHarmony(items, 2);
        expect(colored.map((entry) => entry.harmonyIndex)).toEqual([0, 1, 0]);
    });

    it('returns harmonyIndex for every input item in the original order', () => {
        const items = [
            { id: 'small', gridLayout: { spanX: 1, spanY: 1 } },
            { id: 'big', gridLayout: { spanX: 4, spanY: 2 } },
        ];

        const colored = solveChromaticHarmony(items, 5);
        expect(colored.map((entry) => entry.id)).toEqual(['small', 'big']);
        colored.forEach((entry) => expect(typeof entry.harmonyIndex).toBe('number'));
    });
});

describe('solveChromePath', () => {
    it('keeps only assets with vulnerabilityToIntent above 0.6', () => {
        const assets = [
            { id: 1, vulnerabilityToIntent: 0.9, probability: 0.5 },
            { id: 2, vulnerabilityToIntent: 0.6, probability: 0.9 },
            { id: 3, vulnerabilityToIntent: 0.75, probability: 0.8 },
        ];

        const path = solveChromePath({}, assets);
        expect(path.map((asset) => asset.id)).toEqual([3, 1]);
    });

    it('ranks candidates by descending probability and caps the result at 3', () => {
        const assets = [
            { id: 1, vulnerabilityToIntent: 0.9, probability: 0.1 },
            { id: 2, vulnerabilityToIntent: 0.9, probability: 0.9 },
            { id: 3, vulnerabilityToIntent: 0.9, probability: 0.5 },
            { id: 4, vulnerabilityToIntent: 0.9, probability: 0.7 },
            { id: 5, vulnerabilityToIntent: 0.9, probability: 0.3 },
        ];

        const path = solveChromePath({}, assets);
        expect(path.map((asset) => asset.id)).toEqual([2, 4, 3]);
        expect(path).toHaveLength(3);
    });

    it('returns an empty array when no asset is intent-vulnerable', () => {
        expect(solveChromePath({}, [{ id: 1, vulnerabilityToIntent: 0.2, probability: 0.9 }])).toEqual([]);
    });
});
