// Auto-update decision logic for the desktop shell, with no Electron imports so
// it can be unit tested. main.cjs owns the electron-updater wiring and passes
// this module's answers back in.

const UPDATE_CHECK_DELAY_MS = 8000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_FOCUS_THROTTLE_MS = 30 * 60 * 1000;

// Never check from an unpackaged tree: electron-updater has no signed feed to
// compare against there, and a dev run must not install over the checkout.
const shouldStartAutoUpdateChecks = ({
    isPackaged,
    autoUpdateDisabled = false,
    alreadyStarted = false,
} = {}) => Boolean(isPackaged) && !autoUpdateDisabled && !alreadyStarted;

const shouldCheckForUpdatesOnFocus = ({
    lastCheckAt = 0,
    now = Date.now(),
    throttleMs = UPDATE_FOCUS_THROTTLE_MS,
} = {}) => (now - lastCheckAt) > throttleMs;

// Translates an updater error into something a user can act on. A raw
// ENOTFOUND/ENODATA blob is not actionable, and the most common cause is DNS
// or connectivity rather than a broken install.
const buildUpdateErrorMessage = (error) => {
    const rawMessage = String(error?.message || error || 'Update check failed.').trim();

    if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(rawMessage)) {
        return 'Aura could not resolve the GitHub update channel. Check your internet or DNS, then try again.';
    }

    return rawMessage || 'Update check failed.';
};

// One prompt per download. Repeated update-downloaded events must not stack
// dialogs on top of each other.
const shouldPromptForRestart = ({ promptAlreadyShown = false } = {}) => !promptAlreadyShown;

// Maps an electron-updater event onto the renderer payload contract. `version`
// is always present so the renderer never has to branch on shape.
const buildUpdateStatusPayload = (type, payload = {}) => {
    const normalized = { type, ...payload };
    if (type === 'available' || type === 'not-available' || type === 'downloaded') {
        normalized.version = String(normalized.version || '');
    }
    if (type === 'downloading') {
        normalized.percent = Number(normalized.percent || 0);
    }
    return normalized;
};

const buildUpdateRestartPrompt = () => ({
    type: 'info',
    buttons: ['Restart and update', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Aura Marketplace update ready',
    message: 'A new Aura Marketplace version has been downloaded.',
    detail: 'Restart the desktop app now to install the update, or choose Later to install it when you quit.',
});

// Response 0 is the default button ("Restart and update").
const shouldInstallUpdateNow = ({ response } = {}) => response === 0;

module.exports = {
    UPDATE_CHECK_DELAY_MS,
    UPDATE_CHECK_INTERVAL_MS,
    UPDATE_FOCUS_THROTTLE_MS,
    buildUpdateErrorMessage,
    buildUpdateRestartPrompt,
    buildUpdateStatusPayload,
    shouldCheckForUpdatesOnFocus,
    shouldInstallUpdateNow,
    shouldPromptForRestart,
    shouldStartAutoUpdateChecks,
};