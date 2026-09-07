import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStripePaymentModal, loadStripeScript, openStripeSetupModal } from './stripe';

describe('createStripePaymentModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('builds an accessible dialog with title and actions', () => {
    const { overlay, form, submitButton, cancelButtons } = createStripePaymentModal({
      title: 'Pay securely',
      submitLabel: 'Pay now',
      cancelLabel: 'Go back',
    });

    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(overlay.querySelector('h2').textContent).toBe('Pay securely');
    expect(submitButton.textContent).toBe('Pay now');
    expect(submitButton.type).toBe('submit');
    expect(cancelButtons).toHaveLength(2);
    expect(form.contains(submitButton)).toBe(true);
  });

  it('omits the secondary cancel button when disabled', () => {
    const { cancelButtons, form } = createStripePaymentModal({ showSecondaryCancel: false });
    expect(cancelButtons).toHaveLength(1);
    expect(form.querySelectorAll('[data-stripe-cancel]')).toHaveLength(1);
  });

  it('exposes mount points for the payment element and errors', () => {
    const { elementContainer, errorNode } = createStripePaymentModal();
    expect(elementContainer).toBeInstanceOf(HTMLDivElement);
    expect(errorNode.style.display).toBe('none');
  });

  it('skips nullish attributes when creating nodes', () => {
    const { overlay } = createStripePaymentModal({ title: undefined });
    expect(overlay.querySelector('h2').textContent).toBe('Secure payment');
  });
});

describe('loadStripeScript', () => {
  afterEach(() => {
    document.querySelectorAll('script[src="https://js.stripe.com/v3/"]').forEach((node) => node.remove());
    delete window.Stripe;
    vi.restoreAllMocks();
  });

  it('resolves immediately when Stripe is already loaded', async () => {
    const stripe = { elements: vi.fn() };
    window.Stripe = stripe;
    await expect(loadStripeScript()).resolves.toBe(stripe);
  });
});

describe('openStripeSetupModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('script[src="https://js.stripe.com/v3/"]').forEach((node) => node.remove());
    delete window.Stripe;
    vi.restoreAllMocks();
  });

  it('throws when publishable key or client secret is missing', async () => {
    await expect(openStripeSetupModal({})).rejects.toThrow(
      'Stripe setup is missing a publishable key or client secret'
    );
    await expect(openStripeSetupModal({ publishableKey: 'pk_1' })).rejects.toThrow(
      'Stripe setup is missing a publishable key or client secret'
    );
  });

  it('resolves the setup intent on successful confirmation', async () => {
    const setupIntent = { status: 'succeeded', id: 'seti_123' };
    const paymentElement = { mount: vi.fn(), unmount: vi.fn() };
    const stripe = {
      elements: vi.fn(() => ({ create: vi.fn(() => paymentElement) })),
      confirmSetup: vi.fn(async () => ({ setupIntent })),
    };
    window.Stripe = vi.fn(() => stripe);

    const promise = openStripeSetupModal({ publishableKey: 'pk_1', clientSecret: 'cs_1' });
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).not.toBeNull());
    document.body.querySelector('form').dispatchEvent(
      new SubmitEvent('submit', { bubbles: true, cancelable: true })
    );
    await expect(promise).resolves.toBe(setupIntent);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(paymentElement.mount).toHaveBeenCalledOnce();
  });

  it('rejects when the user cancels the modal', async () => {
    const paymentElement = { mount: vi.fn(), unmount: vi.fn() };
    window.Stripe = vi.fn(() => ({
      elements: () => ({ create: () => paymentElement }),
      confirmSetup: vi.fn(),
    }));

    const promise = openStripeSetupModal({ publishableKey: 'pk_1', clientSecret: 'cs_1' });
    await vi.waitFor(() => expect(document.body.querySelector('[data-stripe-cancel]')).not.toBeNull());
    document.body.querySelector('[data-stripe-cancel]').click();
    await expect(promise).rejects.toThrow('Card setup was cancelled');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows an inline error and keeps the modal open on confirmation failure', async () => {
    const paymentElement = { mount: vi.fn(), unmount: vi.fn() };
    window.Stripe = vi.fn(() => ({
      elements: () => ({ create: () => paymentElement }),
      confirmSetup: vi.fn(async () => ({ error: { message: 'Card declined' } })),
    }));

    const promise = openStripeSetupModal({ publishableKey: 'pk_1', clientSecret: 'cs_1' });
    await vi.waitFor(() => expect(document.body.querySelector('form')).not.toBeNull());
    const form = document.body.querySelector('form');
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      const errorText = [...form.querySelectorAll('p')].find((node) => node.textContent === 'Card declined');
      expect(errorText).not.toBeUndefined();
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    // Cleanup: cancel so the pending promise settles and timers do not leak.
    document.body.querySelector('[data-stripe-cancel]').click();
    await expect(promise).rejects.toThrow('Card setup was cancelled');
  });
});
