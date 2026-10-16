const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'tls-config-readiness.mjs');

const runScript = (args) => spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 30000,
});

const modernViewerCertificate = {
    CloudFrontDefaultCertificate: false,
    ACMCertificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-4000-8000-000000000000',
    SSLSupportMethod: 'sni-only',
    MinimumProtocolVersion: 'TLSv1.3_2025',
};

const withOriginProtocols = (protocols) => ({
    ViewerCertificate: modernViewerCertificate,
    Origins: {
        Quantity: 1,
        Items: [{
            Id: 'backend',
            CustomOriginConfig: {
                OriginProtocolPolicy: 'https-only',
                OriginSslProtocols: { Quantity: protocols.length, Items: protocols },
            },
        }],
    },
});

const runConfig = (config, filename = 'edge.json') => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-cdn-config-'));
    const configPath = path.join(tempDir, filename);
    fs.writeFileSync(configPath, typeof config === 'string' ? config : JSON.stringify(config, null, 2));
    const reportDir = path.join(tempDir, 'reports');
    const result = runScript(['--config', configPath, '--report-dir', reportDir, '--json', '--markdown']);
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
    const markdown = fs.readFileSync(path.join(reportDir, 'tls-config-readiness.md'), 'utf8');
    return { result, report, markdown };
};

const minimumCheck = (report) => report.checks.find((entry) => entry.id.startsWith('tls.minimum.'));
const originCheck = (report) => report.checks.find((entry) => entry.id.startsWith('tls.cloudfront.origin-protocols.'));

const expectMinimumFailure = ({ result, report }) => {
    expect(result.status).toBe(1);
    expect(report.status).toBe('fail');
    expect(minimumCheck(report)).toEqual(expect.objectContaining({ status: 'fail', severity: 'high' }));
    expect(report.checks.some((entry) => entry.id.startsWith('tls.not-terminating.'))).toBe(false);
};

