const buildProfileSupportUrl = ({
    ticketId = '',
    compose = false,
    category = '',
    relatedActionId = '',
    subject = '',
    intent = '',
} = {}) => {
    const params = new URLSearchParams();
    params.set('tab', 'support');

    if (ticketId) params.set('ticket', String(ticketId));
    if (compose) params.set('compose', '1');
    if (category) params.set('category', String(category));
    if (relatedActionId) params.set('actionId', String(relatedActionId));
    if (subject) params.set('subject', String(subject));
    if (intent) params.set('intent', String(intent));

    return `/profile?${params.toString()}`;
};

module.exports = {
    buildProfileSupportUrl,
};
