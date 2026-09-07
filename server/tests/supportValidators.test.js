const {
  adminUpdateTicketSchema,
  createSupportTicketSchema,
  requestSupportLiveCallSchema,
  sendSupportMessageSchema,
  supportLiveCallActionSchema,
  supportLiveCallStartSchema,
  supportTicketQuerySchema,
  ticketIdParamSchema,
} = require('../validators/supportValidators');

const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('supportValidators ticket schemas', () => {
  test('create accepts well-formed tickets', () => {
    expect(() => createSupportTicketSchema.parse({
      body: { subject: 'Refund delay', category: 'order_issue', message: 'My refund is late by a week.' },
    })).not.toThrow();
  });

  test('create rejects short subjects and unknown categories', () => {
    expect(createSupportTicketSchema.safeParse({
      body: { subject: 'Hi', category: 'order_issue', message: 'Long enough message here.' },
    }).success).toBe(false);
    expect(createSupportTicketSchema.safeParse({
      body: { subject: 'Valid subject', category: 'hacking', message: 'Long enough message here.' },
    }).success).toBe(false);
  });

  test('message send requires a valid ticket id and non-empty message', () => {
    expect(() => sendSupportMessageSchema.parse({ params: { id: OBJECT_ID }, body: { message: 'Hello' } })).not.toThrow();
    expect(sendSupportMessageSchema.safeParse({ params: { id: 'nope' }, body: { message: 'Hello' } }).success).toBe(false);
    expect(sendSupportMessageSchema.safeParse({ params: { id: OBJECT_ID }, body: { message: '   ' } }).success).toBe(false);
  });

  test('ticket listing paginates with sane defaults and ceilings', () => {
    const parsed = supportTicketQuerySchema.parse({ query: {} });
    expect(parsed.query.page).toBe(1);
    expect(parsed.query.limit).toBe(10);
    expect(supportTicketQuerySchema.safeParse({ query: { limit: '500' } }).success).toBe(false);
    expect(supportTicketQuerySchema.safeParse({ query: { status: 'archived' } }).success).toBe(false);
  });

  test('admin updates require a real resolution summary', () => {
    const valid = { params: { id: OBJECT_ID }, body: { status: 'resolved', resolutionSummary: 'Refund issued via Razorpay.' } };
    expect(() => adminUpdateTicketSchema.parse(valid)).not.toThrow();
    expect(adminUpdateTicketSchema.safeParse({
      params: { id: OBJECT_ID },
      body: { status: 'resolved', resolutionSummary: 'Fixed' },
    }).success).toBe(false);
  });
});

describe('supportValidators live-call schemas', () => {
  test('live-call request validates media modes', () => {
    expect(() => requestSupportLiveCallSchema.parse({ params: { id: OBJECT_ID }, body: { mediaMode: 'video' } })).not.toThrow();
    expect(requestSupportLiveCallSchema.safeParse({
      params: { id: OBJECT_ID }, body: { mediaMode: 'hologram' },
    }).success).toBe(false);
  });

  test('live-call start accepts session keys', () => {
    expect(() => supportLiveCallStartSchema.parse({
      params: { id: OBJECT_ID }, body: { sessionKey: 'sess-1' },
    })).not.toThrow();
  });

  test('live-call actions restrict reasons to the known set', () => {
    expect(() => supportLiveCallActionSchema.parse({
      params: { id: OBJECT_ID }, body: { reason: 'hangup' },
    })).not.toThrow();
    expect(supportLiveCallActionSchema.safeParse({
      params: { id: OBJECT_ID }, body: { reason: 'alien_abduction' },
    }).success).toBe(false);
  });

  test('ticket id params reject malformed ObjectIds', () => {
    expect(ticketIdParamSchema.safeParse({ params: { id: '123' } }).success).toBe(false);
    expect(() => ticketIdParamSchema.parse({ params: { id: OBJECT_ID } })).not.toThrow();
  });
});
