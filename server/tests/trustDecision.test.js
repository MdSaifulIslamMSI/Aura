const {
  DECISIONS,
  ENFORCEMENT_MODES,
  RISK_LEVELS,
  buildTrustDecision,
  clampRiskScore,
  createDecisionId,
  createEvidence,
  isEnforceMode,
  isShadowMode,
  normalizeActorId,
  normalizeMode,
  normalizeResourceId,
  riskLevelForScore,
} = require('../trust/trustDecision');

describe('trustDecision normalization', () => {
  test('clamps risk scores to 0..100 integers', () => {
    expect(clampRiskScore(-5)).toBe(0);
    expect(clampRiskScore(250)).toBe(100);
    expect(clampRiskScore(42.6)).toBe(43);
    expect(clampRiskScore('nope')).toBe(0);
  });

  test('maps scores to risk levels', () => {
    expect(riskLevelForScore(10)).toBe(RISK_LEVELS.LOW);
    expect(riskLevelForScore(45)).toBe(RISK_LEVELS.MEDIUM);
    expect(riskLevelForScore(70)).toBe(RISK_LEVELS.HIGH);
    expect(riskLevelForScore(95)).toBe(RISK_LEVELS.CRITICAL);
  });

  test('defaults unknown enforcement modes to shadow', () => {
    expect(normalizeMode('ENFORCE-SAFE')).toBe(ENFORCEMENT_MODES.ENFORCE_SAFE);
    expect(normalizeMode('nonsense')).toBe(ENFORCEMENT_MODES.SHADOW);
    expect(normalizeMode('')).toBe(ENFORCEMENT_MODES.SHADOW);
  });

  test('distinguishes shadow from enforce modes', () => {
    expect(isShadowMode('shadow')).toBe(true);
    expect(isShadowMode('enforce-safe')).toBe(false);
    expect(isEnforceMode('enforce-sensitive')).toBe(true);
    expect(isEnforceMode('off')).toBe(false);
  });

  test('normalizes actor ids across identity shapes', () => {
    expect(normalizeActorId({ userId: 'u-1' })).toBe('u-1');
    expect(normalizeActorId({ _id: 'mongo-1' })).toBe('mongo-1');
    expect(normalizeActorId({ email: 'a@b.c' })).toBe('a@b.c');
    expect(normalizeActorId({})).toBe('');
  });

  test('creates unique decision ids and evidence envelopes', () => {
    expect(createDecisionId()).toMatch(/^trust_/);
    expect(createDecisionId()).not.toBe(createDecisionId());
    const evidence = createEvidence({ actor: { userId: 'u-1' }, action: 'order.read', resource: { id: 'o-1' } });
    expect(evidence).toMatchObject({ actorId: 'u-1', action: 'order.read', resourceId: 'o-1' });
    expect(evidence.decisionId).toMatch(/^trust_/);
  });
});

describe('trustDecision.buildTrustDecision', () => {
  test('builds allow decisions with derived allow flag and risk level', () => {
    const decision = buildTrustDecision({ decision: 'ALLOW', riskScore: 12, reason: 'low risk' });
    expect(decision).toMatchObject({ decision: DECISIONS.ALLOW, allowed: true, riskLevel: RISK_LEVELS.LOW });
  });

  test('derives denial from blocking decisions', () => {
    const decision = buildTrustDecision({ decision: 'BLOCK', riskScore: 95 });
    expect(decision).toMatchObject({ allowed: false, riskLevel: RISK_LEVELS.CRITICAL });
  });

  test('normalizes unknown decision kinds to ALLOW (fail-open by contract)', () => {
    expect(buildTrustDecision({ decision: 'MAYBE' }).decision).toBe(DECISIONS.ALLOW);
  });

  test('normalizes resource ids across shapes', () => {
    expect(normalizeResourceId({ id: 'o-1' })).toBe('o-1');
    expect(normalizeResourceId({ intentId: 'pi-1' })).toBe('pi-1');
    expect(normalizeResourceId({})).toBe('');
  });

  test('exposes the full decision vocabulary', () => {
    for (const kind of ['ALLOW', 'AUDIT_ONLY', 'CHALLENGE', 'THROTTLE', 'BLOCK', 'QUARANTINE']) {
      expect(DECISIONS).toHaveProperty(kind);
    }
  });
});