describe('TLS config readiness checker', () => {
    test('fails the real default-certificate replica while preserving example passes and non-terminating skips', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-readiness-'));
        const result = runScript(['--report-dir', reportDir, '--json', '--markdown']);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'tls.minimum.infra/security/nginx-tls13-pqc-ready.conf.example',
                status: 'pass',
            }),
            expect.objectContaining({
                id: 'tls.minimum.infra/aws/cloudfront-edge-replica.json',
                status: 'fail',
                summary: expect.stringContaining('CloudFrontDefaultCertificate=true forces TLSv1'),
            }),
        ]));
        expect(report.checks.some((entry) => entry.status === 'skipped')).toBe(true);
    });

    test('passes the TLS 1.3 examples in isolation', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-examples-'));
        const examples = [
            'infra/security/nginx-tls13-pqc-ready.conf.example',
            'infra/security/Caddyfile.tls13-pqc-ready.example',
            'infra/security/haproxy-tls13-pqc-ready.cfg.example',
        ];
        const result = runScript([
            ...examples.flatMap((file) => ['--config', file]),
            '--report-dir', reportDir, '--json', '--markdown',
        ]);
        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(report.status).toBe('pass');
        for (const file of examples) {
            expect(report.checks).toContainEqual(expect.objectContaining({ id: `tls.minimum.${file}`, status: 'pass' }));
        }
    });

    test.each(['TLSv1.2_2021', 'TLSv1.2_2025'])('fails a custom viewer policy below TLS 1.3: %s', (policy) => {
        const scan = runConfig({ ViewerCertificate: { ...modernViewerCertificate, MinimumProtocolVersion: policy } });
        expectMinimumFailure(scan);
        expect(minimumCheck(scan.report).summary).toContain('TLS 1.3 minimum');
        expect(minimumCheck(scan.report).summary).toContain(policy);
    });

    test.each([undefined, 'TLSv1.3_2025', 'TLSv1.3_2021'])('fails default-certificate override despite claimed policy %s', (policy) => {
        const scan = runConfig({
            ViewerCertificate: { CloudFrontDefaultCertificate: true, MinimumProtocolVersion: policy },
        });
        expectMinimumFailure(scan);
        const minimum = minimumCheck(scan.report);
        expect(minimum.summary).toContain('CloudFrontDefaultCertificate=true forces TLSv1');
        expect(minimum.summary).toContain('regardless of MinimumProtocolVersion');
        for (const label of ['legacy_tls_1_0', 'legacy_tls_1_1']) {
            expect(scan.report.checks).toContainEqual(expect.objectContaining({
                id: expect.stringContaining(`tls.${label}.`), status: 'fail',
            }));
        }
        if (policy) expect(minimum.summary).toContain('other ViewerCertificate fields must be unset');
    });

    test.each(['direct', 'DistributionConfig', 'Distribution'])('passes a valid custom TLSv1.3_2025 viewer config (%s)', (wrapper) => {
        const config = {
            Aliases: { Quantity: 1, Items: ['shop.example.com'] },
            ViewerCertificate: modernViewerCertificate,
        };
        const wrapped = wrapper === 'DistributionConfig' ? { DistributionConfig: config }
            : wrapper === 'Distribution' ? { Distribution: { DistributionConfig: config } } : config;
        const { result, report } = runConfig(wrapped);
        expect(result.status).toBe(0);
        expect(report.status).toBe('pass');
        expect(minimumCheck(report)).toEqual(expect.objectContaining({
            status: 'pass', summary: expect.stringContaining('TLSv1.3_2025'),
        }));
    });

    test('passes a valid IAM custom certificate with the modern viewer policy', () => {
        const { ACMCertificateArn, ...viewer } = modernViewerCertificate;
        const { result, report } = runConfig({ ViewerCertificate: { ...viewer, IAMCertificateId: 'test-certificate' } });
        expect(result.status).toBe(0);
        expect(minimumCheck(report).status).toBe('pass');
    });

    test.each(['TLSv1.3_2021', 'TLSv1.3_2099', 'tlsv1.3_2025'])('rejects an invalid custom viewer policy enum: %s', (policy) => {
        const scan = runConfig({ ViewerCertificate: { ...modernViewerCertificate, MinimumProtocolVersion: policy } });
        expectMinimumFailure(scan);
        expect(minimumCheck(scan.report).summary).toContain('Invalid CloudFront MinimumProtocolVersion');
        expect(minimumCheck(scan.report).summary).toContain(policy);
    });

    test.each([
        ['missing certificate', { ACMCertificateArn: undefined }],
        ['conflicting certificates', { IAMCertificateId: 'test-certificate' }],
        ['malformed additional certificate', { IAMCertificateId: 42 }],
        ['empty certificate', { ACMCertificateArn: '' }],
        ['missing support method', { SSLSupportMethod: undefined }],
        ['unproven non-SNI enforcement', { SSLSupportMethod: 'vip' }],
        ['unproven static-IP enforcement', { SSLSupportMethod: 'static-ip' }],
        ['invalid support method', { SSLSupportMethod: 'invalid' }],
        ['non-boolean default flag', { CloudFrontDefaultCertificate: 'true' }],
    ])('rejects a claimed modern policy with %s', (name, overrides) => {
        expectMinimumFailure(runConfig({ ViewerCertificate: { ...modernViewerCertificate, ...overrides } }));
    });

    test.each([
        ['edge.json', '{"ViewerCertificate":{"MinimumProtocolVersion":"TLSv1.3_2025",}}'],
        ['cloudfront-edge.json', '{'],
    ])('fails closed on invalid recognized CloudFront JSON in %s', (filename, content) => {
        const scan = runConfig(content, filename);
        expectMinimumFailure(scan);
        expect(minimumCheck(scan.report).summary).toContain('Invalid CloudFront JSON');
        expect(scan.markdown).toContain('Invalid CloudFront JSON');
    });

    test.each(['{}', 'null', '[]', '{"ViewerCertificate":null}'])('fails closed on missing or malformed viewer configuration: %s', (content) => {
        const scan = runConfig(content, 'cloudfront-edge.json');
        expectMinimumFailure(scan);
        expect(minimumCheck(scan.report).summary).toContain('ViewerCertificate');
    });

    test.each([
        { DistributionConfig: null },
        { Distribution: { DistributionConfig: null } },
    ])('does not fall back to unrelated viewer fields for a malformed distribution wrapper: %j', (wrapper) => {
        expectMinimumFailure(runConfig({ ...wrapper, ViewerCertificate: modernViewerCertificate }));
    });

    test('does not accept TLS 1.3 directives or viewer policy text from unrelated JSON fields', () => {
        const scan = runConfig({
            ViewerCertificate: { ...modernViewerCertificate, MinimumProtocolVersion: undefined },
            Comment: 'ssl_protocols TLSv1.3;',
            Unused: { MinimumProtocolVersion: 'TLSv1.3_2025' },
        });
        expectMinimumFailure(scan);
    });

    test('recognizes JSON-escaped CloudFront property names structurally', () => {
        const scan = runConfig('{"Viewer\\u0043ertificate":{"CloudFrontDefaultCertificate":true}}');
        expectMinimumFailure(scan);
        expect(minimumCheck(scan.report).summary).toContain('CloudFrontDefaultCertificate=true forces TLSv1');
    });

    test('allows the TLSv1.2 origin API enum without claiming TLS 1.3 or a negotiated handshake', () => {
        const { result, report, markdown } = runConfig(withOriginProtocols(['TLSv1.2']));
        expect(result.status).toBe(0);
        expect(minimumCheck(report).status).toBe('pass');
        expect(originCheck(report)).toEqual(expect.objectContaining({
            status: 'pass', summary: expect.stringContaining('valid CloudFront OriginSslProtocols'),
        }));
        expect(originCheck(report).summary).toContain('do not prove a TLS 1.3 minimum or an observed handshake');
        expect(markdown).toContain('TLSv1.2');
    });

    test('does not use an allowed origin enum as proof of the viewer TLS 1.3 minimum', () => {
        const { ViewerCertificate, ...config } = withOriginProtocols(['TLSv1.2']);
        const scan = runConfig(config);
        expectMinimumFailure(scan);
        expect(originCheck(scan.report).status).toBe('pass');
    });

    test('accepts legacy origin API enums as valid syntax but still fails legacy protocol gates', () => {
        const { result, report } = runConfig(withOriginProtocols(['SSLv3', 'TLSv1', 'TLSv1.1', 'TLSv1.2']));
        expect(result.status).toBe(1);
        expect(originCheck(report).status).toBe('pass');
        for (const label of ['legacy_ssl_3', 'legacy_tls_1_0', 'legacy_tls_1_1']) {
            expect(report.checks).toContainEqual(expect.objectContaining({
                id: expect.stringContaining(`tls.${label}.`), status: 'fail',
            }));
        }
    });

    test.each(['TLSv1.3', 'TLSv1.3_2021', 'TLSv1.3_2025', 'TLSv1.2_2021', 'TLSv1.2_2025', 'tlsv1.2'])('rejects invalid origin API enum %s', (protocol) => {
        const { result, report, markdown } = runConfig(withOriginProtocols(['TLSv1.2', protocol]));
        expect(result.status).toBe(1);
        expect(report.status).toBe('fail');
        expect(originCheck(report)).toEqual(expect.objectContaining({
            status: 'fail', summary: expect.stringContaining('Invalid CloudFront OriginSslProtocols'),
        }));
        expect(originCheck(report).summary).toContain(protocol);
        expect(originCheck(report).summary).toContain('SSLv3, TLSv1, TLSv1.1, TLSv1.2');
        expect(markdown).toContain('Invalid CloudFront OriginSslProtocols');
    });

    test.each([
        { Quantity: 2, Items: ['TLSv1.2'] },
        { Quantity: 0, Items: [] },
        { Quantity: 1, Items: 'TLSv1.2' },
        null,
    ])('fails closed on malformed OriginSslProtocols: %j', (protocols) => {
        const config = withOriginProtocols(['TLSv1.2']);
        config.Origins.Items[0].CustomOriginConfig.OriginSslProtocols = protocols;
        const { result, report } = runConfig(config);
        expect(result.status).toBe(1);
        expect(originCheck(report).status).toBe('fail');
    });

    test('fails configs that enable legacy TLS or SSL protocol tokens', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-bad-config-'));
        const badConfig = path.join(tempDir, 'bad.conf');
        fs.writeFileSync(badConfig, [
            'server {',
            '  listen 443 ssl;',
            '  ssl_protocols TLSv1 TLSv1.1;',
            '}',
            '',
        ].join('\n'));
        const reportDir = path.join(tempDir, 'reports');
        const result = runScript(['--config', badConfig, '--report-dir', reportDir, '--json', '--markdown']);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'fail', summary: expect.stringContaining('legacy protocol token') }),
        ]));
    });
});
