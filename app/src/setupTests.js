import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup();
});

// Mock URL.createObjectURL (used by some libraries)
global.URL.createObjectURL = () => 'mock-url';

// jsdom does not implement matchMedia; required by MotionModeContext.
if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

// Mock Firebase Analytics
vi.mock('firebase/analytics', () => ({
    getAnalytics: vi.fn(),
    logEvent: vi.fn(),
    isSupported: vi.fn().mockResolvedValue(false) // indexedDB not supported in test
}));
