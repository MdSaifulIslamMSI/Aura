import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertRouteA11yContracts } from './a11yContracts';

// Note: isDevelopment is captured at module load (import.meta.env.DEV); vitest runs
// with DEV=true, so only the development-mode branch is observable here.
describe('assertRouteA11yContracts (development mode)', () => {
    let warnSpy;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        document.body.innerHTML = '';
    });

    afterEach(() => {
        warnSpy.mockRestore();
        document.body.innerHTML = '';
    });

    const mount = ({ mains = 0, headings = 0 } = {}) => {
        for (let i = 0; i < mains; i += 1) document.body.appendChild(document.createElement('main'));
        for (let i = 0; i < headings; i += 1) document.body.appendChild(document.createElement('h1'));
    };

    it('does not warn when exactly one main and at least one h1 exist', () => {
        mount({ mains: 1, headings: 1 });
        assertRouteA11yContracts('/home');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('warns when the main landmark is missing', () => {
        mount({ mains: 0, headings: 1 });
        assertRouteA11yContracts('/broken');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('/broken');
        expect(warnSpy.mock.calls[0][0]).toContain('main=0');
        expect(warnSpy.mock.calls[0][0]).toContain('h1=1');
    });

    it('warns when multiple main landmarks exist', () => {
        mount({ mains: 2, headings: 1 });
        assertRouteA11yContracts('/duplicated');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('main=2');
    });

    it('warns when no h1 heading exists', () => {
        mount({ mains: 1, headings: 0 });
        assertRouteA11yContracts('/no-heading');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain('h1=0');
    });
});
