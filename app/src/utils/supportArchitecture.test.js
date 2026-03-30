import { describe, expect, it } from 'vitest';
import {
    buildSupportSummaryFromTickets,
    buildSupportTimeline,
    normalizeSupportSummary,
} from './supportArchitecture';

describe('supportArchitecture', () => {
    it('builds queue metrics from support tickets', () => {
        const summary = buildSupportSummaryFromTickets([
            {
                _id: 'ticket-1',
                status: 'open',
                priority: 'urgent',
                unreadByAdmin: 3,
                category: 'moderation_appeal',
                liveCallRequested: true,
                liveCallRequestedMode: 'voice',
                lastMessageAt: '2026-03-30T09:00:00.000Z',
            },
            {
                _id: 'ticket-2',
                status: 'open',
                priority: 'high',
                userActionRequired: true,
                category: 'order_issue',
                liveCallLastStatus: 'connected',
                liveCallLastMediaMode: 'video',
                lastMessageAt: '2026-03-30T09:45:00.000Z',
            },
            {
                _id: 'ticket-3',
                status: 'resolved',
                category: 'general_support',
                lastMessageAt: '2026-03-30T09:55:00.000Z',
            },
        ], new Date('2026-03-30T10:00:00.000Z').getTime());

        expect(summary.totalTickets).toBe(3);
        expect(summary.openTickets).toBe(2);
        expect(summary.resolvedTickets).toBe(1);
        expect(summary.waitingOnAdmin).toBe(1);
        expect(summary.unreadBacklog).toBe(3);
        expect(summary.waitingOnUser).toBe(1);
        expect(summary.urgentTickets).toBe(1);
        expect(summary.highPriorityTickets).toBe(1);
        expect(summary.queuedLiveCalls).toBe(1);
        expect(summary.connectedLiveCalls).toBe(1);
        expect(summary.voiceLiveCalls).toBe(1);
        expect(summary.videoLiveCalls).toBe(1);
        expect(summary.moderationTickets).toBe(1);
        expect(summary.orderTickets).toBe(1);
    });

    it('normalizes server summary values with safe defaults', () => {
        const summary = normalizeSupportSummary({
            totalTickets: '4',
            waitingOnAdmin: '2',
            voiceLiveCalls: '1',
        });

        expect(summary.totalTickets).toBe(4);
        expect(summary.waitingOnAdmin).toBe(2);
        expect(summary.voiceLiveCalls).toBe(1);
        expect(summary.videoLiveCalls).toBe(0);
    });

    it('builds a ticket channel timeline for live support', () => {
        const timeline = buildSupportTimeline({
            ticket: {
                _id: 'ticket-9',
                status: 'open',
                userActionRequired: false,
                lastMessagePreview: 'Customer needs help immediately.',
                liveCallRequested: true,
                liveCallRequestedMode: 'voice',
                liveCallLastStatus: 'ringing',
                liveCallLastContextLabel: 'Voice call requested',
            },
            activeCallContext: {
                channelType: 'support_ticket',
                contextId: 'ticket-9',
                mediaMode: 'voice',
            },
            callStatus: 'connected',
        });

        expect(timeline.map((stage) => stage.key)).toEqual(['chat', 'voice', 'video', 'resolution']);
        expect(timeline.find((stage) => stage.key === 'voice')?.state).toBe('active');
        expect(timeline.find((stage) => stage.key === 'video')?.state).toBe('pending');
        expect(timeline.find((stage) => stage.key === 'resolution')?.state).toBe('active');
    });
});
