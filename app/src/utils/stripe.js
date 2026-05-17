let stripeScriptPromise = null;

const assignStyle = (node, cssText = '') => {
    node.style.cssText = cssText;
    return node;
};

const createElement = (tagName, {
    text = '',
    cssText = '',
    attributes = {},
} = {}) => {
    const node = assignStyle(document.createElement(tagName), cssText);
    if (text) {
        node.textContent = text;
    }
    Object.entries(attributes).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            node.setAttribute(key, String(value));
        }
    });
    return node;
};

export const createStripePaymentModal = ({
    title = 'Secure payment',
    submitLabel = 'Submit',
    cancelLabel = 'Cancel',
    overlayStyle = 'position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.72);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;',
    formStyle = 'width:min(480px,100%);border:1px solid rgba(148,163,184,0.3);border-radius:18px;background:#ffffff;box-shadow:0 24px 80px rgba(15,23,42,0.34);padding:24px;',
    titleStyle = 'margin:6px 0 0;color:#0f172a;font-size:20px;font-weight:900;',
    cancelButtonStyle = 'border:0;background:#f1f5f9;border-radius:999px;width:34px;height:34px;color:#334155;font-size:20px;line-height:1;cursor:pointer;',
    secondaryCancelButtonStyle = 'border:1px solid #cbd5e1;background:#fff;border-radius:12px;padding:10px 14px;color:#334155;font-size:13px;font-weight:800;cursor:pointer;',
    submitButtonStyle = 'border:0;background:#4f46e5;border-radius:12px;padding:10px 14px;color:#fff;font-size:13px;font-weight:900;cursor:pointer;',
    closeButtonText = 'x',
    showSecondaryCancel = true,
} = {}) => {
    const overlay = createElement('div', {
        attributes: {
            role: 'dialog',
            'aria-modal': 'true',
        },
        cssText: overlayStyle,
    });
    const form = createElement('form', { cssText: formStyle });
    const header = createElement('div', {
        cssText: 'display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;',
    });
    const headingGroup = createElement('div');
    const eyebrow = createElement('p', {
        text: 'Stripe',
        cssText: 'margin:0;color:#64748b;font-size:11px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;',
    });
    const heading = createElement('h2', {
        text: title,
        cssText: titleStyle,
    });
    const closeButton = createElement('button', {
        text: closeButtonText,
        cssText: cancelButtonStyle,
        attributes: {
            type: 'button',
            'data-stripe-cancel': '',
            'aria-label': cancelLabel,
        },
    });
    const elementContainer = createElement('div', { cssText: 'margin:0 0 14px;' });
    const errorNode = createElement('p', {
        cssText: 'display:none;margin:0 0 12px;color:#be123c;font-size:13px;font-weight:700;',
    });
    const actions = createElement('div', {
        cssText: 'display:flex;gap:10px;justify-content:flex-end;',
    });
    const submitButton = createElement('button', {
        text: submitLabel,
        cssText: submitButtonStyle,
        attributes: { type: 'submit' },
    });
    const cancelButtons = [closeButton];

    headingGroup.append(eyebrow, heading);
    header.append(headingGroup, closeButton);
    if (showSecondaryCancel) {
        const cancelButton = createElement('button', {
            text: cancelLabel,
            cssText: secondaryCancelButtonStyle,
            attributes: {
                type: 'button',
                'data-stripe-cancel': '',
            },
        });
        cancelButtons.push(cancelButton);
        actions.append(cancelButton);
    }
    actions.append(submitButton);
    form.append(header, elementContainer, errorNode, actions);
    overlay.append(form);

    return {
        overlay,
        form,
        elementContainer,
        errorNode,
        submitButton,
        cancelButtons,
    };
};

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
    const {
        overlay,
        form,
        elementContainer,
        errorNode,
        submitButton,
        cancelButtons,
    } = createStripePaymentModal({
        title,
        submitLabel,
        cancelLabel,
        closeButtonText: 'x',
    });
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
    paymentElement.mount(elementContainer);

    return new Promise((resolve, reject) => {
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

        cancelButtons.forEach((button) => {
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
