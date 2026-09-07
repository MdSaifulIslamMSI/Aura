import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRazorpayScript } from './razorpay';

describe('loadRazorpayScript', () => {
  afterEach(() => {
    document.querySelectorAll('#razorpay-checkout-script, script[src="https://checkout.razorpay.com/v1/checkout.js"]').forEach((node) => node.remove());
    delete window.Razorpay;
    vi.restoreAllMocks();
  });

  it('resolves immediately when Razorpay is already present', async () => {
    window.Razorpay = vi.fn();
    await expect(loadRazorpayScript()).resolves.toBe(true);
    expect(document.getElementById('razorpay-checkout-script')).toBeNull();
  });

  it('rejects when window is unavailable', async () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error simulate SSR
    delete globalThis.window;
    try {
      await expect(loadRazorpayScript()).rejects.toThrow('Window is not available');
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it('injects the checkout script and resolves on load', async () => {
    const promise = loadRazorpayScript();
    const script = document.getElementById('razorpay-checkout-script');
    expect(script).not.toBeNull();
    expect(script.src).toBe('https://checkout.razorpay.com/v1/checkout.js');
    expect(script.async).toBe(true);
    script.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBe(true);
  });

  it('rejects when the injected script fails', async () => {
    const promise = loadRazorpayScript();
    const script = document.getElementById('razorpay-checkout-script');
    script.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toThrow('Failed to load Razorpay script');
  });

  it('attaches to an existing script element instead of injecting', async () => {
    const existing = document.createElement('script');
    existing.id = 'razorpay-checkout-script';
    document.body.appendChild(existing);

    const promise = loadRazorpayScript();
    expect(document.querySelectorAll('#razorpay-checkout-script')).toHaveLength(1);
    existing.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBe(true);
  });

  it('rejects via existing script error path', async () => {
    const existing = document.createElement('script');
    existing.id = 'razorpay-checkout-script';
    document.body.appendChild(existing);

    const promise = loadRazorpayScript();
    existing.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toThrow('Failed to load Razorpay script');
  });
});
