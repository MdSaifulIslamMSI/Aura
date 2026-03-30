import { describe, expect, it } from 'vitest';
import {
    getIncomingCallDisposition,
    getUnexpectedLiveKitDisconnectReason,
    isSameLiveCallSession,
    normalizeLiveCallMediaMode,
    shouldSynchronizeUnexpectedLiveKitDisconnect,
} from './videoCallSessionUtils';

describe('videoCallSessionUtils', () => {
    it('normalizes voice and video media modes', () => {
        expect(normalizeLiveCallMediaMode('voice')).toBe('voice');
        expect(normalizeLiveCallMediaMode('VOICE')).toBe('voice');
        expect(normalizeLiveCallMediaMode('something-else')).toBe('video');
    });

    it('matches the same live call session across duplicate socket events', () => {
        expect(isSameLiveCallSession(
            {
                channelType: 'support_ticket',
                contextId: 'ticket-1',
                sessionKey: 'room-1',
            },
            {
                channelType: 'support_ticket',
                supportTicketId: 'ticket-1',
                sessionKey: 'room-1',
            }
        )).toBe(true);
    });

    it('treats different sessions as distinct calls', () => {
        expect(isSameLiveCallSession(
            {
                channelType: 'listing',
                contextId: 'listing-1',
                sessionKey: 'room-1',
            },
            {
                channelType: 'listing',
                listingId: 'listing-1',
                sessionKey: 'room-2',
            }
        )).toBe(false);
    });

    it('marks a different incoming call as busy when another call is active', () => {
        expect(getIncomingCallDisposition({
            activeCallContext: {
                channelType: 'listing',
                contextId: 'listing-1',
                sessionKey: 'room-1',
            },
            callStatus: 'connected',
            nextContext: {
                channelType: 'support_ticket',
                contextId: 'ticket-2',
                sessionKey: 'room-2',
            },
        })).toBe('busy');
    });

    it('treats client-initiated and room-deleted disconnects as expected', () => {
        expect(shouldSynchronizeUnexpectedLiveKitDisconnect(1)).toBe(false);
        expect(shouldSynchronizeUnexpectedLiveKitDisconnect(5)).toBe(false);
        expect(shouldSynchronizeUnexpectedLiveKitDisconnect(3)).toBe(true);
    });

    it('maps unexpected disconnects to failed or connection_lost based on call progress', () => {
        expect(getUnexpectedLiveKitDisconnectReason({
            callStatus: 'calling',
            roomConnectionState: 'connecting',
            remoteParticipantCount: 0,
        })).toBe('failed');

        expect(getUnexpectedLiveKitDisconnectReason({
            callStatus: 'connected',
            roomConnectionState: 'reconnecting',
            remoteParticipantCount: 1,
        })).toBe('connection_lost');
    });
});
