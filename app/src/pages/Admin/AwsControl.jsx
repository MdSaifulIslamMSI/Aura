import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  DollarSign,
  Loader2,
  Power,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel, AdminPremiumSubpanel } from '@/components/shared/AdminPremiumShell';
import { adminApi } from '@/services/api';

const STOP_CONFIRMATION_BY_TARGET = Object.freeze({
  staging: 'STOP STAGING',
  production: 'STOP PRODUCTION',
});

const awsControlMessages = defineMessages({
  budgetAndExpiration: { id: 'admin.awsControl.guardrails.title', defaultMessage: 'Budget and expiration' },
  budgetLine: { id: 'admin.awsControl.guardrails.budget', defaultMessage: 'Budget: {name}' },
  controlPlane: { id: 'admin.awsControl.stat.controlPlane', defaultMessage: 'Control plane' },
  controlPlaneDisabled: { id: 'admin.awsControl.disabled.title', defaultMessage: 'AWS control plane is not enabled on this backend' },
  controlPlaneDisabledDescription: {
    id: 'admin.awsControl.disabled.description',
    defaultMessage: 'Set server-side AWS control environment variables to enable live status and guarded controls. Browser clients never receive AWS credentials.',
  },
  costExplorerUnavailable: { id: 'admin.awsControl.cost.unavailable', defaultMessage: 'Cost Explorer unavailable' },
  costLines: { id: 'admin.awsControl.cost.lines', defaultMessage: '{count, plural, one {# cost line} other {# cost lines}}' },
  costWatch: { id: 'admin.awsControl.cost.title', defaultMessage: 'Cost watch' },
  currentMonthSpend: { id: 'admin.awsControl.cost.currentMonthSpend', defaultMessage: 'Current month AWS spend' },
  description: {
    id: 'admin.awsControl.description',
    defaultMessage: 'Admin-only visibility and guarded controls for Aura AWS infrastructure. Production actions require explicit server-side break-glass opt-in and exact stop confirmation.',
  },
  disabled: { id: 'admin.awsControl.state.disabled', defaultMessage: 'Disabled' },
  enabled: { id: 'admin.awsControl.state.enabled', defaultMessage: 'Enabled' },
  failedToLoad: { id: 'admin.awsControl.error.loadState', defaultMessage: 'Failed to load AWS control state' },
  failedToStart: { id: 'admin.awsControl.error.startStaging', defaultMessage: 'Failed to start staging' },
  failedToStop: { id: 'admin.awsControl.error.stopStaging', defaultMessage: 'Failed to stop staging' },
  generatedAt: { id: 'admin.awsControl.targets.generatedAt', defaultMessage: 'Generated {timestamp}' },
  guardrails: { id: 'admin.awsControl.guardrails.eyebrow', defaultMessage: 'Guardrails' },
  heroEyebrow: { id: 'admin.awsControl.eyebrow', defaultMessage: 'AWS operations' },
  limitLine: { id: 'admin.awsControl.guardrails.limit', defaultMessage: 'Limit: {limit}' },
  loading: { id: 'admin.awsControl.loading', defaultMessage: 'Loading AWS control plane...' },
  monthCost: { id: 'admin.awsControl.stat.monthCost', defaultMessage: 'Month cost' },
  mutationsEnabled: { id: 'admin.awsControl.target.mutationsEnabled', defaultMessage: 'Mutations enabled' },
  noCostProfile: { id: 'admin.awsControl.target.noCostProfile', defaultMessage: 'no cost profile' },
  noCostRows: { id: 'admin.awsControl.cost.noRows', defaultMessage: 'No non-zero service costs reported for the current Cost Explorer window.' },
  noTargetConfigured: { id: 'admin.awsControl.stat.noTargetConfigured', defaultMessage: 'No target configured' },
  notAvailable: { id: 'admin.awsControl.value.notAvailable', defaultMessage: 'not available' },
  notAvailableShort: { id: 'admin.awsControl.value.notAvailableShort', defaultMessage: 'n/a' },
  notConfigured: { id: 'admin.awsControl.value.notConfigured', defaultMessage: 'not configured' },
  notResolved: { id: 'admin.awsControl.value.notResolved', defaultMessage: 'not resolved' },
  operatorReason: { id: 'admin.awsControl.controls.operatorReason', defaultMessage: 'Operator reason' },
  operatorReasonPlaceholder: { id: 'admin.awsControl.controls.operatorReasonPlaceholder', defaultMessage: 'Why are you changing AWS state?' },
  operatorReasonRequired: { id: 'admin.awsControl.error.operatorReasonRequired', defaultMessage: 'Add an operator reason before changing AWS state' },
  production: { id: 'admin.awsControl.target.production', defaultMessage: 'Production' },
  productionLocked: { id: 'admin.awsControl.target.productionLocked', defaultMessage: 'Production start/stop requires server-side break-glass opt-in.' },
  productionMutationsDisabled: { id: 'admin.awsControl.stat.productionMutationsDisabled', defaultMessage: 'Production mutations disabled' },
  productionPosture: { id: 'admin.awsControl.targets.title', defaultMessage: 'Production and staging posture' },
  readOnly: { id: 'admin.awsControl.target.readOnly', defaultMessage: 'Read only' },
  refresh: { id: 'admin.awsControl.refresh', defaultMessage: 'Refresh AWS state' },
  region: { id: 'admin.awsControl.stat.region', defaultMessage: 'Region {region}' },
  scheduleLine: { id: 'admin.awsControl.guardrails.schedule', defaultMessage: 'Schedule: {schedule}' },
  scheduleStateLine: { id: 'admin.awsControl.guardrails.scheduleState', defaultMessage: 'Schedule state: {state}' },
  serverEnvMustOptIn: { id: 'admin.awsControl.stat.serverEnvMustOptIn', defaultMessage: 'Server env must opt in' },
  staging: { id: 'admin.awsControl.target.staging', defaultMessage: 'Staging' },
  stagingControls: { id: 'admin.awsControl.controls.eyebrow', defaultMessage: 'AWS controls' },
  stagingStartRequested: { id: 'admin.awsControl.success.startRequested', defaultMessage: 'Start staging requested' },
  stagingStopRequested: { id: 'admin.awsControl.success.stopRequested', defaultMessage: 'Stop staging requested' },
  startOrStopStaging: { id: 'admin.awsControl.controls.title', defaultMessage: 'Start or stop AWS target' },
  startStaging: { id: 'admin.awsControl.controls.start', defaultMessage: 'Start staging' },
  stopConfirmation: { id: 'admin.awsControl.controls.stopConfirmation', defaultMessage: 'Stop confirmation' },
  stopPhraseLeadIn: { id: 'admin.awsControl.controls.stopPhraseLeadIn', defaultMessage: 'Stopping the selected target requires the phrase' },
  stopStaging: { id: 'admin.awsControl.controls.stop', defaultMessage: 'Stop staging' },
  targetLine: { id: 'admin.awsControl.target.instanceLine', defaultMessage: 'Instance {instanceId} · Name {name}' },
  targetProfileLine: { id: 'admin.awsControl.target.profileLine', defaultMessage: '{instanceType} · {environment} · {costProfile}' },
  targets: { id: 'admin.awsControl.targets.eyebrow', defaultMessage: 'Targets' },
  title: { id: 'admin.awsControl.title', defaultMessage: 'AWS control center' },
  unknown: { id: 'admin.awsControl.value.unknown', defaultMessage: 'unknown' },
  unknownType: { id: 'admin.awsControl.target.unknownType', defaultMessage: 'unknown type' },
});

