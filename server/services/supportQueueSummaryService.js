const SupportTicket = require('../models/SupportTicket');

const STALE_TICKET_MS = 20 * 60 * 1000;

const createEmptySupportQueueSummary = () => ({
    totalTickets: 0,
    openTickets: 0,
    resolvedTickets: 0,
    closedTickets: 0,
    waitingOnAdmin: 0,
    waitingOnUser: 0,
    unreadBacklog: 0,
    urgentTickets: 0,
    highPriorityTickets: 0,
    queuedLiveCalls: 0,
    ringingLiveCalls: 0,
    connectedLiveCalls: 0,
    voiceLiveCalls: 0,
    videoLiveCalls: 0,
    staleOpenTickets: 0,
    moderationTickets: 0,
    orderTickets: 0,
    generalTickets: 0,
});

const sanitizeNumericFields = (summary = {}) => {
    const emptySummary = createEmptySupportQueueSummary();

    return Object.keys(emptySummary).reduce((accumulator, key) => {
        const nextValue = Number(summary[key]);
        accumulator[key] = Number.isFinite(nextValue) ? nextValue : emptySummary[key];
        return accumulator;
    }, emptySummary);
};

const buildSupportQueueSummary = async (filter = {}) => {
    const staleCutoff = new Date(Date.now() - STALE_TICKET_MS);
    const safeFilter = filter && typeof filter === 'object' ? filter : {};

    const [summary] = await SupportTicket.aggregate([
        { $match: safeFilter },
        {
            $group: {
                _id: null,
                totalTickets: { $sum: 1 },
                openTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'open'] }, 1, 0],
                    },
                },
                resolvedTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0],
                    },
                },
                closedTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'closed'] }, 1, 0],
                    },
                },
                waitingOnAdmin: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'open'] },
                                    { $gt: ['$unreadByAdmin', 0] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                waitingOnUser: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'open'] },
                                    '$userActionRequired',
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                unreadBacklog: { $sum: '$unreadByAdmin' },
                urgentTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$priority', 'urgent'] }, 1, 0],
                    },
                },
                highPriorityTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$priority', 'high'] }, 1, 0],
                    },
                },
                queuedLiveCalls: {
                    $sum: {
                        $cond: ['$liveCallRequested', 1, 0],
                    },
                },
                ringingLiveCalls: {
                    $sum: {
                        $cond: [{ $eq: ['$liveCallLastStatus', 'ringing'] }, 1, 0],
                    },
                },
                connectedLiveCalls: {
                    $sum: {
                        $cond: [{ $eq: ['$liveCallLastStatus', 'connected'] }, 1, 0],
                    },
                },
                voiceLiveCalls: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    {
                                        $or: [
                                            '$liveCallRequested',
                                            { $eq: ['$liveCallLastStatus', 'ringing'] },
                                            { $eq: ['$liveCallLastStatus', 'connected'] },
                                        ],
                                    },
                                    {
                                        $eq: [
                                            {
                                                $cond: [
                                                    '$liveCallRequested',
                                                    '$liveCallRequestedMode',
                                                    '$liveCallLastMediaMode',
                                                ],
                                            },
                                            'voice',
                                        ],
                                    },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                videoLiveCalls: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    {
                                        $or: [
                                            '$liveCallRequested',
                                            { $eq: ['$liveCallLastStatus', 'ringing'] },
                                            { $eq: ['$liveCallLastStatus', 'connected'] },
                                        ],
                                    },
                                    {
                                        $eq: [
                                            {
                                                $cond: [
                                                    '$liveCallRequested',
                                                    '$liveCallRequestedMode',
                                                    '$liveCallLastMediaMode',
                                                ],
                                            },
                                            'video',
                                        ],
                                    },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                staleOpenTickets: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'open'] },
                                    { $lt: ['$lastMessageAt', staleCutoff] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
                moderationTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$category', 'moderation_appeal'] }, 1, 0],
                    },
                },
                orderTickets: {
                    $sum: {
                        $cond: [{ $eq: ['$category', 'order_issue'] }, 1, 0],
                    },
                },
                generalTickets: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ['$category', 'general_support'] },
                                    { $eq: ['$category', 'other'] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]);

    return sanitizeNumericFields(summary);
};

module.exports = {
    buildSupportQueueSummary,
    createEmptySupportQueueSummary,
};
