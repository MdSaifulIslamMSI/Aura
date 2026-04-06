describe('providerRegistry voice session contract', () => {
    test('exports createVoiceSessionConfig with the assistant voice payload shape', () => {
        const {
            createVoiceSessionConfig,
        } = require('../services/ai/providerRegistry');

        expect(typeof createVoiceSessionConfig).toBe('function');

        const session = createVoiceSessionConfig({
            userId: 'user-123',
            locale: 'en-IN',
        });

        expect(session).toMatchObject({
            locale: 'en-IN',
            supportsServerInterpretation: true,
            turnEndpoint: '/api/ai/chat',
            speakEndpoint: '/api/ai/voice/speak',
            capabilities: {
                speechToText: expect.objectContaining({
                    provider: expect.any(String),
                    mode: expect.any(String),
                }),
                textToSpeech: expect.objectContaining({
                    provider: expect.any(String),
                    mode: expect.any(String),
                }),
                realtime: expect.objectContaining({
                    provider: expect.any(String),
                    mode: expect.any(String),
                }),
            },
        });
        expect(session.sessionId).toMatch(/^voice_/);
        expect(Array.isArray(session.capabilities.speechToText.languageHints)).toBe(true);
        expect(typeof session.realtimeEnabled).toBe('boolean');
    });
});
