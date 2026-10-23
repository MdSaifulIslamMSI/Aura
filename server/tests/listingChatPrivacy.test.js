const Conversation = require('../models/Conversation');
const Listing = require('../models/Listing');
const Message = require('../models/Message');
const { createTestUser } = require('./helpers/securityTestHelpers');

const sendCounterpartyMessageEmail = jest.fn(async () => undefined);
const sendMessageToUser = jest.fn();

jest.doMock('../services/listingService', () => ({
    sendCounterpartyMessageEmail,
}));
jest.doMock('../services/socketService', () => ({
    sendMessageToUser,
}));

const {
    getListingMessages,
    getMyMessageInbox,
    sendListingMessage,
} = require('../controllers/listingController');

jest.setTimeout(30_000);

const createListing = async (sellerId) => Listing.create({
    seller: sellerId,
    title: 'Chat privacy listing',
    description: 'Listing used by the marketplace chat privacy suite.',
    price: 4200,
    condition: 'good',
    category: 'electronics',
    images: ['https://example.test/chat.jpg'],
    location: { city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    status: 'active',
    source: 'user',
});

const invoke = async (handler, req) => {
    const res = { json: jest.fn((payload) => payload) };
    const next = jest.fn();
    await handler(req, res, next);
    return { res, next };
};

const requestFor = (user, listing, overrides = {}) => ({
    user,
    params: { id: String(listing._id) },
    query: {},
    body: {},
    headers: {},
    ...overrides,
});

describe('listing chat privacy and conversation ownership', () => {
    let seller;
    let buyer;
    let listing;

    beforeEach(async () => {
        sendCounterpartyMessageEmail.mockClear();
        sendMessageToUser.mockClear();
        seller = await createTestUser({ name: 'Chat Seller' });
        buyer = await createTestUser({ name: 'Chat Buyer' });
        listing = await createListing(seller._id);
    });

    test('seller cannot create a conversation with an arbitrary buyer', async () => {
        const { next } = await invoke(sendListingMessage, requestFor(seller, listing, {
            body: {
                buyerId: String(buyer._id),
                text: 'Unsolicited seller message',
            },
        }));

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
        await expect(Conversation.countDocuments({ listing: listing._id })).resolves.toBe(0);
        await expect(Message.countDocuments({ sender: seller._id })).resolves.toBe(0);
        expect(sendMessageToUser).not.toHaveBeenCalled();
        expect(sendCounterpartyMessageEmail).not.toHaveBeenCalled();
    });

    test('buyer opens a thread and neither side receives the other party email', async () => {
        const buyerSend = await invoke(sendListingMessage, requestFor(buyer, listing, {
            body: { text: 'Is this still available?' },
        }));

        expect(buyerSend.next).not.toHaveBeenCalled();
        expect(buyerSend.res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            conversation: expect.objectContaining({
                sellerUser: expect.not.objectContaining({ email: expect.anything() }),
            }),
        }));

        const sellerReply = await invoke(sendListingMessage, requestFor(seller, listing, {
            body: {
                buyerId: String(buyer._id),
                text: 'Yes, it is available.',
            },
        }));

        expect(sellerReply.next).not.toHaveBeenCalled();
        const payload = sellerReply.res.json.mock.calls[0][0];
        expect(Object.prototype.hasOwnProperty.call(payload.conversation.buyerUser, 'email')).toBe(false);
        expect(payload.conversation.sellerUser).toBeNull();
        await expect(Conversation.countDocuments({ listing: listing._id })).resolves.toBe(1);
    });

    test('inbox and thread payloads expose public profiles without email', async () => {
        await invoke(sendListingMessage, requestFor(buyer, listing, {
            body: { text: 'Opening the thread.' },
        }));

        const sellerInbox = await invoke(getMyMessageInbox, requestFor(seller, listing));
        const sellerInboxPayload = sellerInbox.res.json.mock.calls[0][0];
        expect(sellerInboxPayload.conversations).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(
            sellerInboxPayload.conversations[0].buyerUser,
            'email'
        )).toBe(false);

        const buyerInbox = await invoke(getMyMessageInbox, requestFor(buyer, listing));
        const buyerInboxPayload = buyerInbox.res.json.mock.calls[0][0];
        expect(Object.prototype.hasOwnProperty.call(
            buyerInboxPayload.conversations[0].sellerUser,
            'email'
        )).toBe(false);

        const sellerHub = await invoke(getListingMessages, requestFor(seller, listing));
        const sellerHubPayload = sellerHub.res.json.mock.calls[0][0];
        expect(sellerHubPayload.conversations).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(
            sellerHubPayload.conversations[0].buyerUser,
            'email'
        )).toBe(false);

        const buyerThread = await invoke(getListingMessages, requestFor(buyer, listing));
        const buyerThreadPayload = buyerThread.res.json.mock.calls[0][0];
        expect(Object.prototype.hasOwnProperty.call(
            buyerThreadPayload.conversation.sellerUser,
            'email'
        )).toBe(false);
    });
});
