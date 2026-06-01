import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Activity,
  Bell,
  CheckCircle2,
  Clock3,
  Eye,
  Loader2,
  RadioTower,
  RefreshCw,
  ShieldAlert,
  Signal,
  Users,
  Wrench,
} from 'lucide-react';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel, AdminPremiumSubpanel } from '@/components/shared/AdminPremiumShell';
import { adminStatusApi } from '@/services/api/statusApi';
import { formatDate, formatPercent, statusMeta } from '@/pages/Status/statusMeta';
import { FormattedMessage } from 'react-intl';

const STATUS_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'operational', label: 'Operational' },
  { value: 'degraded_performance', label: 'Degraded' },
  { value: 'partial_outage', label: 'Partial outage' },
  { value: 'major_outage', label: 'Major outage' },
  { value: 'maintenance', label: 'Maintenance' },
];

const SEVERITY_OPTIONS = [
  { value: 'SEV1', label: 'SEV1' },
  { value: 'SEV2', label: 'SEV2' },
  { value: 'SEV3', label: 'SEV3' },
  { value: 'SEV4', label: 'SEV4' },
];

const IMPACT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'critical', label: 'Critical' },
];

const INCIDENT_STATUS_OPTIONS = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
];

const blankComponentForm = {
  groupName: 'Web App',
  name: '',
  description: '',
  checkType: 'manual',
  checkUrl: '',
  isPublic: true,
  isMonitored: true,
  manualStatusOverride: '',
};

const blankIncidentForm = {
  title: '',
  severity: 'SEV3',
  description: '',
  impact: 'minor',
  status: 'investigating',
  commander: '',
  source: 'manual',
  isPublic: true,
  affectedComponentIds: [],
  updateMessage: '',
  updateType: 'detected',
  updatePublic: true,
  customerImpact: '',
  confirmMajor: false,
};

const defaultDateTimeLocal = (offsetMinutes = 60) => {
  const date = new Date(Date.now() + offsetMinutes * 60000);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
};

const blankMaintenanceForm = {
  title: '',
  description: '',
  affectedComponentIds: [],
  scheduledStartAt: defaultDateTimeLocal(60),
  scheduledEndAt: defaultDateTimeLocal(120),
  updateMessage: '',
};

function StatusPill({ status }) {
  const meta = statusMeta(status);
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-widest"
      style={{ backgroundColor: meta.softColor, borderColor: meta.borderColor, color: meta.textColor }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.dotColor }} />
      {meta.label}
    </span>
  );
}

