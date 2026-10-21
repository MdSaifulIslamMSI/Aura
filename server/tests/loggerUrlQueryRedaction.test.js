const logger = require('../utils/logger');

const REDACTED = logger.REDACTED_PLACEHOLDER;

// The regular expression this redaction used to be expressed as. It is kept
// here ONLY as the behavioural oracle: the implementation is a linear scan
// now, and this suite pins that the two produce byte-for-byte identical
// output so the rewrite cannot silently change what gets redacted.
//
// The old pattern was quadratic: the literal '/' in the URL prefix and the
// '/' that the path character class also matched were ambiguous, so the
// engine retried the match at every position of a long token.
const LEGACY_URL_WITH_QUERY_PATTERN = /((?:https?:\/\/|\/)[^\s"'`?]+)\?[^\s"'`]*/gi;

const legacyRedact = (value) => String(value || '').replace(LEGACY_URL_WITH_QUERY_PATTERN, `$1?${REDACTED}`);

describe('logger URL query redaction', () => {
    test('redacts the query string of a path, a route and an absolute URL', () => {
        expect(logger.redactUrlQueriesInText('/api/otp/challenge?token=abc'))
            .toBe(`/api/otp/challenge?${REDACTED}`);
        expect(logger.redactUrlQueriesInText('/login?next=/home')).toBe(`/login?${REDACTED}`);
        expect(logger.redactUrlQueriesInText('http://example.com/path?a=1&b=2'))
            .toBe(`http://example.com/path?${REDACTED}`);
        expect(logger.redactUrlQueriesInText('https://example.com/path?a=1'))
            .toBe(`https://example.com/path?${REDACTED}`);
    });

    test('redacts every token in a line that carries more than one query', () => {
        expect(logger.redactUrlQueriesInText('text /a?b more /c?d end'))
            .toBe(`text /a?${REDACTED} more /c?${REDACTED} end`);
    });

    test('leaves text without a reachable query untouched', () => {
        expect(logger.redactUrlQueriesInText('no query here')).toBe('no query here');
        expect(logger.redactUrlQueriesInText('a?b/c')).toBe('a?b/c');
        expect(logger.redactUrlQueriesInText('space ?x=1')).toBe('space ?x=1');
        expect(logger.redactUrlQueriesInText('')).toBe('');
        expect(logger.redactUrlQueriesInText(null)).toBe('');
        expect(logger.redactUrlQueriesInText(undefined)).toBe('');
    });

    test('only a query a URL prefix can reach is redacted', () => {
        // The '?' before the slash is not reachable by any URL prefix, so the
        // query that follows the slash is the one that gets redacted.
        expect(logger.redactUrlQueriesInText('a?b/c?d')).toBe(`a?b/c?${REDACTED}`);
        // A path that starts with '?' is not a path, so the slash cannot open
        // a URL here.
        expect(logger.redactUrlQueriesInText('/??')).toBe('/??');
        expect(logger.redactUrlQueriesInText('/?x')).toBe('/?x');
        // The slash opens a URL and the path before the '?' is long enough.
        expect(logger.redactUrlQueriesInText('a/b?c')).toBe(`a/b?${REDACTED}`);
        expect(logger.redactUrlQueriesInText('/x?a?b')).toBe(`/x?${REDACTED}`);
    });

    test('whitespace, quotes and backticks end a token', () => {
        // The quote ends the token, so what follows it is a token of its own -
        // and one that has no URL prefix, so it is left alone.
        expect(logger.redactUrlQueriesInText("quote'inside?x=1")).toBe("quote'inside?x=1");
        expect(logger.redactUrlQueriesInText('back`tick?x=1')).toBe('back`tick?x=1');
        expect(logger.redactUrlQueriesInText('double"quote?x=1')).toBe('double"quote?x=1');
        // A URL after a quoted section is still its own token, and is redacted.
        expect(logger.redactUrlQueriesInText('/a?b "c?d" /e?f'))
            .toBe(`/a?${REDACTED} "c?d" /e?${REDACTED}`);
    });

    test('produces byte-for-byte the same output as the previous pattern', () => {
        const alphabet = ['a', 'b', '/', '?', ':', '.', ' ', '"', "'", '`', 'h', 't', 'p', 's', '1'];
        const fixed = [
            '',
            '/api/otp/challenge?token=abc',
            'foo//bar?baz',
            '//bar?baz',
            '/x?a?b',
            'xhttps://a?b',
            'https://a?b',
            'http://a?b',
            'a/b?c/d?e',
            'HTTPS://EXAMPLE.COM?X=1',
            'https://example.com?',
            'weird://host?x',
            '/a/b?c',
            '?x/y?z',
            '?/x?y',
            'a?/b?c',
            '?a/b?c',
            '/?a/b?c',
            '/x/?a?b',
            '//?a/b',
            '/a//b?c',
        ];
        for (const sample of fixed) {
            expect(logger.redactUrlQueriesInText(sample)).toBe(legacyRedact(sample));
        }

        // A deterministic pseudo-random sweep over the alphabet, so a change
        // in either implementation shows up as a behavioural difference.
        let seed = 20261021;
        const next = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        for (let iteration = 0; iteration < 20000; iteration += 1) {
            const length = Math.floor(next() * 24);
            let sample = '';
            for (let i = 0; i < length; i += 1) {
                sample += alphabet[Math.floor(next() * alphabet.length)];
            }
            expect(logger.redactUrlQueriesInText(sample)).toBe(legacyRedact(sample));
        }
    });

    test('redacts a long adversarial token in linear time', () => {
        // The quadratic version needed ~1.4s for this input. The budget is
        // deliberately loose: it only has to fail if the work becomes
        // super-linear again, and it has to survive a loaded CI runner.
        const adversarial = 'a/'.repeat(20000);
        const started = process.hrtime.bigint();
        const redacted = logger.redactUrlQueriesInText(adversarial);
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

        // No '?' in the input, so nothing is redacted - the point of the case
        // is the work, not the output.
        expect(redacted).toBe(adversarial);
        expect(elapsedMs).toBeLessThan(500);
    });

    test('redacts a long adversarial token that does carry a query', () => {
        const adversarial = 'a/'.repeat(20000) + '?token=secret';
        const started = process.hrtime.bigint();
        const redacted = logger.redactUrlQueriesInText(adversarial);
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

        expect(redacted.endsWith(`?${REDACTED}`)).toBe(true);
        expect(redacted).not.toContain('secret');
        expect(elapsedMs).toBeLessThan(500);
    });
});
