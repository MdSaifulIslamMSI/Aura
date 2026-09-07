const { resolveTrustFabricConfig } = require('../trust/trustContext');

describe('trustContext.resolveTrustFabricConfig', () => {
  test('defaults to enabled shadow with audit and metrics on', () => {
    const config = resolveTrustFabricConfig({});
    expect(config).toMatchObject({
      enabled: true, mode: 'shadow', auditEnabled: true, metricsEnabled: true,
      enforceOwnership: false, enforceAdminStepUp: false, enforceRisk: false,
    });
  });

  test('parses boolean env variants', () => {
    expect(resolveTrustFabricConfig({ AURA_TRUST_FABRIC_ENABLED: '0' }).enabled).toBe(false);
    expect(resolveTrustFabricConfig({ AURA_TRUST_FABRIC_ENFORCE_RISK: 'yes' }).enforceRisk).toBe(true);
    expect(resolveTrustFabricConfig({ AURA_TRUST_FABRIC_AUDIT_ENABLED: 'off' }).auditEnabled).toBe(false);
  });

  test('forces OFF mode when disabled regardless of mode env', () => {
    const config = resolveTrustFabricConfig({ AURA_TRUST_FABRIC_ENABLED: 'false', AURA_TRUST_FABRIC_MODE: 'enforce-sensitive' });
    expect(config).toMatchObject({ enabled: false, mode: 'off' });
  });

  test('normalizes invalid modes to shadow', () => {
    expect(resolveTrustFabricConfig({ AURA_TRUST_FABRIC_MODE: 'yolo' }).mode).toBe('shadow');
    expect(resolveTrustFabricConfig({ AURA_TRUST_FABRIC_MODE: 'ENFORCE-SAFE' }).mode).toBe('enforce-safe');
  });

  test('explicit overrides beat environment', () => {
    const config = resolveTrustFabricConfig(
      { AURA_TRUST_FABRIC_ENABLED: 'false' },
      { enabled: true, mode: 'enforce-sensitive', enforceRisk: true }
    );
    expect(config).toMatchObject({ enabled: true, mode: 'enforce-sensitive', enforceRisk: true });
  });
});