function FormField({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ControlInput(props) {
  return <input {...props} className={`admin-premium-control w-full ${props.className || ''}`} />;
}

function ControlTextarea(props) {
  return <textarea {...props} className={`admin-premium-control min-h-24 w-full ${props.className || ''}`} />;
}

function ControlSelect(props) {
  return <select {...props} className={`admin-premium-control w-full ${props.className || ''}`} />;
}

function ComponentMultiSelect({ components = [], value = [], onChange }) {
  return (
    <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 md:grid-cols-2">
      {components.map((component) => (
        <label key={component.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={value.includes(component.id)}
            onChange={(event) => {
              onChange(event.target.checked
                ? [...new Set([...value, component.id])]
                : value.filter((id) => id !== component.id));
            }}
          />
          <span className="min-w-0 truncate">{component.name}</span>
        </label>
      ))}
    </div>
  );
}

export default function AdminStatusDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [componentForm, setComponentForm] = useState(blankComponentForm);
  const [incidentForm, setIncidentForm] = useState(blankIncidentForm);
  const [maintenanceForm, setMaintenanceForm] = useState(blankMaintenanceForm);
  const [updateDrafts, setUpdateDrafts] = useState({});
  const [busy, setBusy] = useState('');

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setRefreshing(true);
      const data = await adminStatusApi.getDashboard();
      setDashboard(data?.dashboard || null);
    } catch (error) {
      toast.error(error.message || 'Failed to load status dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const groups = dashboard?.groups || [];
  const components = dashboard?.components || [];
  const incidents = dashboard?.incidents || [];
  const activeIncidents = incidents.filter((incident) => incident.status !== 'resolved');
  const templates = dashboard?.templates || {};

  const componentGroupNames = useMemo(() => {
    const names = groups.map((group) => group.name);
    return names.length ? names : ['Web App', 'API', 'Database'];
  }, [groups]);

  const runAction = async (key, action, success) => {
    try {
      setBusy(key);
      await action();
      toast.success(success);
      await loadDashboard({ silent: true });
    } catch (error) {
      toast.error(error.message || 'Action failed');
    } finally {
      setBusy('');
    }
  };

  const submitComponent = (event) => {
    event.preventDefault();
    return runAction('component', async () => {
      await adminStatusApi.createComponent({
        ...componentForm,
        manualStatusOverride: componentForm.manualStatusOverride || null,
      });
      setComponentForm(blankComponentForm);
    }, 'Component created');
  };

  const submitIncident = (event) => {
    event.preventDefault();
    return runAction('incident', async () => {
      await adminStatusApi.createIncident(incidentForm);
      setIncidentForm(blankIncidentForm);
    }, 'Incident published');
  };

  const submitMaintenance = (event) => {
    event.preventDefault();
    return runAction('maintenance', async () => {
      await adminStatusApi.createMaintenance({
        ...maintenanceForm,
        confirmMajor: true,
      });
      setMaintenanceForm(blankMaintenanceForm);
    }, 'Maintenance scheduled');
  };

  const renderTemplate = (status, incident = null) => {
    const componentNames = (incident?.affectedComponentIds || [])
      .map((id) => components.find((component) => component.id === id)?.name)
      .filter(Boolean)
      .join(', ') || 'Aura systems';
    return String(templates[status] || '')
      .replace('{components}', componentNames)
      .replace('{minutes}', status === 'investigating' ? '30' : '15');
  };

  const stats = dashboard?.overview ? [
    <AdminHeroStat key="overall" label={<FormattedMessage id="admin.jsx.prop.label.overall" defaultMessage="Overall" />} value={statusMeta(dashboard.overview.overallStatus).label} detail={dashboard.overview.message} icon={<Signal className="h-5 w-5" />} />,
    <AdminHeroStat key="active" label={<FormattedMessage id="support.jsx.prop.label.active.incidents" defaultMessage="Active incidents" />} value={dashboard.overview.activeIncidents + dashboard.overview.activeMaintenance} detail={`${dashboard.overview.degradedComponents} degraded components`} icon={<ShieldAlert className="h-5 w-5" />} />,
    <AdminHeroStat key="subs" label={<FormattedMessage id="admin.jsx.prop.label.subscribers" defaultMessage="Subscribers" />} value={dashboard.overview.subscribers} detail="Email preferences stored" icon={<Users className="h-5 w-5" />} />,
    <AdminHeroStat key="uptime" label={<FormattedMessage id="admin.jsx.prop.label.90d.uptime" defaultMessage="90d uptime" />} value={dashboard.overview.averageUptime ? formatPercent(dashboard.overview.averageUptime).replace(' uptime', '') : 'No data'} detail={`Updated ${formatDate(dashboard.overview.lastUpdatedAt, { time: true })}`} icon={<Activity className="h-5 w-5" />} />,
  ] : null;

  return (
    <AdminPremiumShell
      eyebrow="Status operations"
      title={<FormattedMessage id="admin.accessibility.public.status.control.room" defaultMessage="Public status control room" />}
      description={<FormattedMessage id="support.jsx.prop.description.manage.public.health.incidents.maintenance.subscribers.and" defaultMessage="Manage public health, incidents, maintenance, subscribers, and monitor signals from the existing Aura operations stack." />}
      stats={stats}
      actions={(
        <>
          <Link to="/status" className="admin-premium-button px-4 py-2 text-sm font-black">
            <Eye className="h-4 w-4" /><FormattedMessage id="admin.jsx.text.preview.public.page" defaultMessage="Preview public page" /></Link>
          <button type="button" onClick={() => loadDashboard({ silent: true })} className="admin-premium-button px-4 py-2 text-sm font-black">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /><FormattedMessage id="admin.jsx.text.refresh" defaultMessage="Refresh" /></button>
          <button type="button" disabled={busy === 'monitor'} onClick={() => runAction('monitor', adminStatusApi.runMonitor, 'Monitor cycle completed')} className="admin-premium-button admin-premium-button-accent px-4 py-2 text-sm font-black disabled:opacity-60">
            {busy === 'monitor' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RadioTower className="h-4 w-4" />}<FormattedMessage id="admin.jsx.text.run.checks" defaultMessage="Run checks" /></button>
        </>
      )}
    >
      {loading ? (
        <AdminPremiumPanel>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /><FormattedMessage id="admin.jsx.text.loading.status.console" defaultMessage="Loading status console..." /></div>
        </AdminPremiumPanel>
      ) : null}

      {!loading && dashboard ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
          <div className="space-y-5 xl:col-span-3">
            <AdminPremiumPanel>
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="admin.jsx.text.component.manager" defaultMessage="Component manager" /></h2>
                  <p className="text-sm text-slate-500"><FormattedMessage id="admin.jsx.text.public.labels.stay.separate.from.monitor.internals" defaultMessage="Public labels stay separate from monitor internals." /></p>
                </div>
                {!import.meta.env.PROD ? (
                  <button type="button" onClick={() => runAction('seed', () => adminStatusApi.seedDefaults({ includeDemoMetrics: true }), 'Default status data seeded')} className="admin-premium-button px-3 py-2 text-sm font-black"><FormattedMessage id="admin.jsx.text.seed.defaults" defaultMessage="Seed defaults" /></button>
                ) : null}
              </div>
              <form onSubmit={submitComponent} className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.group" defaultMessage="Group" />}>
                  <ControlSelect value={componentForm.groupName} onChange={(event) => setComponentForm((prev) => ({ ...prev, groupName: event.target.value }))}>
                    {componentGroupNames.map((name) => <option key={name} value={name}>{name}</option>)}
                  </ControlSelect>
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.component.name" defaultMessage="Component name" />}>
                  <ControlInput required value={componentForm.name} onChange={(event) => setComponentForm((prev) => ({ ...prev, name: event.target.value }))} />
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.check.type" defaultMessage="Check type" />}>
                  <ControlSelect value={componentForm.checkType} onChange={(event) => setComponentForm((prev) => ({ ...prev, checkType: event.target.value }))}>
                    <option value="manual"><FormattedMessage id="admin.jsx.text.manual" defaultMessage="Manual" /></option>
                    <option value="internal_health"><FormattedMessage id="admin.jsx.text.internal.health" defaultMessage="Internal health" /></option>
                    <option value="database"><FormattedMessage id="admin.jsx.text.database" defaultMessage="Database" /></option>
                    <option value="redis"><FormattedMessage id="admin.jsx.text.redis" defaultMessage="Redis" /></option>
                    <option value="http">HTTP</option>
                  </ControlSelect>
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.manual.override" defaultMessage="Manual override" />}>
                  <ControlSelect value={componentForm.manualStatusOverride} onChange={(event) => setComponentForm((prev) => ({ ...prev, manualStatusOverride: event.target.value }))}>
                    {STATUS_OPTIONS.map((option) => <option key={option.value || 'auto'} value={option.value}>{option.label}</option>)}
                  </ControlSelect>
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.check.url" defaultMessage="Check URL" />}>
                  <ControlInput value={componentForm.checkUrl} onChange={(event) => setComponentForm((prev) => ({ ...prev, checkUrl: event.target.value }))} placeholder="https://status-allowed.example.com/health" />
                </FormField>
                <div className="flex items-end gap-3">
                  <label className="admin-premium-button flex items-center gap-2 px-3 py-2 text-sm font-bold">
                    <input type="checkbox" checked={componentForm.isPublic} onChange={(event) => setComponentForm((prev) => ({ ...prev, isPublic: event.target.checked }))} /><FormattedMessage id="admin.jsx.text.public" defaultMessage="Public" /></label>
                  <label className="admin-premium-button flex items-center gap-2 px-3 py-2 text-sm font-bold">
                    <input type="checkbox" checked={componentForm.isMonitored} onChange={(event) => setComponentForm((prev) => ({ ...prev, isMonitored: event.target.checked }))} /><FormattedMessage id="admin.jsx.text.monitored" defaultMessage="Monitored" /></label>
                  <button type="submit" disabled={busy === 'component'} className="admin-premium-button admin-premium-button-success px-4 py-2 text-sm font-black disabled:opacity-60">
                    {busy === 'component' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}<FormattedMessage id="admin.jsx.text.create" defaultMessage="Create" /></button>
                </div>
              </form>

              <div className="mt-5 space-y-2">
                {components.map((component) => (
                  <AdminPremiumSubpanel key={component.id} className="p-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill status={component.currentStatus} />
                          <p className="font-black text-slate-950">{component.name}</p>
                          <span className="text-xs font-semibold text-slate-500">{component.checkType}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500"><FormattedMessage id="admin.jsx.text.last.checked" defaultMessage="Last checked" />{' '}{formatDate(component.lastCheckedAt, { time: true })} - {component.lastResponseTimeMs || '-'}{' '}<FormattedMessage id="admin.jsx.text.ms.failures" defaultMessage="ms - failures" />{' '}{component.consecutiveFailures}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ControlSelect
                          value={component.manualStatusOverride || ''}
                          onChange={(event) => runAction(`override-${component.id}`, () => adminStatusApi.updateComponent(component.id, { manualStatusOverride: event.target.value || null }), 'Component override updated')}
                          className="max-w-xs"
                          aria-label={`Manual override for ${component.name}`}
                        >
                          {STATUS_OPTIONS.map((option) => <option key={option.value || 'auto'} value={option.value}>{option.label}</option>)}
                        </ControlSelect>
                        <button type="button" onClick={() => runAction(`public-${component.id}`, () => adminStatusApi.updateComponent(component.id, { isPublic: !component.isPublic }), 'Public visibility updated')} className="admin-premium-button px-3 py-2 text-xs font-black">
                          {component.isPublic ? <FormattedMessage id="admin.jsx.expression.public" defaultMessage="Public" /> : <FormattedMessage id="admin.jsx.expression.private" defaultMessage="Private" />}
                        </button>
                        <button type="button" onClick={() => runAction(`monitor-${component.id}`, () => adminStatusApi.updateComponent(component.id, { isMonitored: !component.isMonitored }), 'Monitoring setting updated')} className="admin-premium-button px-3 py-2 text-xs font-black">
                          {component.isMonitored ? <FormattedMessage id="admin.jsx.expression.auto.on" defaultMessage="Auto on" /> : <FormattedMessage id="admin.jsx.expression.auto.off" defaultMessage="Auto off" />}
                        </button>
                      </div>
                    </div>
                  </AdminPremiumSubpanel>
                ))}
              </div>
            </AdminPremiumPanel>

            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="support.jsx.text.incident.manager" defaultMessage="Incident manager" /></h2>
              <form onSubmit={submitIncident} className="mt-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FormField label="Title">
                    <ControlInput required value={incidentForm.title} onChange={(event) => setIncidentForm((prev) => ({ ...prev, title: event.target.value }))} />
                  </FormField>
                  <FormField label="Severity">
                    <ControlSelect value={incidentForm.severity} onChange={(event) => setIncidentForm((prev) => ({ ...prev, severity: event.target.value }))}>
                      {SEVERITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </ControlSelect>
                  </FormField>
                  <FormField label={<FormattedMessage id="admin.jsx.prop.label.impact" defaultMessage="Impact" />}>
                    <ControlSelect value={incidentForm.impact} onChange={(event) => setIncidentForm((prev) => ({ ...prev, impact: event.target.value }))}>
                      {IMPACT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </ControlSelect>
                  </FormField>
                  <FormField label="Status">
                    <ControlSelect value={incidentForm.status} onChange={(event) => setIncidentForm((prev) => ({ ...prev, status: event.target.value }))}>
                      {INCIDENT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </ControlSelect>
                  </FormField>
                  <FormField label={<FormattedMessage id="admin.jsx.prop.label.commander" defaultMessage="Commander" />}>
                    <ControlInput value={incidentForm.commander} onChange={(event) => setIncidentForm((prev) => ({ ...prev, commander: event.target.value }))} placeholder="Incident commander" />
                  </FormField>
                  <FormField label="Source">
                    <ControlSelect value={incidentForm.source} onChange={(event) => setIncidentForm((prev) => ({ ...prev, source: event.target.value }))}>
                      <option value="manual"><FormattedMessage id="admin.jsx.text.manual" defaultMessage="Manual" /></option>
                      <option value="uptime_kuma"><FormattedMessage id="admin.jsx.text.uptime.kuma" defaultMessage="Uptime Kuma" /></option>
                      <option value="gatus"><FormattedMessage id="admin.jsx.text.gatus" defaultMessage="Gatus" /></option>
                      <option value="sentry"><FormattedMessage id="admin.jsx.text.sentry" defaultMessage="Sentry" /></option>
                      <option value="github_actions"><FormattedMessage id="admin.jsx.text.github.actions" defaultMessage="GitHub Actions" /></option>
                      <option value="synthetic"><FormattedMessage id="admin.jsx.text.synthetic" defaultMessage="Synthetic" /></option>
                    </ControlSelect>
                  </FormField>
                </div>
                <FormField label="Description">
                  <ControlTextarea value={incidentForm.description} onChange={(event) => setIncidentForm((prev) => ({ ...prev, description: event.target.value }))} />
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.customer.impact" defaultMessage="Customer impact" />}>
                  <ControlTextarea value={incidentForm.customerImpact} onChange={(event) => setIncidentForm((prev) => ({ ...prev, customerImpact: event.target.value }))} />
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.affected.components" defaultMessage="Affected components" />}>
                  <ComponentMultiSelect components={components} value={incidentForm.affectedComponentIds} onChange={(next) => setIncidentForm((prev) => ({ ...prev, affectedComponentIds: next }))} />
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.timeline.update" defaultMessage="Timeline update" />}>
                  <ControlTextarea value={incidentForm.updateMessage} onChange={(event) => setIncidentForm((prev) => ({ ...prev, updateMessage: event.target.value }))} />
                </FormField>
                <div className="flex flex-wrap gap-2">
                  {INCIDENT_STATUS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setIncidentForm((prev) => ({
                        ...prev,
                        status: option.value,
                        updateType: option.value === 'resolved' ? 'resolved' : 'status_update',
                        updateMessage: renderTemplate(option.value),
                      }))}
                      className="admin-premium-button px-3 py-2 text-xs font-black"
                    ><FormattedMessage id="admin.jsx.text.use" defaultMessage="Use" />{' '}{option.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="admin-premium-button flex items-center gap-2 px-3 py-2 text-sm font-bold">
                    <input type="checkbox" checked={incidentForm.isPublic} onChange={(event) => setIncidentForm((prev) => ({ ...prev, isPublic: event.target.checked, updatePublic: event.target.checked }))} /><FormattedMessage id="support.jsx.text.public.incident" defaultMessage="Public incident" /></label>
                  <label className="admin-premium-button flex items-center gap-2 px-3 py-2 text-sm font-bold">
                    <input type="checkbox" checked={incidentForm.confirmMajor} onChange={(event) => setIncidentForm((prev) => ({ ...prev, confirmMajor: event.target.checked }))} /><FormattedMessage id="admin.jsx.text.confirm.major.publication" defaultMessage="Confirm major publication" /></label>
                  <button type="submit" disabled={busy === 'incident'} className="admin-premium-button admin-premium-button-accent px-4 py-2 text-sm font-black disabled:opacity-60">
                    {busy === 'incident' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}<FormattedMessage id="support.jsx.text.publish.incident" defaultMessage="Publish incident" /></button>
                </div>
              </form>
            </AdminPremiumPanel>

            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="admin.jsx.text.maintenance.manager" defaultMessage="Maintenance manager" /></h2>
              <form onSubmit={submitMaintenance} className="mt-4 space-y-3">
                <FormField label="Title">
                  <ControlInput required value={maintenanceForm.title} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, title: event.target.value }))} />
                </FormField>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <FormField label={<FormattedMessage id="admin.jsx.prop.label.starts" defaultMessage="Starts" />}>
                    <ControlInput type="datetime-local" required value={maintenanceForm.scheduledStartAt} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, scheduledStartAt: event.target.value }))} />
                  </FormField>
                  <FormField label={<FormattedMessage id="admin.jsx.prop.label.ends" defaultMessage="Ends" />}>
                    <ControlInput type="datetime-local" required value={maintenanceForm.scheduledEndAt} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, scheduledEndAt: event.target.value }))} />
                  </FormField>
                </div>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.affected.components" defaultMessage="Affected components" />}>
                  <ComponentMultiSelect components={components} value={maintenanceForm.affectedComponentIds} onChange={(next) => setMaintenanceForm((prev) => ({ ...prev, affectedComponentIds: next }))} />
                </FormField>
                <FormField label={<FormattedMessage id="admin.jsx.prop.label.message" defaultMessage="Message" />}>
                  <ControlTextarea value={maintenanceForm.updateMessage} onChange={(event) => setMaintenanceForm((prev) => ({ ...prev, updateMessage: event.target.value, description: event.target.value }))} />
                </FormField>
                <button type="submit" disabled={busy === 'maintenance'} className="admin-premium-button admin-premium-button-success px-4 py-2 text-sm font-black disabled:opacity-60">
                  {busy === 'maintenance' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}<FormattedMessage id="admin.jsx.text.schedule.maintenance" defaultMessage="Schedule maintenance" /></button>
              </form>
            </AdminPremiumPanel>
          </div>

          <div className="space-y-5 xl:col-span-2">
            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="admin.jsx.text.active.timeline" defaultMessage="Active timeline" /></h2>
              <div className="mt-4 space-y-3">
                {activeIncidents.length === 0 ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700"><FormattedMessage id="support.jsx.text.no.active.incident.or.maintenance.item" defaultMessage="No active incident or maintenance item." /></p>
                ) : activeIncidents.map((incident) => (
                  <AdminPremiumSubpanel key={incident.id} className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-950">{incident.title}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
                          {incident.severity || 'SEV3'} - {incident.impact} - {incident.status}
                        </p>
                        {incident.commander ? <p className="mt-1 text-xs font-bold text-slate-500"><FormattedMessage id="admin.jsx.text.commander" defaultMessage="Commander:" />{' '}{incident.commander}</p> : null}
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" onClick={() => runAction(`postmortem-${incident.id}`, () => adminStatusApi.generatePostmortem(incident.id), 'Postmortem generated')} className="admin-premium-button px-3 py-2 text-xs font-black"><FormattedMessage id="admin.jsx.text.postmortem" defaultMessage="Postmortem" /></button>
                        <button type="button" onClick={() => runAction(`resolve-${incident.id}`, () => adminStatusApi.resolveIncident(incident.id, { message: renderTemplate('resolved', incident), actor: incident.commander }), 'Incident resolved')} className="admin-premium-button px-3 py-2 text-xs font-black"><FormattedMessage id="admin.jsx.text.resolve" defaultMessage="Resolve" /></button>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {['investigating', 'identified', 'monitoring', 'resolved'].map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => runAction(`move-${incident.id}-${status}`, () => adminStatusApi.updateIncident(incident.id, {
                            status,
                            updateMessage: renderTemplate(status, incident),
                            updateType: status === 'resolved' ? 'resolved' : 'status_update',
                            updatePublic: incident.isPublic !== false,
                          }), `Incident moved to ${status}`)}
                          className="admin-premium-button px-3 py-2 text-xs font-black"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={updateDrafts[incident.id] || ''}
                      onChange={(event) => setUpdateDrafts((prev) => ({ ...prev, [incident.id]: event.target.value }))}
                      className="admin-premium-control mt-3 min-h-20 w-full"
                      placeholder="Post update..."
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => runAction(`update-${incident.id}`, async () => {
                          await adminStatusApi.addIncidentUpdate(incident.id, {
                            status: incident.status,
                            type: 'status_update',
                            message: updateDrafts[incident.id] || 'Status update posted.',
                            public: true,
                            actor: incident.commander,
                          });
                          setUpdateDrafts((prev) => ({ ...prev, [incident.id]: '' }));
                        }, 'Public update posted')}
                        className="admin-premium-button admin-premium-button-accent px-3 py-2 text-xs font-black"
                      ><FormattedMessage id="admin.jsx.text.public.update" defaultMessage="Public update" /></button>
                      <button
                        type="button"
                        onClick={() => runAction(`note-${incident.id}`, async () => {
                          await adminStatusApi.addIncidentUpdate(incident.id, {
                            status: incident.status,
                            type: 'internal_note',
                            message: updateDrafts[incident.id] || 'Internal timeline note.',
                            public: false,
                            actor: incident.commander,
                          });
                          setUpdateDrafts((prev) => ({ ...prev, [incident.id]: '' }));
                        }, 'Internal note added')}
                        className="admin-premium-button px-3 py-2 text-xs font-black"
                      ><FormattedMessage id="admin.jsx.text.internal.note" defaultMessage="Internal note" /></button>
                      <button
                        type="button"
                        onClick={() => runAction(`mitigation-${incident.id}`, () => adminStatusApi.addIncidentUpdate(incident.id, {
                          status: 'monitoring',
                          type: 'mitigation',
                          message: renderTemplate('monitoring', incident),
                          public: incident.isPublic !== false,
                          actor: incident.commander,
                        }), 'Mitigation marked')}
                        className="admin-premium-button px-3 py-2 text-xs font-black"
                      ><FormattedMessage id="admin.jsx.text.mark.mitigation" defaultMessage="Mark mitigation" /></button>
                    </div>
                    {incident.timeline?.length ? (
                      <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                        {incident.timeline.slice(-5).map((entry, index) => (
                          <div key={`${incident.id}-timeline-${index}`} className="text-xs leading-5 text-slate-600">
                            <span className="font-black uppercase text-slate-500">{entry.type}</span> {entry.message}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </AdminPremiumSubpanel>
                ))}
              </div>
            </AdminPremiumPanel>

            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="admin.jsx.text.monitor.logs" defaultMessage="Monitor logs" /></h2>
              <div className="mt-4 space-y-2">
                {(dashboard.recentChecks || []).slice(0, 12).map((check) => (
                  <div key={check.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-black text-slate-950">{check.componentName}</p>
                      <StatusPill status={check.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(check.checkedAt, { time: true })} - {check.responseTimeMs || '-'}{' '}<FormattedMessage id="admin.jsx.text.ms.http" defaultMessage="ms - HTTP" />{' '}{check.httpStatusCode || '-'}
                    </p>
                    {check.errorMessage ? <p className="mt-1 text-xs text-slate-600">{check.errorMessage}</p> : null}
                  </div>
                ))}
              </div>
            </AdminPremiumPanel>

            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="support.jsx.text.recent.incidents" defaultMessage="Recent incidents" /></h2>
              <div className="mt-4 space-y-2">
                {incidents.slice(0, 8).map((incident) => (
                  <Link key={incident.id} to={`/status/incidents/${incident.slug}`} className="block rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50">
                    <p className="font-black text-slate-950">{incident.title}</p>
                    <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">{incident.impact} - {incident.status}</p>
                  </Link>
                ))}
              </div>
            </AdminPremiumPanel>

            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="admin.jsx.text.subscriber.snapshot" defaultMessage="Subscriber snapshot" /></h2>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <Clock3 className="h-5 w-5 text-slate-500" />
                <p className="text-sm font-semibold text-slate-600"><FormattedMessage id="admin.jsx.text.subscriber.count.is.included.in.overview.detailed" defaultMessage="Subscriber count is included in overview. Detailed subscriber list is available from the admin API." /></p>
              </div>
            </AdminPremiumPanel>

            <AdminPremiumPanel>
              <h2 className="text-xl font-black text-slate-950"><FormattedMessage id="admin.jsx.text.severity.policy" defaultMessage="Severity policy" /></h2>
              <div className="mt-4 space-y-2">
                {Object.entries(dashboard.severityPolicy || {}).map(([severity, policy]) => (
                  <div key={severity} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black text-slate-950">{severity}</p>
                      <span className="text-xs font-black uppercase tracking-widest text-slate-500">{policy.publicStatus}</span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-600">{policy.meaning}</p>
                    <p className="mt-2 text-xs text-slate-500">{policy.requiredAction}</p>
                  </div>
                ))}
              </div>
            </AdminPremiumPanel>
          </div>
        </div>
      ) : null}
    </AdminPremiumShell>
  );
}
