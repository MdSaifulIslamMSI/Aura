let stripeScriptPromise = null;

const escapeModalText = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}[char]));

export const loadStripeScript = () => {
    if (window.Stripe) return Promise.resolve(window.Stripe);

    if (!stripeScriptPromise) {
        stripeScriptPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
            if (existing) {
                existing.addEventListener('load', () => resolve(window.Stripe), { once: true });
                existing.addEventListener('error', () => reject(new Error('Unable to load Stripe checkout')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://js.stripe.com/v3/';
            script.async = true;
            script.onload = () => resolve(window.Stripe);
            script.onerror = () => reject(new Error('Unable to load Stripe checkout'));
            document.body.appendChild(script);
        });
    }

    return stripeScriptPromise;
};

export const openStripeSetupModal = async ({
    publishableKey,
    clientSecret,
    title = 'Add card',
    submitLabel = 'Save card',
    cancelLabel = 'Cancel',
} = {}) => {
    if (!publishableKey || !clientSecret) {
        throw new Error('Stripe setup is missing a publishable key or client secret');
    }

    const StripeConstructor = await loadStripeScript();
    const stripe = StripeConstructor(publishableKey);
    const elementId = `stripe-setup-payment-element-${Date.now()}`;
    const errorId = `${elementId}-error`;

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.72);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
        <form style="width:min(480px,100%);border:1px solid rgba(148,163,184,0.3);border-radius:18px;background:#ffffff;box-shadow:0 24px 80px rgba(15,23,42,0.34);padding:24px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;">
                <div>
                    <p style="margin:0;color:#64748b;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;">Stripe</p>
                    <h2 style="margin:6px 0 0;color:#0f172a;font-size:20px;font-weight:900;">${escapeModalText(title)}</h2>
                </div>
                <button type="button" data-stripe-cancel style="border:0;background:#f1f5f9;border-radius:999px;width:34px;height:34px;color:#334155;font-size:20px;line-height:1;cursor:pointer;">&times;</button>
            </div>
            <div id="${elementId}" style="margin:0 0 14px;"></div>
            <p id="${errorId}" style="display:none;margin:0 0 12px;color:#be123c;font-size:13px;font-weight:700;"></p>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button type="button" data-stripe-cancel style="border:1px solid #cbd5e1;background:#fff;border-radius:12px;padding:10px 14px;color:#334155;font-size:13px;font-weight:800;cursor:pointer;">${escapeModalText(cancelLabel)}</button>
                <button type="submit" style="border:0;background:#4f46e5;border-radius:12px;padding:10px 14px;color:#fff;font-size:13px;font-weight:900;cursor:pointer;">${escapeModalText(submitLabel)}</button>
            </div>
        </form>
    `;

    document.body.appendChild(overlay);

    const elements = stripe.elements({
        clientSecret,
        appearance: {
            theme: 'stripe',
            variables: {
                colorPrimary: '#4f46e5',
                borderRadius: '10px',
            },
        },
    });
    const paymentElement = elements.create('payment', {
        layout: {
            type: 'tabs',
            defaultCollapsed: false,
        },
    });
    paymentElement.mount(`#${elementId}`);

    return new Promise((resolve, reject) => {
        const form = overlay.querySelector('form');
        const submitButton = overlay.querySelector('button[type="submit"]');
        const errorNode = overlay.querySelector(`#${errorId}`);

        const cleanup = () => {
            try {
                paymentElement.unmount();
            } catch {
                // Element may already be gone if Stripe handled a redirect.
            }
            overlay.remove();
        };

        const showError = (message) => {
            errorNode.textContent = message;
            errorNode.style.display = 'block';
        };

        overlay.querySelectorAll('[data-stripe-cancel]').forEach((button) => {
            button.addEventListener('click', () => {
                cleanup();
                reject(new Error('Card setup was cancelled'));
            }, { once: true });
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            submitButton.disabled = true;
            submitButton.textContent = 'Saving...';
            errorNode.style.display = 'none';

            try {
                const { error, setupIntent } = await stripe.confirmSetup({
                    elements,
                    redirect: 'if_required',
                    confirmParams: {
                        return_url: window.location.href,
                    },
                });

                if (error) {
                    throw new Error(error.message || 'Card setup failed');
                }
                if (!setupIntent || setupIntent.status !== 'succeeded') {
                    throw new Error('Card setup needs more action before it can be saved');
                }

                cleanup();
                resolve(setupIntent);
            } catch (error) {
                showError(error.message || 'Card setup failed');
                submitButton.disabled = false;
                submitButton.textContent = submitLabel;
            }
        });
    });
};
