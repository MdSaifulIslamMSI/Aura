import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const paths = {
  dashboard: 'infra/observability/grafana/dashboards/login-security-observability.json',
  dashboardProvisioning: 'infra/observability/grafana/provisioning/dashboards/aura-login-security.yml',
  datasourceProvisioning: 'infra/observability/grafana/provisioning/datasources/prometheus.yml',
  alerts: 'infra/observability/prometheus/alerts/login-security.yml',
  prometheusLocal: 'infra/observability/prometheus/prometheus.local.yml',
  prometheusEc2: 'infra/observability/prometheus/prometheus.ec2.yml',
  composeLocal: 'infra/observability/docker-compose.local.yml',
  composeEc2: 'infra/observability/docker-compose.ec2.yml',
};

const read = (relativePath) => {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing observability asset: ${relativePath}`);
  }
  return readFileSync(absolutePath, 'utf8');
};

const requireText = (name, text, patterns) => {
  for (const pattern of patterns) {
    if (!pattern.test(text)) {
      throw new Error(`${name} is missing expected pattern: ${pattern}`);
    }
  }
};

const dashboardText = read(paths.dashboard);
const dashboard = JSON.parse(dashboardText);

if (dashboard.uid !== 'aura-login-security') {
  throw new Error('Dashboard uid must be aura-login-security');
}

if (!Array.isArray(dashboard.panels) || dashboard.panels.length < 6) {
  throw new Error('Dashboard must contain at least 6 panels');
}

requireText('dashboard', dashboardText, [
  /aura_auth_security_events_total/,
  /login_failure/,
  /otp_verify/,
  /csrf_rejected/,
  /admin_access_blocked/,
  /recovery_code/,
]);

const alertText = read(paths.alerts);
requireText('Prometheus login security alerts', alertText, [
  /groups:/,
  /aura_auth_security_events_total/,
  /AuraAuthLoginFailureSpike/,
  /AuraAuthOtpVerifyFailureSpike/,
  /AuraAuthRecoveryCodeAbuse/,
  /AuraAuthAdminAccessBlocked/,
  /AuraAuthCsrfRejectionBurst/,
  /AuraAuthTrustedDeviceVerifyFailureSpike/,
  /AuraAuthStepUpPressure/,
]);

requireText('local Prometheus config', read(paths.prometheusLocal), [
  /rule_files:/,
  /\/etc\/prometheus\/alerts\/\*\.yml/,
  /backend:5000/,
]);

requireText('EC2 Prometheus config', read(paths.prometheusEc2), [
  /http_headers:/,
  /x-metrics-key:/,
  /files:/,
  /\/run\/secrets\/aura_metrics_secret/,
  /api:5000/,
]);

requireText('Grafana datasource provisioning', read(paths.datasourceProvisioning), [
  /uid:\s*prometheus/,
  /url:\s*http:\/\/prometheus:9090/,
]);

requireText('Grafana dashboard provisioning', read(paths.dashboardProvisioning), [
  /Aura Login Security/,
  /\/var\/lib\/grafana\/dashboards/,
]);

requireText('local observability compose', read(paths.composeLocal), [
  /prometheus:/,
  /grafana:/,
  /9090:9090/,
  /3001:3000/,
]);

requireText('EC2 observability compose', read(paths.composeEc2), [
  /127\.0\.0\.1:9090:9090/,
  /127\.0\.0\.1:3001:3000/,
  /GRAFANA_ADMIN_PASSWORD/,
  /\/opt\/aura\/shared\/metrics-secret/,
]);

console.log('Observability assets OK: Prometheus alerts, scrape configs, Grafana provisioning, and dashboard are wired.');
