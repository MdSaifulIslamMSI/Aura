const RAZORPAY_SCRIPT_ID = 'razorpay-checkout-script';
const RAZORPAY_CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export const loadRazorpayScript = () => new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
        reject(new Error('Window is not available'));
        return;
    }

    if (window.Razorpay) {
        resolve(true);
        return;
    }

    const existing = document.getElementById(RAZORPAY_SCRIPT_ID);
    if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load Razorpay script')), { once: true });
        return;
    }

    const script = document.createElement('script');
    script.id = RAZORPAY_SCRIPT_ID;
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error('Failed to load Razorpay script'));
    document.body.appendChild(script);
});

