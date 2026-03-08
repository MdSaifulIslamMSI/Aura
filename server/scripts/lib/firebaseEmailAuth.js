const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const signInWithEmailPassword = async ({
    apiKey,
    email,
    password,
}) => {
    assert(apiKey, 'Firebase Web API key is required');
    assert(email, 'Firebase sign-in email is required');
    assert(password, 'Firebase sign-in password is required');

    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true,
            }),
        }
    );

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.idToken) {
        throw new Error(json?.error?.message || `Firebase email/password sign-in failed with ${response.status}`);
    }

    return {
        idToken: json.idToken,
        refreshToken: json.refreshToken || '',
        localId: json.localId || '',
        email: json.email || email,
    };
};

module.exports = {
    signInWithEmailPassword,
};
