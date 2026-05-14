'use strict';

function createFakeMailer() {
    const deliveries = [];
    return {
        deliveries,
        async send(message) {
            deliveries.push({ ...message, sentAt: new Date(0).toISOString() });
            return { id: `fake-mail-${deliveries.length}`, provider: 'fake' };
        },
    };
}

module.exports = { createFakeMailer };
