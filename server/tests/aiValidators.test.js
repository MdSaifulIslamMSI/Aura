const {
  aiChatSchema,
  aiSessionCreateSchema,
  aiVoiceSessionSchema,
  aiVoiceSpeakSchema,
} = require('../validators/aiValidators');

describe('aiValidators chat', () => {
  test('accepts plain messages and voice modes', () => {
    expect(() => aiChatSchema.parse({ body: { message: 'Hello', assistantMode: 'chat' } })).not.toThrow();
    expect(() => aiChatSchema.parse({ body: { message: 'Hi', assistantMode: 'voice' } })).not.toThrow();
  });

  test('requires some content (message, confirmation, action or image)', () => {
    expect(aiChatSchema.safeParse({ body: {} }).success).toBe(false);
    expect(() => aiChatSchema.parse({
      body: { confirmation: { actionId: 'a-1', approved: true } },
    })).not.toThrow();
  });

  test('rejects oversized messages and unknown modes', () => {
    expect(aiChatSchema.safeParse({ body: { message: 'x'.repeat(5000) } }).success).toBe(false);
    expect(aiChatSchema.safeParse({ body: { message: 'hi', assistantMode: 'telepathy' } }).success).toBe(false);
  });

  test('caps conversation history and media attachments', () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    expect(aiChatSchema.safeParse({ body: { message: 'hi', conversationHistory: history } }).success).toBe(false);
    expect(aiChatSchema.safeParse({
      body: { images: [{ url: 'http://x/y.png' }, { url: 'http://x/a.png' }, { url: 'http://x/b.png' }, { url: 'http://x/c.png' }] },
    }).success).toBe(false);
  });

  test('rejects non-base64 image data URIs (injection guard)', () => {
    expect(aiChatSchema.safeParse({
      body: { images: [{ dataUrl: 'javascript:alert(1)' }] },
    }).success).toBe(false);
  });
});

describe('aiValidators sessions and voice', () => {
  test('session creation scopes modes and paths', () => {
    expect(() => aiSessionCreateSchema.parse({ body: { assistantMode: 'voice', originPath: '/cart' } })).not.toThrow();
    expect(aiSessionCreateSchema.safeParse({ body: { locale: 'en-IN' } }).success).toBe(false);
  });

  test('voice sessions validate channels', () => {
    expect(() => aiVoiceSessionSchema.parse({ body: { locale: 'hi', channel: 'voice' } })).not.toThrow();
    expect(aiVoiceSessionSchema.safeParse({ body: { channel: 'telepathy' } }).success).toBe(false);
  });

  test('speak requests bound text lengths', () => {
    expect(() => aiVoiceSpeakSchema.parse({ body: { text: 'Hello there' } })).not.toThrow();
    expect(aiVoiceSpeakSchema.safeParse({ body: { text: '' } }).success).toBe(false);
  });
});

describe('aiValidators assistant media contracts', () => {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  test('accepts allowlisted assistant image and audio data URI MIME types', () => {
    const result = aiChatSchema.safeParse({
      body: {
        message: 'compare these',
        images: [{ dataUrl: `data:image/png;base64,${pngBase64}`, mimeType: 'image/png', fileName: 'camera.png' }],
        audio: [{ dataUrl: `data:audio/mpeg;base64,${Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x21', 'binary').toString('base64')}`, mimeType: 'audio/mpeg', fileName: 'voice.mp3' }],
      },
    });
    expect(result.success).toBe(true);
  });

  test('rejects unsupported assistant data URI MIME types before controller validation', () => {
    const result = aiChatSchema.safeParse({
      body: {
        message: 'inspect this',
        images: [{ dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', mimeType: 'image/svg+xml', fileName: 'drawing.svg' }],
      },
    });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
      'Unsupported assistant image MIME type',
      'Unsupported assistant image data URI MIME type',
    ]));
  });
});
