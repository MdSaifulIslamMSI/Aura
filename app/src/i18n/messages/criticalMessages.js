import { defineMessages } from 'react-intl';

export const criticalMessages = defineMessages({
    cart: {
        id: 'nav.cart',
        defaultMessage: 'Cart',
        description: 'Navigation label for the shopping cart.',
    },
    signIn: {
        id: 'auth.signIn',
        defaultMessage: 'Sign in',
        description: 'Primary action for signing into an Aura account.',
    },
    signInAction: {
        id: 'auth.action.signIn',
        defaultMessage: 'Sign in',
        description: 'Primary authentication action shown on sign-in CTAs.',
    },
    signUpAction: {
        id: 'auth.action.signUp',
        defaultMessage: 'Sign up',
        description: 'Primary authentication action shown on account creation CTAs.',
    },
    passwordVisible: {
        id: 'auth.security.passwordVisible',
        defaultMessage: 'Hide password',
        description: 'Accessible action when the password is currently visible.',
    },
    passwordHidden: {
        id: 'auth.security.passwordHidden',
        defaultMessage: 'Show password',
        description: 'Accessible action when the password is currently hidden.',
    },
    addToCart: {
        id: 'cart.action.addToCart',
        defaultMessage: 'Add to cart',
        description: 'Action that adds a product to the shopper cart.',
    },
    removeFromCart: {
        id: 'cart.action.removeFromCart',
        defaultMessage: 'Remove from cart',
        description: 'Action that removes a product from the shopper cart.',
    },
    cartEmpty: {
        id: 'cart.status.empty',
        defaultMessage: 'Your cart is empty',
        description: 'Empty-state title for a cart with no products.',
    },
    placeOrder: {
        id: 'checkout.action.placeOrder',
        defaultMessage: 'Place order',
        description: 'Final checkout action that submits an order.',
    },
    payNow: {
        id: 'checkout.payNow',
        defaultMessage: 'Pay now',
        description: 'Primary checkout action that starts payment.',
    },
    paymentFailed: {
        id: 'checkout.status.paymentFailed',
        defaultMessage: 'Payment failed',
        description: 'Short payment status shown when authorization or capture fails.',
    },
    paymentPending: {
        id: 'checkout.status.paymentPending',
        defaultMessage: 'Payment pending',
        description: 'Short payment status shown while payment is waiting for completion.',
    },
    paymentSuccess: {
        id: 'checkout.status.paymentSuccess',
        defaultMessage: 'Payment successful',
        description: 'Short payment status shown after payment authorization or capture succeeds.',
    },
    paymentErrorGeneric: {
        id: 'payment.error.generic',
        defaultMessage: 'Payment could not be completed. Please try again.',
        description: 'Safe generic payment error when no provider-specific message is available.',
    },
    paymentRetry: {
        id: 'payment.error.retry',
        defaultMessage: 'Retry payment',
        description: 'Action for restarting a failed or stale payment attempt.',
    },
    authPendingTitle: {
        id: 'auth.pending.title',
        defaultMessage: 'Session checkpoint',
        description: 'Short heading shown while account/session access is being checked.',
    },
    authPendingResolveSession: {
        id: 'auth.pending.resolveSession',
        defaultMessage: 'Resolving your session...',
        description: 'Loading message shown while a protected route checks the current session.',
    },
    authDeviceChallengeTitle: {
        id: 'auth.deviceChallenge.title',
        defaultMessage: 'Trusted device checkpoint',
        description: 'Heading shown when a protected route requires trusted-device approval.',
    },
    authDeviceChallengeMessage: {
        id: 'auth.deviceChallenge.message',
        defaultMessage: 'Approve this browser in the security checkpoint to continue.',
        description: 'Instruction shown when a protected route requires trusted-device approval.',
    },
    checkoutOtpCloseDialog: {
        id: 'checkout.otp.closeDialog',
        defaultMessage: 'Close OTP dialog',
        description: 'Accessible label for closing the payment OTP challenge dialog.',
    },
    checkoutOtpTitle: {
        id: 'checkout.otp.title',
        defaultMessage: 'Payment Challenge',
        description: 'Title for the payment OTP challenge modal.',
    },
    checkoutOtpSubtitle: {
        id: 'checkout.otp.subtitle',
        defaultMessage: 'Enter the 6-digit OTP sent to your registered contact.',
        description: 'Instruction text for the payment OTP challenge modal.',
    },
    checkoutOtpDigitLabel: {
        id: 'checkout.otp.digitLabel',
        defaultMessage: 'OTP digit {index, number}',
        description: 'Accessible label for an individual payment OTP digit input.',
    },
    checkoutOtpVerify: {
        id: 'checkout.otp.verify',
        defaultMessage: 'Verify OTP',
        description: 'Action button label for submitting the payment OTP challenge.',
    },
    checkoutOtpVerifying: {
        id: 'checkout.otp.verifying',
        defaultMessage: 'Verifying...',
        description: 'Busy state shown while the payment OTP challenge is being verified.',
    },
    checkoutOtpDidNotReceive: {
        id: 'checkout.otp.didNotReceive',
        defaultMessage: "Didn't receive it?",
        description: 'Prompt shown near the payment OTP challenge retry action.',
    },
    checkoutOtpCancelRetry: {
        id: 'checkout.otp.cancelRetry',
        defaultMessage: 'Cancel and retry',
        description: 'Action for cancelling the current payment OTP challenge and trying again.',
    },
    checkoutDeliveryStepTitle: {
        id: 'checkout.delivery.stepTitle',
        defaultMessage: '2. Delivery Slot',
        description: 'Checkout step heading for selecting delivery speed and slot.',
    },
    checkoutDeliveryDateLabel: {
        id: 'checkout.delivery.dateLabel',
        defaultMessage: 'Delivery Date',
        description: 'Label for the checkout delivery date input.',
    },
    checkoutDeliveryWindowLabel: {
        id: 'checkout.delivery.windowLabel',
        defaultMessage: 'Delivery Window',
        description: 'Label for the checkout delivery time-window input.',
    },
    checkoutDeliverySelectSlot: {
        id: 'checkout.delivery.selectSlot',
        defaultMessage: 'Select slot',
        description: 'Placeholder option for choosing a checkout delivery slot.',
    },
    checkoutBack: {
        id: 'checkout.action.back',
        defaultMessage: 'Back',
        description: 'Secondary checkout navigation action that returns to the previous step.',
    },
    checkoutContinue: {
        id: 'checkout.action.continue',
        defaultMessage: 'Continue',
        description: 'Primary checkout navigation action that advances to the next step.',
    },
    orderConfirmed: {
        id: 'order.status.confirmed',
        defaultMessage: 'Order confirmed',
        description: 'Order status shown after the backend has accepted the order.',
    },
    genericError: {
        id: 'errors.generic',
        defaultMessage: 'Something went wrong. Please try again.',
        description: 'Safe generic error shown when a specific recovery message is unavailable.',
    },
    itemCount: {
        id: 'common.itemCount',
        defaultMessage: '{count, plural, =0 {No items} one {# item} other {# items}}',
        description: 'Cart or order item count with plural handling.',
    },
    amountDue: {
        id: 'checkout.amountDue',
        defaultMessage: 'Amount due: {amount, number}',
        description: 'Checkout amount label using locale-aware numeric formatting.',
    },
    deliveryDate: {
        id: 'checkout.deliveryDate',
        defaultMessage: 'Delivery date: {date, date, medium}',
        description: 'Checkout delivery date label using locale-aware date formatting.',
    },
    cartA11yLabel: {
        id: 'accessibility.openCart',
        defaultMessage: 'Open cart with {count, plural, =0 {no items} one {# item} other {# items}}',
        description: 'Accessible label for opening the cart.',
    },
    hidePassword: {
        id: 'accessibility.hidePassword',
        defaultMessage: 'Hide password',
        description: 'Accessible label for hiding a password value in an authentication field.',
    },
    showPassword: {
        id: 'accessibility.showPassword',
        defaultMessage: 'Show password',
        description: 'Accessible label for revealing a password value in an authentication field.',
    },
    updatedAt: {
        id: 'status.updatedAt',
        defaultMessage: 'Updated {timestamp, time, short}',
        description: 'Status timestamp using locale-aware time formatting.',
    },
    auraPoints: {
        id: 'rewards.auraPoints',
        defaultMessage: 'Aura Points',
        description: 'Aura loyalty points brand name. Keep Aura untranslated.',
    },
});
