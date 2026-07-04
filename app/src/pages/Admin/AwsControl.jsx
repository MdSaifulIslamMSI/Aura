import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  DollarSign,
  KeyRound,
  Loader2,
  LockKeyhole,
  Power,
  RefreshCw,
  Route,
  Server,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  Workflow,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { defineMessages, FormattedMessage, useIntl } from 'react-intl';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel, AdminPremiumSubpanel } from '@/components/shared/AdminPremiumShell';
import { adminApi, authApi } from '@/services/api';
import { isDuoStepUpRequiredError } from '@/utils/authStepUp';

const STOP_CONFIRMATION_BY_TARGET = Object.freeze({
  staging: 'STOP STAGING',
  production: 'STOP PRODUCTION',
});

const awsControlMessages = defineMessages({
  actionRequested: { id: 'admin.awsControl.success.actionRequested', defaultMessage: '{action} {target} requested' },
  allowedApis: { id: 'admin.awsControl.identity.allowedApis', defaultMessage: 'Allowed AWS APIs' },
  awsIdentity: { id: 'admin.awsControl.identity.title', defaultMessage: 'AWS identity and boundary' },
  awsRuntime: { id: 'admin.awsControl.runtime.title', defaultMessage: 'Runtime and deploy path' },
  blastRadius: { id: 'admin.awsControl.operations.blastRadius', defaultMessage: 'Blast radius' },
  browserCredentialsBlocked: { id: 'admin.awsControl.identity.browserCredentialsBlocked', defaultMessage: 'Browser credentials blocked' },
  budgetAndExpiration: { id: 'admin.awsControl.guardrails.title', defaultMessage: 'Budget and expiration' },
  budgetActions: { id: 'admin.awsControl.guardrails.budgetActions', defaultMessage: 'Budget actions' },
  budgetLine: { id: 'admin.awsControl.guardrails.budget', defaultMessage: 'Budget: {name}' },
  cloudWatchAlarms: { id: 'admin.awsControl.intelligence.cloudWatchAlarms', defaultMessage: 'CloudWatch alarms' },
  commandPlan: { id: 'admin.awsControl.operations.commandPlan', defaultMessage: 'Command plan' },
  confirmationPhraseRequired: { id: 'admin.awsControl.error.confirmationPhraseRequired', defaultMessage: 'Type {phrase} before running this AWS action' },
  controlPlane: { id: 'admin.awsControl.stat.controlPlane', defaultMessage: 'Control plane' },
  controlPlaneDisabled: { id: 'admin.awsControl.disabled.title', defaultMessage: 'AWS control plane is not enabled on this backend' },
  controlPlaneDisabledDescription: {
    id: 'admin.awsControl.disabled.description',
    defaultMessage: 'Set server-side AWS control environment variables to enable live status and guarded controls. Browser clients never receive AWS credentials.',
  },
  controlTarget: { id: 'admin.awsControl.controls.target', defaultMessage: 'Target' },
  costExplorerUnavailable: { id: 'admin.awsControl.cost.unavailable', defaultMessage: 'Cost Explorer unavailable' },
  costLines: { id: 'admin.awsControl.cost.lines', defaultMessage: '{count, plural, one {# cost line} other {# cost lines}}' },
  costWatch: { id: 'admin.awsControl.cost.title', defaultMessage: 'Cost watch' },
  credentialBoundary: { id: 'admin.awsControl.identity.credentialBoundary', defaultMessage: 'Credential boundary' },
  currentMonthSpend: { id: 'admin.awsControl.cost.currentMonthSpend', defaultMessage: 'Current month AWS spend' },
  description: {
    id: 'admin.awsControl.description',
    defaultMessage: 'Admin-only visibility and guarded controls for Aura AWS infrastructure. Production actions require explicit server-side break-glass opt-in and exact confirmation when armed.',
  },
  disabled: { id: 'admin.awsControl.state.disabled', defaultMessage: 'Disabled' },
  deployPath: { id: 'admin.awsControl.runtime.deployPath', defaultMessage: 'Deploy path' },
  duoStepUpBody: {
    id: 'admin.awsControl.stepUp.duo.body',
    defaultMessage: 'Complete Duo verification, return here, then retry the guarded AWS action. The backend will still reject the action until this browser session has fresh Duo assurance.',
  },
  duoStepUpCta: { id: 'admin.awsControl.stepUp.duo.cta', defaultMessage: 'Complete Duo verification' },
  duoStepUpTitle: { id: 'admin.awsControl.stepUp.duo.title', defaultMessage: 'Duo step-up verification required' },
  enabled: { id: 'admin.awsControl.state.enabled', defaultMessage: 'Enabled' },
  ec2StatusChecks: { id: 'admin.awsControl.intelligence.ec2StatusChecks', defaultMessage: 'EC2 status checks' },
  exactPhrase: { id: 'admin.awsControl.operations.exactPhrase', defaultMessage: 'Exact phrase' },
  failedToLoad: { id: 'admin.awsControl.error.loadState', defaultMessage: 'Failed to load AWS control state' },
  failedToStart: { id: 'admin.awsControl.error.startStaging', defaultMessage: 'Failed to start AWS target' },
  failedToStop: { id: 'admin.awsControl.error.stopStaging', defaultMessage: 'Failed to stop AWS target' },
  generatedAt: { id: 'admin.awsControl.targets.generatedAt', defaultMessage: 'Generated {timestamp}' },
  guardrails: { id: 'admin.awsControl.guardrails.eyebrow', defaultMessage: 'Guardrails' },
  guardStatus: { id: 'admin.awsControl.identity.guardStatus', defaultMessage: 'Guard status' },
  heroEyebrow: { id: 'admin.awsControl.eyebrow', defaultMessage: 'AWS operations' },
  limitLine: { id: 'admin.awsControl.guardrails.limit', defaultMessage: 'Limit: {limit}' },
  liveAllowlisted: { id: 'admin.awsControl.operations.liveAllowlisted', defaultMessage: 'Live allowlisted' },
  liveReadOnlyIntelligence: { id: 'admin.awsControl.intelligence.title', defaultMessage: 'Live read-only intelligence' },
  locked: { id: 'admin.awsControl.state.locked', defaultMessage: 'Locked' },
  loading: { id: 'admin.awsControl.loading', defaultMessage: 'Loading AWS control plane...' },
  monthCost: { id: 'admin.awsControl.stat.monthCost', defaultMessage: 'Month cost' },
  mutationGate: { id: 'admin.awsControl.operations.mutationGate', defaultMessage: 'Mutation gate' },
  mutationsEnabled: { id: 'admin.awsControl.target.mutationsEnabled', defaultMessage: 'Mutations enabled' },
  noCostProfile: { id: 'admin.awsControl.target.noCostProfile', defaultMessage: 'no cost profile' },
  noCostRows: { id: 'admin.awsControl.cost.noRows', defaultMessage: 'No non-zero service costs reported for the current Cost Explorer window.' },
  noRecentCommands: { id: 'admin.awsControl.intelligence.noRecentCommands', defaultMessage: 'No recent SSM commands reported.' },
  noActiveAlarms: { id: 'admin.awsControl.intelligence.noActiveAlarms', defaultMessage: 'No active CloudWatch alarms reported.' },
  noRunbooks: { id: 'admin.awsControl.runtime.noRunbooks', defaultMessage: 'No runbooks reported' },
  noTargetConfigured: { id: 'admin.awsControl.stat.noTargetConfigured', defaultMessage: 'No target configured' },
  notAvailable: { id: 'admin.awsControl.value.notAvailable', defaultMessage: 'not available' },
  notAvailableShort: { id: 'admin.awsControl.value.notAvailableShort', defaultMessage: 'n/a' },
  notConfigured: { id: 'admin.awsControl.value.notConfigured', defaultMessage: 'not configured' },
  notResolved: { id: 'admin.awsControl.value.notResolved', defaultMessage: 'not resolved' },
  operatorReason: { id: 'admin.awsControl.controls.operatorReason', defaultMessage: 'Operator reason' },
  operatorReasonPlaceholder: { id: 'admin.awsControl.controls.operatorReasonPlaceholder', defaultMessage: 'Why are you changing AWS state?' },
  operatorReasonRequired: { id: 'admin.awsControl.error.operatorReasonRequired', defaultMessage: 'Add an operator reason before changing AWS state' },
  parameterStore: { id: 'admin.awsControl.runtime.parameterStore', defaultMessage: 'Parameter Store' },
  parameterStorePrefix: { id: 'admin.awsControl.runtime.parameterStorePrefix', defaultMessage: 'Prefix {prefix}' },
  production: { id: 'admin.awsControl.target.production', defaultMessage: 'Production' },
  productionLocked: { id: 'admin.awsControl.target.productionLocked', defaultMessage: 'Production start/stop requires server-side break-glass opt-in.' },
  productionMutationsDisabled: { id: 'admin.awsControl.stat.productionMutationsDisabled', defaultMessage: 'Production mutations disabled' },
  productionPosture: { id: 'admin.awsControl.targets.title', defaultMessage: 'Production and staging posture' },
  readOnly: { id: 'admin.awsControl.target.readOnly', defaultMessage: 'Read only' },
  requiresRecentAuth: { id: 'admin.awsControl.identity.requiresRecentAuth', defaultMessage: 'Recent sensitive-action step-up required' },
  refresh: { id: 'admin.awsControl.refresh', defaultMessage: 'Refresh AWS state' },
  region: { id: 'admin.awsControl.stat.region', defaultMessage: 'Region {region}' },
  routeGuard: { id: 'admin.awsControl.identity.routeGuard', defaultMessage: 'Route guard' },
  runbooks: { id: 'admin.awsControl.runtime.runbooks', defaultMessage: 'Runbooks' },
  scheduleLine: { id: 'admin.awsControl.guardrails.schedule', defaultMessage: 'Schedule: {schedule}' },
  scheduleStateLine: { id: 'admin.awsControl.guardrails.scheduleState', defaultMessage: 'Schedule state: {state}' },
  serverEnvMustOptIn: { id: 'admin.awsControl.stat.serverEnvMustOptIn', defaultMessage: 'Server env must opt in' },
  selector: { id: 'admin.awsControl.operations.selector', defaultMessage: 'Selector' },
  serverOnly: { id: 'admin.awsControl.identity.serverOnly', defaultMessage: 'Server only' },
  ssmCommandHistory: { id: 'admin.awsControl.intelligence.ssmCommandHistory', defaultMessage: 'SSM command history' },
  ssmManagedInstances: { id: 'admin.awsControl.intelligence.ssmManagedInstances', defaultMessage: 'SSM managed instances' },
  ssmAgentVersion: { id: 'admin.awsControl.intelligence.ssmAgentVersion', defaultMessage: 'agent {version}' },
  staging: { id: 'admin.awsControl.target.staging', defaultMessage: 'Staging' },
  stagingControls: { id: 'admin.awsControl.controls.eyebrow', defaultMessage: 'AWS controls' },
  startOrStopStaging: { id: 'admin.awsControl.controls.title', defaultMessage: 'Start or stop AWS target' },
  startTarget: { id: 'admin.awsControl.controls.startTarget', defaultMessage: 'Start {target}' },
  stopConfirmation: { id: 'admin.awsControl.controls.stopConfirmation', defaultMessage: 'Stop confirmation' },
  stopTarget: { id: 'admin.awsControl.controls.stopTarget', defaultMessage: 'Stop {target}' },
  targetLine: { id: 'admin.awsControl.target.instanceLine', defaultMessage: 'Instance {instanceId} · Name {name}' },
  targetProfileLine: { id: 'admin.awsControl.target.profileLine', defaultMessage: '{instanceType} · {environment} · {costProfile}' },
  targets: { id: 'admin.awsControl.targets.eyebrow', defaultMessage: 'Targets' },
  title: { id: 'admin.awsControl.title', defaultMessage: 'AWS control center' },
  topology: { id: 'admin.awsControl.runtime.topology', defaultMessage: 'Topology' },
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

const gateTone = (state = '') => {
  const normalized = String(state || '').toLowerCase();
  if (['armed', 'enabled', 'live_allowlisted'].includes(normalized)) return 'border-rose-300/35 bg-rose-400/10 text-rose-100';
  if (['alarm', 'failed', 'failure', 'impaired', 'offline', 'timedout', 'cancelled'].includes(normalized)) return 'border-rose-300/35 bg-rose-400/10 text-rose-100';
  if (['ok', 'online', 'success', 'passed', 'healthy'].includes(normalized)) return 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100';
  if (['pending', 'inprogress', 'delayed', 'standby'].includes(normalized)) return 'border-amber-300/30 bg-amber-400/10 text-amber-100';
  if (['blocked', 'locked', 'disabled'].includes(normalized)) return 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100';
  if (['dry_run', 'ci_controlled'].includes(normalized)) return 'border-amber-300/30 bg-amber-400/10 text-amber-100';
  if (['enforced'].includes(normalized)) return 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100';
  return 'border-slate-300/20 bg-slate-400/10 text-slate-100';
};

const actionTone = (plan = {}) => {
  if (plan.enabled) return 'border-rose-300/35 bg-rose-400/10 text-rose-100';
  if (plan.executionMode === 'locked_read_only') return 'border-slate-300/20 bg-slate-400/10 text-slate-200';
  return 'border-amber-300/30 bg-amber-400/10 text-amber-100';
};

const getActionPlan = (target, action) => (
  Array.isArray(target?.operationPlan?.actions)
    ? target.operationPlan.actions.find((entry) => entry.action === action) || null
    : null
);

const formatSelector = (selector = {}) => {
  if (!selector?.value) return 'not resolved';
  return selector.type === 'instance_id'
    ? selector.value
    : `${selector.type || 'selector'}:${selector.value}`;
};

const displayState = (state = '') => {
  const normalized = String(state || '').trim();
  if (!normalized) return 'unknown';
  return normalized.replace(/_/g, ' ');
};

const AwsControl = () => {
  const intl = useIntl();
  const [control, setControl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [selectedTargetKey, setSelectedTargetKey] = useState('staging');
  const [reason, setReason] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [duoStepUpRequired, setDuoStepUpRequired] = useState(null);

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
  const selectedStartPlan = getActionPlan(selectedTarget, 'start');
  const selectedStopPlan = getActionPlan(selectedTarget, 'stop');
  const services = control?.cost?.services || [];
  const budget = control?.guardrails?.budget || null;
  const budgetActions = Array.isArray(control?.guardrails?.budgetActions) ? control.guardrails.budgetActions : [];
  const riskGates = Array.isArray(control?.riskGates) ? control.riskGates : [];
  const runbooks = Array.isArray(control?.deployment?.runbooks) ? control.deployment.runbooks : [];
  const topology = Array.isArray(control?.deployment?.topology) ? control.deployment.topology : [];
  const allowedAwsApis = Array.isArray(control?.securityBoundary?.allowedAwsApis) ? control.securityBoundary.allowedAwsApis : [];
  const parameterStore = control?.parameterStore || null;
  const readOnlyIntelligence = control?.readOnlyIntelligence || {};
  const ec2Checks = Array.isArray(readOnlyIntelligence?.ec2Status?.checks) ? readOnlyIntelligence.ec2Status.checks : [];
  const ssmManagedInstances = Array.isArray(readOnlyIntelligence?.ssmManagedInstances?.instances) ? readOnlyIntelligence.ssmManagedInstances.instances : [];
  const ssmCommands = Array.isArray(readOnlyIntelligence?.ssmCommandHistory?.commands) ? readOnlyIntelligence.ssmCommandHistory.commands : [];
  const activeAlarms = Array.isArray(readOnlyIntelligence?.cloudWatchAlarms?.activeAlarms) ? readOnlyIntelligence.cloudWatchAlarms.activeAlarms : [];
  const confirmationHints = [
    selectedStartPlan?.confirmationPhrase,
    selectedStopPlan?.confirmationPhrase,
  ].filter(Boolean);
  const confirmationPlaceholder = confirmationHints.join(' / ') || selectedStopConfirmation || STOP_CONFIRMATION_BY_TARGET.staging;

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

  const getRequiredConfirmationPhrase = (action) => {
    const plan = getActionPlan(selectedTarget, action);
    return plan?.confirmationPhrase || (action === 'stop' ? selectedStopConfirmation : '');
  };

  const canRunAction = (action) => {
    const plan = getActionPlan(selectedTarget, action);
    return Boolean(
      selectedTarget?.allowedActions?.includes(action)
      && (plan ? plan.enabled : true)
    );
  };

  const runAction = async (action) => {
    if (!reason.trim() || reason.trim().length < 8) {
      toast.error(intl.formatMessage(awsControlMessages.operatorReasonRequired));
      return;
    }

    const targetKey = selectedTarget?.target || 'staging';
    const targetLabel = selectedTarget?.label || targetKey;
    const requiredPhrase = getRequiredConfirmationPhrase(action);
    if (requiredPhrase && confirmationPhrase.trim() !== requiredPhrase) {
      toast.error(intl.formatMessage(awsControlMessages.confirmationPhraseRequired, { phrase: requiredPhrase }));
      return;
    }

    setBusy(`${targetKey}:${action}`);
    try {
      await adminApi.runAwsControlAction({
        target: targetKey,
        action,
        reason,
        confirmationPhrase,
      });
      toast.success(intl.formatMessage(awsControlMessages.actionRequested, {
        action,
        target: targetLabel,
      }));
      setReason('');
      setConfirmationPhrase('');
      setDuoStepUpRequired(null);
      await loadControl({ silent: true });
    } catch (error) {
      if (isDuoStepUpRequiredError(error)) {
        setDuoStepUpRequired({
          action: 'admin-sensitive',
          message: error?.message || intl.formatMessage(awsControlMessages.duoStepUpTitle),
        });
        toast.error(error?.message || intl.formatMessage(awsControlMessages.duoStepUpTitle));
        return;
      }
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
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-black/15 p-3">
          <p className="text-[0.65rem] font-black uppercase tracking-widest text-slate-500">
            <FormattedMessage {...awsControlMessages.selector} />
          </p>
          <p className="mt-2 break-words text-sm font-bold text-slate-100">
            {formatSelector(target.operationPlan?.selector)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/15 p-3">
          <p className="text-[0.65rem] font-black uppercase tracking-widest text-slate-500">
            <FormattedMessage {...awsControlMessages.mutationGate} />
          </p>
          <p className="mt-2 break-words text-sm font-bold text-slate-100">
            {target.operationPlan?.mutationGateEnv || intl.formatMessage(awsControlMessages.notAvailable)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/15 p-3">
          <p className="text-[0.65rem] font-black uppercase tracking-widest text-slate-500">
            <FormattedMessage {...awsControlMessages.blastRadius} />
          </p>
          <p className="mt-2 text-sm font-semibold leading-5 text-slate-300">
            {target.operationPlan?.blastRadius || intl.formatMessage(awsControlMessages.notAvailable)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {(target.operationPlan?.actions || []).map((plan) => (
          <span
            key={`${target.target}:${plan.action}`}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest ${actionTone(plan)}`}
          >
            {plan.enabled ? <Zap className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
            {plan.awsApi}
            {plan.requiresConfirmationPhrase ? ` · ${plan.confirmationPhrase}` : ''}
          </span>
        ))}
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
            <AdminPremiumSubpanel className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <TerminalSquare className="h-4 w-4 text-cyan-200" />
                <FormattedMessage {...awsControlMessages.commandPlan} />
              </div>
              <div className="grid gap-2">
                {[selectedStartPlan, selectedStopPlan].filter(Boolean).map((plan) => (
                  <div key={plan.action} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <span className="text-xs font-black uppercase tracking-widest text-slate-300">{plan.awsApi}</span>
                    <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${actionTone(plan)}`}>
                      {plan.executionMode === 'live_allowlisted'
                        ? intl.formatMessage(awsControlMessages.liveAllowlisted)
                        : intl.formatMessage(awsControlMessages.locked)}
                    </span>
                    {plan.confirmationPhrase ? (
                      <span className="basis-full text-xs font-semibold text-amber-100">
                        <FormattedMessage {...awsControlMessages.exactPhrase} />: {plan.confirmationPhrase}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </AdminPremiumSubpanel>
            {duoStepUpRequired ? (
              <AdminPremiumSubpanel className="space-y-3 border-amber-300/30 bg-amber-400/10">
                <div className="flex items-start gap-3 text-amber-100">
                  <ShieldAlert className="mt-0.5 h-5 w-5" />
                  <div>
                    <h3 className="text-sm font-black text-white">
                      <FormattedMessage {...awsControlMessages.duoStepUpTitle} />
                    </h3>
                    <p className="mt-2 text-sm font-semibold leading-6 text-slate-200">
                      <FormattedMessage {...awsControlMessages.duoStepUpBody} />
                    </p>
                    {duoStepUpRequired.message ? (
                      <p className="mt-2 text-xs font-semibold text-amber-100">{duoStepUpRequired.message}</p>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  className="admin-premium-button w-full px-4 py-2 text-sm font-black"
                  onClick={() => authApi.startDuoStepUp({
                    action: duoStepUpRequired.action,
                    returnTo: '/admin/aws-control',
                  })}
                >
                  <ShieldCheck className="h-4 w-4" />
                  <FormattedMessage {...awsControlMessages.duoStepUpCta} />
                </button>
              </AdminPremiumSubpanel>
            ) : null}
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              <FormattedMessage {...awsControlMessages.controlTarget} />
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
                placeholder={confirmationPlaceholder}
              />
            </label>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => runAction('start')}
                disabled={busy === `${selectedTarget?.target}:start` || !canRunAction('start')}
                className="admin-premium-button admin-premium-button-success"
              >
                {busy === `${selectedTarget?.target}:start` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                <FormattedMessage
                  {...awsControlMessages.startTarget}
                  values={{ target: selectedTarget?.label || selectedTarget?.target || intl.formatMessage(awsControlMessages.notResolved) }}
                />
              </button>
              <button
                type="button"
                onClick={() => runAction('stop')}
                disabled={busy === `${selectedTarget?.target}:stop` || !canRunAction('stop')}
                className="admin-premium-button admin-premium-button-danger"
              >
                {busy === `${selectedTarget?.target}:stop` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                <FormattedMessage
                  {...awsControlMessages.stopTarget}
                  values={{ target: selectedTarget?.label || selectedTarget?.target || intl.formatMessage(awsControlMessages.notResolved) }}
                />
              </button>
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4">
            <p className="premium-kicker"><FormattedMessage {...awsControlMessages.serverOnly} /></p>
            <h2 className="text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.awsIdentity} /></h2>
            <div className="grid gap-3">
              <AdminPremiumSubpanel className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <KeyRound className="h-4 w-4 text-cyan-200" />
                  <FormattedMessage {...awsControlMessages.credentialBoundary} />
                </div>
                <p className="break-words text-sm font-semibold text-slate-300">
                  {control?.securityBoundary?.credentialBoundary || intl.formatMessage(awsControlMessages.notAvailable)}
                </p>
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest ${gateTone('blocked')}`}>
                  <LockKeyhole className="h-3.5 w-3.5" />
                  <FormattedMessage {...awsControlMessages.browserCredentialsBlocked} />
                </div>
              </AdminPremiumSubpanel>
              <AdminPremiumSubpanel className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <ShieldAlert className="h-4 w-4 text-amber-200" />
                  <FormattedMessage {...awsControlMessages.routeGuard} />
                </div>
                <p className="break-words text-sm font-semibold text-slate-300">
                  {control?.securityBoundary?.actionRouteGuard || intl.formatMessage(awsControlMessages.requiresRecentAuth)}
                </p>
              </AdminPremiumSubpanel>
              <AdminPremiumSubpanel className="space-y-3">
                <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.guardStatus} /></p>
                <div className="grid gap-2">
                  {riskGates.map((gate) => (
                    <div key={gate.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-300">{gate.label}</span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(gate.state)}`}>
                        {displayState(gate.state)}
                      </span>
                    </div>
                  ))}
                </div>
              </AdminPremiumSubpanel>
              <AdminPremiumSubpanel className="space-y-2">
                <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.allowedApis} /></p>
                <div className="flex flex-wrap gap-2">
                  {allowedAwsApis.map((apiName) => (
                    <span key={apiName} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs font-bold text-slate-200">
                      {apiName}
                    </span>
                  ))}
                </div>
              </AdminPremiumSubpanel>
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4 xl:col-span-2">
            <p className="premium-kicker"><FormattedMessage {...awsControlMessages.topology} /></p>
            <h2 className="text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.awsRuntime} /></h2>
            <div className="flex flex-wrap gap-2">
              {topology.map((item) => (
                <span key={item} className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-cyan-100">
                  <Activity className="h-3.5 w-3.5" />
                  {item}
                </span>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <AdminPremiumSubpanel className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Workflow className="h-4 w-4 text-cyan-200" />
                  <FormattedMessage {...awsControlMessages.deployPath} />
                </div>
                <p className="text-sm font-semibold leading-6 text-slate-300">
                  {control?.deployment?.deployPath || intl.formatMessage(awsControlMessages.notAvailable)}
                </p>
              </AdminPremiumSubpanel>
              <AdminPremiumSubpanel className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Route className="h-4 w-4 text-cyan-200" />
                  <FormattedMessage {...awsControlMessages.parameterStore} />
                </div>
                <p className="text-sm font-semibold leading-6 text-slate-300">
                  <FormattedMessage
                    {...awsControlMessages.parameterStorePrefix}
                    values={{ prefix: parameterStore?.pathPrefix || intl.formatMessage(awsControlMessages.notConfigured) }}
                  />
                </p>
                <p className="text-xs font-semibold text-slate-500">
                  {parameterStore?.storage || intl.formatMessage(awsControlMessages.notAvailable)}
                </p>
              </AdminPremiumSubpanel>
            </div>
            <AdminPremiumSubpanel className="space-y-3">
              <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.runbooks} /></p>
              <div className="grid gap-2">
                {runbooks.length ? runbooks.map((runbook) => (
                  <div key={runbook.key} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-300">{runbook.label}</span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(runbook.mode)}`}>
                        {displayState(runbook.mode)}
                      </span>
                    </div>
                    <p className="mt-2 break-words text-xs font-semibold text-slate-500">{runbook.command}</p>
                  </div>
                )) : (
                  <p className="text-sm text-slate-300"><FormattedMessage {...awsControlMessages.noRunbooks} /></p>
                )}
              </div>
            </AdminPremiumSubpanel>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4 xl:col-span-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="premium-kicker"><FormattedMessage {...awsControlMessages.serverOnly} /></p>
                <h2 className="mt-2 text-2xl font-black text-white"><FormattedMessage {...awsControlMessages.liveReadOnlyIntelligence} /></h2>
              </div>
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest ${readOnlyIntelligence.enabled ? gateTone('ok') : gateTone('locked')}`}>
                <Activity className="h-3.5 w-3.5" />
                {readOnlyIntelligence.enabled ? intl.formatMessage(awsControlMessages.enabled) : intl.formatMessage(awsControlMessages.disabled)}
              </span>
            </div>
            <div className="grid gap-3 xl:grid-cols-4">
              <AdminPremiumSubpanel className="space-y-3">
                <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.ec2StatusChecks} /></p>
                {ec2Checks.length ? ec2Checks.map((check) => (
                  <div key={check.instanceId} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all text-xs font-black uppercase tracking-widest text-slate-300">{check.instanceId}</span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(check.instanceStatus)}`}>
                        {displayState(check.instanceStatus)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      system {displayState(check.systemStatus)} - {check.availabilityZone || intl.formatMessage(awsControlMessages.notAvailableShort)}
                    </p>
                  </div>
                )) : (
                  <p className="text-sm text-slate-300">
                    {readOnlyIntelligence?.ec2Status?.warning || readOnlyIntelligence?.ec2Status?.reason || intl.formatMessage(awsControlMessages.notAvailable)}
                  </p>
                )}
              </AdminPremiumSubpanel>

              <AdminPremiumSubpanel className="space-y-3">
                <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.ssmManagedInstances} /></p>
                {ssmManagedInstances.length ? ssmManagedInstances.map((instance) => (
                  <div key={instance.instanceId} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all text-xs font-black uppercase tracking-widest text-slate-300">{instance.instanceId}</span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(instance.pingStatus)}`}>
                        {displayState(instance.pingStatus)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      {instance.platformName || instance.platformType || intl.formatMessage(awsControlMessages.notAvailable)} - {intl.formatMessage(awsControlMessages.ssmAgentVersion, { version: instance.agentVersion || intl.formatMessage(awsControlMessages.notAvailableShort) })}
                    </p>
                  </div>
                )) : (
                  <p className="text-sm text-slate-300">
                    {readOnlyIntelligence?.ssmManagedInstances?.warning || readOnlyIntelligence?.ssmManagedInstances?.reason || intl.formatMessage(awsControlMessages.notAvailable)}
                  </p>
                )}
              </AdminPremiumSubpanel>

              <AdminPremiumSubpanel className="space-y-3">
                <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.ssmCommandHistory} /></p>
                {ssmCommands.length ? ssmCommands.slice(0, 6).map((command) => (
                  <div key={`${command.instanceId}:${command.commandId}`} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all text-xs font-black uppercase tracking-widest text-slate-300">{command.documentName || command.commandId}</span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(command.status)}`}>
                        {displayState(command.status)}
                      </span>
                    </div>
                    <p className="mt-2 break-all text-xs font-semibold text-slate-500">
                      {command.commandId} - {command.instanceId}
                    </p>
                    {command.requestedDateTime ? <p className="mt-1 text-xs font-semibold text-slate-500">{command.requestedDateTime}</p> : null}
                  </div>
                )) : (
                  <p className="text-sm text-slate-300">
                    {readOnlyIntelligence?.ssmCommandHistory?.warnings?.[0]?.warning || readOnlyIntelligence?.ssmCommandHistory?.reason || intl.formatMessage(awsControlMessages.noRecentCommands)}
                  </p>
                )}
              </AdminPremiumSubpanel>

              <AdminPremiumSubpanel className="space-y-3">
                <p className="text-sm font-black text-white"><FormattedMessage {...awsControlMessages.cloudWatchAlarms} /></p>
                {activeAlarms.length ? activeAlarms.map((alarm) => (
                  <div key={`${alarm.type}:${alarm.name}`} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-words text-xs font-black uppercase tracking-widest text-slate-300">{alarm.name}</span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(alarm.state)}`}>
                        {displayState(alarm.state)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-400">
                      {alarm.metricName || alarm.type || intl.formatMessage(awsControlMessages.notAvailable)}
                    </p>
                    {alarm.reason ? <p className="mt-1 text-xs font-semibold text-amber-100">{alarm.reason}</p> : null}
                  </div>
                )) : (
                  <p className="text-sm text-slate-300">
                    {readOnlyIntelligence?.cloudWatchAlarms?.warning || intl.formatMessage(awsControlMessages.noActiveAlarms)}
                  </p>
                )}
              </AdminPremiumSubpanel>
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
            <AdminPremiumSubpanel className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <DollarSign className="h-4 w-4 text-emerald-200" />
                <FormattedMessage {...awsControlMessages.budgetActions} />
              </div>
              <div className="grid gap-2">
                {budgetActions.length ? budgetActions.map((action) => (
                  <div key={action.actionId || `${action.type}:${action.status}`} className="rounded-xl border border-white/10 bg-black/15 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase tracking-widest text-slate-300">
                        {action.type || intl.formatMessage(awsControlMessages.notAvailable)}
                      </span>
                      <span className={`rounded-full border px-2 py-1 text-[0.65rem] font-black uppercase tracking-widest ${gateTone(action.status)}`}>
                        {displayState(action.status)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      {action.subType || action.region || intl.formatMessage(awsControlMessages.notAvailable)}
                    </p>
                  </div>
                )) : (
                  <p className="text-sm text-slate-300">
                    {control?.guardrails?.budgetActions?.warning || intl.formatMessage(awsControlMessages.notAvailable)}
                  </p>
                )}
              </div>
            </AdminPremiumSubpanel>
          </AdminPremiumPanel>
        </div>
      ) : null}
    </AdminPremiumShell>
  );
};

export default AwsControl;
