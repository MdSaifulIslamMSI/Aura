import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeId } from './runtimeId';

describe('createRuntimeId', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the crypto.randomUUID path with the given prefix', () => {
        const id = createRuntimeId('widget');
        expect(id).toMatch(/^widget-\d+-[0-9a-f-]{36}$/);
    });

    it('falls back to the default "id" prefix', () => {
        expect(createRuntimeId()).toMatch(/^id-\d+-[0-9a-f-]{36}$/);
    });

    it('generates unique ids across calls', () => {
        const ids = new Set(Array.from({ length: 25 }, () => createRuntimeId()));
        expect(ids.size).toBe(25);
    });

    it('uses the getRandomValues path with 24 hex characters of entropy', () => {
        vi.stubGlobal('crypto', {
            getRandomValues: (bytes) => {
                bytes.fill(0xab);
                return bytes;
            },
        });

        const id = createRuntimeId('op');
        expect(id).toMatch(/^op-\d+-[0-9a-f]{24}$/);
    });

    it('degrades to a timestamp + counter entropy when crypto is unavailable', () => {
        vi.stubGlobal('crypto', undefined);

        const first = createRuntimeId('x');
        const second = createRuntimeId('x');
        expect(first).toMatch(/^x-\d+-[a-z0-9]+-[a-z0-9]+$/);
        expect(second).not.toBe(first);
    });
});
