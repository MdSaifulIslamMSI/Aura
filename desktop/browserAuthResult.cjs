const DESKTOP_BROWSER_SIGN_IN_CANCELLED_CODE = 'auth/desktop-browser-sign-in-cancelled';

const formatDesktopAuthResultForRenderer = (result = null) => {
    if (result?.cancelled) {
        return {
            success: false,
            cancelled: true,
            code: DESKTOP_BROWSER_SIGN_IN_CANCELLED_CODE,
            requestId: result.requestId,
            cancelledAt: result.cancelledAt,
            message: 'Desktop browser sign-in was cancelled.',
        };
    }

    if (!result?.customToken) {
        return {
            success: false,
            message: 'Desktop browser sign-in is not ready or has expired.',
        };
    }

    return {
        success: true,
        requestId: result.requestId,
        customToken: result.customToken,
        completedAt: result.completedAt,
    };
};

module.exports = {
    DESKTOP_BROWSER_SIGN_IN_CANCELLED_CODE,
    formatDesktopAuthResultForRenderer,
};