const formatUsd = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(numeric);
};

const stateTone = (state = '') => {
  const normalized = String(state || '').toLowerCase();
  if (normalized === 'running') return 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100';
  if (normalized === 'stopped') return 'border-amber-300/30 bg-amber-400/10 text-amber-100';
  if (['not_found', 'ambiguous', 'unknown'].includes(normalized)) return 'border-rose-300/30 bg-rose-400/10 text-rose-100';
  return 'border-slate-300/20 bg-slate-400/10 text-slate-100';
};

const AwsControl = () => {
  const intl = useIntl();
  const [control, setControl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [selectedTargetKey, setSelectedTargetKey] = useState('staging');
  const [reason, setReason] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');

  const loadControl = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const payload = await adminApi.getAwsControl();
      setControl(payload?.control || null);
    } catch (error) {
      toast.error(error?.message || intl.formatMessage(awsControlMessages.failedToLoad));
    } finally {
      setLoading(false);
    }
  }, [intl]);

  useEffect(() => {
    void loadControl();
  }, [loadControl]);

  const targets = Array.isArray(control?.targets) ? control.targets : [];
  const staging = targets.find((target) => target.target === 'staging') || null;
  const production = targets.find((target) => target.target === 'production') || null;
  const selectedTarget = targets.find((target) => target.target === selectedTargetKey) || staging || production || null;
  const selectedStopConfirmation = STOP_CONFIRMATION_BY_TARGET[selectedTarget?.target] || '';
  const services = control?.cost?.services || [];
  const budget = control?.guardrails?.budget || null;

  const stats = useMemo(() => {
    const unknown = intl.formatMessage(awsControlMessages.unknown);
    return [
      <AdminHeroStat
        key="enabled"
        label={intl.formatMessage(awsControlMessages.controlPlane)}
        value={control?.enabled ? intl.formatMessage(awsControlMessages.enabled) : intl.formatMessage(awsControlMessages.disabled)}
        detail={control?.enabled
          ? intl.formatMessage(awsControlMessages.region, { region: control.region || unknown })
          : control?.reason || intl.formatMessage(awsControlMessages.serverEnvMustOptIn)}
        icon={<Cloud className="h-5 w-5" />}
      />,
      <AdminHeroStat
        key="staging"
        label={intl.formatMessage(awsControlMessages.staging)}
        value={staging?.state || unknown}
        detail={staging?.instanceId || staging?.tagName || intl.formatMessage(awsControlMessages.noTargetConfigured)}
        icon={<Server className="h-5 w-5" />}
      />,
      <AdminHeroStat
        key="production"
        label={intl.formatMessage(awsControlMessages.production)}
        value={production?.state || unknown}
        detail={production?.mutationsEnabled
          ? intl.formatMessage(awsControlMessages.mutationsEnabled)
          : intl.formatMessage(awsControlMessages.productionMutationsDisabled)}
        icon={<ShieldCheck className="h-5 w-5" />}
      />,
      <AdminHeroStat
        key="cost"
        label={intl.formatMessage(awsControlMessages.monthCost)}
        value={formatUsd(control?.cost?.netUnblendedUsd)}
        detail={control?.cost?.available
          ? intl.formatMessage(awsControlMessages.costLines, { count: services.length })
          : control?.cost?.warning || intl.formatMessage(awsControlMessages.costExplorerUnavailable)}
        icon={<DollarSign className="h-5 w-5" />}
      />,
    ];
  }, [control, intl, production, services.length, staging]);

  const runAction = async (action) => {
    if (!reason.trim() || reason.trim().length < 8) {
      toast.error(intl.formatMessage(awsControlMessages.operatorReasonRequired));
      return;
    }

    const targetKey = selectedTarget?.target || 'staging';
    const targetLabel = selectedTarget?.label || targetKey;
    setBusy(`${targetKey}:${action}`);
    try {
      await adminApi.runAwsControlAction({
        target: targetKey,
        action,
        reason,
        confirmationPhrase,
      });
      toast.success(intl.formatMessage(
        action === 'start'
          ? awsControlMessages.stagingStartRequested
          : awsControlMessages.stagingStopRequested
      ));
      setReason('');
      setConfirmationPhrase('');
      await loadControl({ silent: true });
    } catch (error) {
      toast.error(error?.message || intl.formatMessage(
        action === 'start'
          ? awsControlMessages.failedToStart
          : awsControlMessages.failedToStop
      ));
    } finally {
      setBusy('');
    }
  };

  const renderTarget = (target) => (
    <AdminPremiumSubpanel key={target.target} className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-black text-white">{target.label}</h3>
            <span className={`rounded-full border px-2 py-1 text-xs font-black uppercase tracking-widest ${stateTone(target.state)}`}>
              {target.state || intl.formatMessage(awsControlMessages.unknown)}
            </span>
            {target.mutationsEnabled ? (
              <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-xs font-black uppercase tracking-widest text-emerald-100">
                <FormattedMessage {...awsControlMessages.mutationsEnabled} />
              </span>
            ) : (
              <span className="rounded-full border border-slate-300/20 bg-slate-400/10 px-2 py-1 text-xs font-black uppercase tracking-widest text-slate-200">
                <FormattedMessage {...awsControlMessages.readOnly} />
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-300">
            <FormattedMessage
              {...awsControlMessages.targetLine}
              values={{
                instanceId: target.instanceId || intl.formatMessage(awsControlMessages.notResolved),
                name: target.name || target.tagName || intl.formatMessage(awsControlMessages.notConfigured),
              }}
            />
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            <FormattedMessage
              {...awsControlMessages.targetProfileLine}
              values={{
                costProfile: target.costProfile || intl.formatMessage(awsControlMessages.noCostProfile),
                environment: target.environment || target.target,
                instanceType: target.instanceType || intl.formatMessage(awsControlMessages.unknownType),
              }}
            />
          </p>
          {target.warning ? <p className="mt-2 text-sm text-amber-200">{target.warning}</p> : null}
        </div>
        {target.target === 'production' && !target.mutationsEnabled ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm font-semibold text-amber-100">
            <FormattedMessage {...awsControlMessages.productionLocked} />
          </div>
        ) : null}
      </div>
    </AdminPremiumSubpanel>
  );

  return (
    <AdminPremiumShell
      eyebrow={intl.formatMessage(awsControlMessages.heroEyebrow)}
      title={intl.formatMessage(awsControlMessages.title)}
      description={intl.formatMessage(awsControlMessages.description)}
      stats={stats}
      actions={(
        <button
          type="button"
          onClick={() => loadControl({ silent: true })}
          className="admin-premium-button px-4 py-2 text-sm font-black"
          disabled={loading || Boolean(busy)}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <FormattedMessage {...awsControlMessages.refresh} />
        </button>
      )}
    >
      {loading ? (
        <AdminPremiumPanel>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <FormattedMessage {...awsControlMessages.loading} />
          </div>
        </AdminPremiumPanel>
      ) : null}

      {!loading && !control?.enabled ? (
        <AdminPremiumPanel>
          <div className="flex items-start gap-3 text-amber-100">
            <AlertTriangle className="mt-1 h-5 w-5" />
            <div>
              <h2 className="text-xl font-black text-white"><FormattedMessage {...awsControlMessages.controlPlaneDisabled} /></h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                <FormattedMessage {...awsControlMessages.controlPlaneDisabledDescription} />
              </p>
            </div>
          </div>
        </AdminPremiumPanel>
      ) : null}

      {!loading && control ? (
        <div className="grid gap-6 xl:grid-cols-3">
          <AdminPremiumPanel className="space-y-4 xl:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="premium-kicker"><FormattedMessage {...awsControlMessages.targets} /></p>
                <h2 className="mt-2 text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.productionPosture} /></h2>
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                <FormattedMessage
                  {...awsControlMessages.generatedAt}
                  values={{ timestamp: control.generatedAt || intl.formatMessage(awsControlMessages.notAvailableShort) }}
                />
              </span>
            </div>
            <div className="grid gap-3">
              {targets.map(renderTarget)}
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4">
            <p className="premium-kicker"><FormattedMessage {...awsControlMessages.stagingControls} /></p>
            <h2 className="text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.startOrStopStaging} /></h2>
            <p className="text-sm leading-6 text-slate-300">
              <FormattedMessage {...awsControlMessages.stopPhraseLeadIn} /> <strong>{selectedStopConfirmation || 'STOP TARGET'}</strong>.
            </p>
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              Target
              <select
                value={selectedTarget?.target || 'staging'}
                onChange={(event) => {
                  setSelectedTargetKey(event.target.value);
                  setConfirmationPhrase('');
                }}
                className="admin-premium-control"
              >
                {targets.map((target) => (
                  <option key={target.target} value={target.target}>
                    {target.label || target.target}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              <FormattedMessage {...awsControlMessages.operatorReason} />
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="admin-premium-control min-h-24"
                placeholder={intl.formatMessage(awsControlMessages.operatorReasonPlaceholder)}
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              <FormattedMessage {...awsControlMessages.stopConfirmation} />
              <input
                value={confirmationPhrase}
                onChange={(event) => setConfirmationPhrase(event.target.value)}
                className="admin-premium-control"
                placeholder={selectedStopConfirmation}
              />
            </label>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => runAction('start')}
                disabled={busy === `${selectedTarget?.target}:start` || !selectedTarget?.allowedActions?.includes('start')}
                className="admin-premium-button admin-premium-button-success"
              >
                {busy === `${selectedTarget?.target}:start` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {`Start ${selectedTarget?.label || selectedTarget?.target || 'target'}`}
              </button>
              <button
                type="button"
                onClick={() => runAction('stop')}
                disabled={busy === `${selectedTarget?.target}:stop` || !selectedTarget?.allowedActions?.includes('stop')}
                className="admin-premium-button admin-premium-button-danger"
              >
                {busy === `${selectedTarget?.target}:stop` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                {`Stop ${selectedTarget?.label || selectedTarget?.target || 'target'}`}
              </button>
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4 xl:col-span-2">
            <p className="premium-kicker"><FormattedMessage {...awsControlMessages.costWatch} /></p>
            <h2 className="text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.currentMonthSpend} /></h2>
            <div className="grid gap-3 md:grid-cols-2">
              {services.length ? services.map((entry) => (
                <AdminPremiumSubpanel key={entry.service} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-200">{entry.service}</span>
                  <span className="text-lg font-black text-white">{formatUsd(entry.usd)}</span>
                </AdminPremiumSubpanel>
              )) : (
                <AdminPremiumSubpanel className="text-sm text-slate-300">
                  {control?.cost?.warning || intl.formatMessage(awsControlMessages.noCostRows)}
                </AdminPremiumSubpanel>
              )}
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4">
            <p className="premium-kicker"><FormattedMessage {...awsControlMessages.guardrails} /></p>
            <h2 className="text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.budgetAndExpiration} /></h2>
            <div className="space-y-3 text-sm text-slate-300">
              <p>
                <FormattedMessage
                  {...awsControlMessages.budgetLine}
                  values={{ name: <strong className="text-white">{budget?.name || intl.formatMessage(awsControlMessages.notAvailable)}</strong> }}
                />
              </p>
              <p>
                <FormattedMessage
                  {...awsControlMessages.limitLine}
                  values={{ limit: <strong className="text-white">{formatUsd(budget?.limitUsd)}</strong> }}
                />
              </p>
              <p>
                <FormattedMessage
                  {...awsControlMessages.scheduleLine}
                  values={{
                    schedule: (
                      <strong className="text-white">
                        {control?.guardrails?.expirationSchedule?.scheduleExpression || intl.formatMessage(awsControlMessages.notAvailable)}
                      </strong>
                    ),
                  }}
                />
              </p>
              <p>
                <FormattedMessage
                  {...awsControlMessages.scheduleStateLine}
                  values={{
                    state: (
                      <strong className="text-white">
                        {control?.guardrails?.expirationSchedule?.state || intl.formatMessage(awsControlMessages.unknown)}
                      </strong>
                    ),
                  }}
                />
              </p>
              {control?.guardrails?.budget?.warning ? <p className="text-amber-200">{control.guardrails.budget.warning}</p> : null}
              {control?.guardrails?.expirationSchedule?.warning ? <p className="text-amber-200">{control.guardrails.expirationSchedule.warning}</p> : null}
            </div>
          </AdminPremiumPanel>
        </div>
      ) : null}
    </AdminPremiumShell>
  );
};

export default AwsControl;
