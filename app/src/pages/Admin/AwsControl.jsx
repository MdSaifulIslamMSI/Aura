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
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel, AdminPremiumSubpanel } from '@/components/shared/AdminPremiumShell';
import { adminApi } from '@/services/api';

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
  const [control, setControl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');

  const loadControl = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const payload = await adminApi.getAwsControl();
      setControl(payload?.control || null);
    } catch (error) {
      toast.error(error?.message || 'Failed to load AWS control state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadControl();
  }, [loadControl]);

  const targets = Array.isArray(control?.targets) ? control.targets : [];
  const staging = targets.find((target) => target.target === 'staging') || null;
  const production = targets.find((target) => target.target === 'production') || null;
  const services = control?.cost?.services || [];
  const budget = control?.guardrails?.budget || null;

  const stats = useMemo(() => [
    <AdminHeroStat
      key="enabled"
      label="Control plane"
      value={control?.enabled ? 'Enabled' : 'Disabled'}
      detail={control?.enabled ? `Region ${control.region || 'unknown'}` : control?.reason || 'Server env must opt in'}
      icon={<Cloud className="h-5 w-5" />}
    />,
    <AdminHeroStat
      key="staging"
      label="Staging"
      value={staging?.state || 'unknown'}
      detail={staging?.instanceId || staging?.tagName || 'No target configured'}
      icon={<Server className="h-5 w-5" />}
    />,
    <AdminHeroStat
      key="production"
      label="Production"
      value={production?.state || 'unknown'}
      detail="Production mutations disabled"
      icon={<ShieldCheck className="h-5 w-5" />}
    />,
    <AdminHeroStat
      key="cost"
      label="Month cost"
      value={formatUsd(control?.cost?.netUnblendedUsd)}
      detail={control?.cost?.available ? `${services.length} cost lines` : control?.cost?.warning || 'Cost Explorer unavailable'}
      icon={<DollarSign className="h-5 w-5" />}
    />,
  ], [control, production, services.length, staging]);

  const runAction = async (action) => {
    if (!reason.trim() || reason.trim().length < 8) {
      toast.error('Add an operator reason before changing AWS state');
      return;
    }

    setBusy(action);
    try {
      await adminApi.runAwsControlAction({
        target: 'staging',
        action,
        reason,
        confirmationPhrase,
      });
      toast.success(`Staging ${action} requested`);
      setReason('');
      setConfirmationPhrase('');
      await loadControl({ silent: true });
    } catch (error) {
      toast.error(error?.message || `Failed to ${action} staging`);
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
              {target.state || 'unknown'}
            </span>
            {target.mutationsEnabled ? (
              <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-xs font-black uppercase tracking-widest text-emerald-100">
                Mutations enabled
              </span>
            ) : (
              <span className="rounded-full border border-slate-300/20 bg-slate-400/10 px-2 py-1 text-xs font-black uppercase tracking-widest text-slate-200">
                Read only
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Instance {target.instanceId || 'not resolved'} · Name {target.name || target.tagName || 'not configured'}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {target.instanceType || 'unknown type'} · {target.environment || target.target} · {target.costProfile || 'no cost profile'}
          </p>
          {target.warning ? <p className="mt-2 text-sm text-amber-200">{target.warning}</p> : null}
        </div>
        {target.target === 'production' ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-sm font-semibold text-amber-100">
            Production start/stop is intentionally locked in Phase 1.
          </div>
        ) : null}
      </div>
    </AdminPremiumSubpanel>
  );

  return (
    <AdminPremiumShell
      eyebrow="AWS operations"
      title="AWS control center"
      description="Admin-only visibility and guarded staging controls for Aura AWS infrastructure. Production is visible here, but destructive production controls stay locked until a stronger approval flow exists."
      stats={stats}
      actions={(
        <button
          type="button"
          onClick={() => loadControl({ silent: true })}
          className="admin-premium-button px-4 py-2 text-sm font-black"
          disabled={loading || Boolean(busy)}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh AWS state
        </button>
      )}
    >
      {loading ? (
        <AdminPremiumPanel>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading AWS control plane...
          </div>
        </AdminPremiumPanel>
      ) : null}

      {!loading && !control?.enabled ? (
        <AdminPremiumPanel>
          <div className="flex items-start gap-3 text-amber-100">
            <AlertTriangle className="mt-1 h-5 w-5" />
            <div>
              <h2 className="text-xl font-black text-white">AWS control plane is not enabled on this backend</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Set server-side AWS control environment variables to enable live status and staging controls. Browser clients never receive AWS credentials.
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
                <p className="premium-kicker">Targets</p>
                <h2 className="mt-2 text-2xl font-black text-white">Production and staging posture</h2>
              </div>
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Generated {control.generatedAt || 'n/a'}
              </span>
            </div>
            <div className="grid gap-3">
              {targets.map(renderTarget)}
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4">
            <p className="premium-kicker">Staging controls</p>
            <h2 className="text-2xl font-black text-white">Start or stop staging</h2>
            <p className="text-sm leading-6 text-slate-300">
              These buttons only target staging. Stopping staging requires the phrase <strong>STOP STAGING</strong>.
            </p>
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              Operator reason
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="admin-premium-control min-h-24"
                placeholder="Why are you changing staging state?"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              Stop confirmation
              <input
                value={confirmationPhrase}
                onChange={(event) => setConfirmationPhrase(event.target.value)}
                className="admin-premium-control"
                placeholder="STOP STAGING"
              />
            </label>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => runAction('start')}
                disabled={busy === 'start' || !staging?.allowedActions?.includes('start')}
                className="admin-premium-button admin-premium-button-success"
              >
                {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Start staging
              </button>
              <button
                type="button"
                onClick={() => runAction('stop')}
                disabled={busy === 'stop' || !staging?.allowedActions?.includes('stop')}
                className="admin-premium-button admin-premium-button-danger"
              >
                {busy === 'stop' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                Stop staging
              </button>
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4 xl:col-span-2">
            <p className="premium-kicker">Cost watch</p>
            <h2 className="text-2xl font-black text-white">Current month AWS spend</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {services.length ? services.map((entry) => (
                <AdminPremiumSubpanel key={entry.service} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-slate-200">{entry.service}</span>
                  <span className="text-lg font-black text-white">{formatUsd(entry.usd)}</span>
                </AdminPremiumSubpanel>
              )) : (
                <AdminPremiumSubpanel className="text-sm text-slate-300">
                  {control?.cost?.warning || 'No non-zero service costs reported for the current Cost Explorer window.'}
                </AdminPremiumSubpanel>
              )}
            </div>
          </AdminPremiumPanel>

          <AdminPremiumPanel className="space-y-4">
            <p className="premium-kicker">Guardrails</p>
            <h2 className="text-2xl font-black text-white">Budget and expiration</h2>
            <div className="space-y-3 text-sm text-slate-300">
              <p>Budget: <strong className="text-white">{budget?.name || 'not available'}</strong></p>
              <p>Limit: <strong className="text-white">{formatUsd(budget?.limitUsd)}</strong></p>
              <p>Schedule: <strong className="text-white">{control?.guardrails?.expirationSchedule?.scheduleExpression || 'not available'}</strong></p>
              <p>Schedule state: <strong className="text-white">{control?.guardrails?.expirationSchedule?.state || 'unknown'}</strong></p>
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
