const normalizeSession = (reqOrSession = {}) => {
    if (!reqOrSession) return null;
    if (reqOrSession.authSession || reqOrSession.session) {
        return reqOrSession.authSession || reqOrSession.session;
    }
    return reqOrSession;
};

module.exports = {
    normalizeSession,
};
