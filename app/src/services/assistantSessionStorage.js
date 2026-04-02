const ASSISTANT_WORKSPACE_STORAGE_KEY = 'aura_assistant_workspace_v2';

const getDefaultState = () => ({
    sessionId: '',
    draft: '',
});

const getWindowRef = () => (typeof window !== 'undefined' ? window : null);

export const readAssistantWorkspaceState = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.sessionStorage) {
        return getDefaultState();
    }

    try {
        const raw = windowRef.sessionStorage.getItem(ASSISTANT_WORKSPACE_STORAGE_KEY);
        if (!raw) {
            return getDefaultState();
        }

        const parsed = JSON.parse(raw);
        return {
            sessionId: String(parsed?.sessionId || '').trim(),
            draft: String(parsed?.draft || ''),
        };
    } catch {
        return getDefaultState();
    }
};

export const writeAssistantWorkspaceState = (nextState = {}) => {
    const windowRef = getWindowRef();
    if (!windowRef?.sessionStorage) {
        return getDefaultState();
    }

    const resolved = {
        ...getDefaultState(),
        ...nextState,
        sessionId: String(nextState?.sessionId || '').trim(),
        draft: String(nextState?.draft || ''),
    };

    windowRef.sessionStorage.setItem(ASSISTANT_WORKSPACE_STORAGE_KEY, JSON.stringify(resolved));
    return resolved;
};

export const clearAssistantWorkspaceState = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.sessionStorage) {
        return;
    }

    windowRef.sessionStorage.removeItem(ASSISTANT_WORKSPACE_STORAGE_KEY);
};
