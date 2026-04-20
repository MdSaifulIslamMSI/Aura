import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Mail,
  Phone,
  MapPin,
  Facebook,
  Twitter,
  Instagram,
  Youtube,
  CreditCard,
  ShieldCheck,
  Activity,
  Server,
  Lock,
} from 'lucide-react';
import { trustApi } from '@/services/api';
import { useMarket } from '@/context/MarketContext';
import { buildSupportHandoffPath } from '@/utils/supportRouting';
import { formatReleaseBuiltAt, releaseInfo, resolveRuntimeHost } from '@/config/releaseInfo';

const STATUS_CLASSES = {
  healthy: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300 shadow-emerald-500/0 hover:shadow-emerald-500/20',
  degraded: 'bg-amber-500/15 border-amber-400/40 text-amber-200 shadow-amber-500/0 hover:shadow-amber-500/20',
  checking: 'bg-slate-500/15 border-slate-400/30 text-slate-200 shadow-slate-500/0 hover:shadow-slate-500/20',
};

const Footer = () => {
  const location = useLocation();
  const { t } = useMarket();
  const [trustStatus, setTrustStatus] = useState({
    backend: { status: 'checking', db: 'unknown', uptime: 0, timestamp: null },
    client: { online: true, secureContext: false, language: 'unknown', timezone: 'unknown' },
    derivedStatus: 'checking',
  });
  const supportDeskPath = buildSupportHandoffPath();
  const runtimeHost = useMemo(() => resolveRuntimeHost(), []);
  const releaseBuiltAtLabel = useMemo(() => formatReleaseBuiltAt(releaseInfo.builtAt), []);
  const hasRuntimeTargetMismatch = useMemo(
    () => (
      releaseInfo.deployTarget !== 'unknown'
      && runtimeHost !== 'unknown'
      && runtimeHost !== 'local'
      && runtimeHost !== releaseInfo.deployTarget
    ),
    [runtimeHost]
  );

  const footerLinks = {
    about: [
      { name: 'Contact Us', path: supportDeskPath },
      { name: 'About Us', path: '/about' },
      { name: 'Careers', path: '/careers' },
      { name: 'Aura Stories', path: '/stories' },
      { name: 'Press', path: '/press' },
      { name: 'Corporate Information', path: '/corporate' },
    ],
    help: [
      { name: 'Payments', path: '/payments' },
      { name: 'Shipping', path: '/shipping' },
      { name: 'Cancellation & Returns', path: '/returns' },
      { name: 'FAQ', path: '/faq' },
      { name: 'Report Infringement', path: '/report' },
    ],
    policy: [
      { name: 'Return Policy', path: '/return-policy' },
      { name: 'Terms Of Use', path: '/terms' },
      { name: 'Security', path: '/security' },
      { name: 'Privacy', path: '/privacy' },
      { name: 'Sitemap', path: '/sitemap' },
      { name: 'EPR Compliance', path: '/epr' },
    ],
    social: [
      { name: 'Facebook', icon: Facebook, path: 'https://facebook.com' },
      { name: 'Twitter', icon: Twitter, path: 'https://twitter.com' },
      { name: 'Instagram', icon: Instagram, path: 'https://instagram.com' },
      { name: 'YouTube', icon: Youtube, path: 'https://youtube.com' },
    ],
  };

  useEffect(() => {
    let isMounted = true;

    const loadStatus = async () => {
      try {
        const result = await trustApi.getHealthStatus();
        if (isMounted) setTrustStatus(result);
      } catch {
        if (!isMounted) return;
        setTrustStatus((prev) => {
          if (prev.backend.timestamp) {
            return prev;
          }
          return {
            ...prev,
            derivedStatus: 'checking',
            backend: { ...prev.backend, status: 'checking' },
          };
        });
      }
    };

    loadStatus();
    const timer = setInterval(loadStatus, 60000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  const hasBackendSignal = useMemo(
    () => Boolean(trustStatus?.backend?.timestamp),
    [trustStatus?.backend?.timestamp]
  );

  const systemHealthStatus = useMemo(() => {
    if (!hasBackendSignal) {
      return 'checking';
    }
    return trustStatus.derivedStatus === 'healthy' ? 'healthy' : 'degraded';
  }, [hasBackendSignal, trustStatus.derivedStatus]);

  const paymentSafetyStatus = useMemo(() => {
    if (!hasBackendSignal) {
      return 'checking';
    }
    return trustStatus.client.secureContext && systemHealthStatus === 'healthy'
      ? 'healthy'
      : 'checking';
  }, [hasBackendSignal, systemHealthStatus, trustStatus.client.secureContext]);

  const emailSecurityStatus = useMemo(() => {
    if (!hasBackendSignal) {
      return 'checking';
    }
    return systemHealthStatus === 'healthy' ? 'healthy' : 'checking';
  }, [hasBackendSignal, systemHealthStatus]);

  const renderNavLink = (link) => {
    const isActive = location.pathname === link.path;
    return (
      <Link
        key={link.path}
        to={link.path}
        className={`footer-link ${
          isActive
            ? 'text-white pl-2'
            : ''
        }`}
      >
        {link.name}
      </Link>
    );
  };

  return (
    <footer className="footer-shell">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-neo-emerald/10 rounded-full blur-[110px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-neo-cyan/10 rounded-full blur-[110px] pointer-events-none" />

      <div className="footer-strip">
        <div className="container-custom max-w-7xl mx-auto px-4 py-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-neo-cyan" />
              <h3 className="text-xs font-bold tracking-[0.2em] uppercase text-slate-100">
                {t('footer.statusOverview', {}, 'Support and Trust')}
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:max-w-4xl">
              <div className={`footer-card px-3 py-2 transition-all duration-300 hover:-translate-y-1 ${STATUS_CLASSES[systemHealthStatus]}`}>
                <p className="text-[10px] uppercase tracking-wider font-bold">{t('footer.systemHealth', {}, 'System Health')}</p>
                <p className="text-sm font-semibold mt-0.5 flex items-center gap-2">
                  <Server className="w-3.5 h-3.5" />
                  {systemHealthStatus === 'healthy'
                    ? 'Healthy'
                    : systemHealthStatus === 'checking'
                      ? 'Checking'
                      : 'Degraded'}
                </p>
              </div>

              <div className={`footer-card px-3 py-2 transition-all duration-300 hover:-translate-y-1 ${STATUS_CLASSES[paymentSafetyStatus]}`}>
                <p className="text-[10px] uppercase tracking-wider font-bold">{t('footer.paymentSafety', {}, 'Payments Safety')}</p>
                <p className="text-sm font-semibold mt-0.5 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {paymentSafetyStatus === 'healthy' ? 'Protected' : 'Monitoring'}
                </p>
              </div>

              <div className={`footer-card px-3 py-2 transition-all duration-300 hover:-translate-y-1 ${STATUS_CLASSES[emailSecurityStatus]}`}>
                <p className="text-[10px] uppercase tracking-wider font-bold">{t('footer.emailSecurity', {}, 'Email Security')}</p>
                <p className="text-sm font-semibold mt-0.5 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5" />
                  {emailSecurityStatus === 'healthy' ? 'Strict Active' : 'Syncing'}
                </p>
              </div>
            </div>

            <Link
              to={supportDeskPath}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-cyan-100 transition-colors hover:bg-cyan-500/20"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {t('footer.contactSupport', {}, 'Contact Support')}
            </Link>
          </div>
        </div>
      </div>

      <div className="container-custom max-w-7xl mx-auto px-4 py-12 relative z-10">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_1fr]">
          <section className="footer-card rounded-[1.75rem] p-6">
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-neo-cyan">
              {t('footer.network', {}, 'Aura Network')}
            </div>
            <h2 className="mt-4 max-w-lg text-3xl font-black leading-[0.98] tracking-tight text-white">
              {t('footer.cleanHeadline', {}, 'Shopping support, trust, and discovery stay in one place.')}
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">
              {t('footer.cleanBody', {}, 'Search, deals, marketplace browsing, and support should feel connected without the footer turning into another landing page.')}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to={supportDeskPath} className="btn-secondary inline-flex items-center gap-2">
                {t('footer.contactSupport', {}, 'Contact Support')}
              </Link>
              <Link to="/trust" className="btn-primary inline-flex items-center gap-2">
                {t('footer.trustCenter', {}, 'Open Trust Center')}
              </Link>
            </div>
          </section>

          <div>
            <h3 className="footer-section-title text-neo-cyan">{t('footer.about', {}, 'About')}</h3>
            <ul className="space-y-3">{footerLinks.about.map((link) => <li key={link.path}>{renderNavLink(link)}</li>)}</ul>
          </div>

          <div>
            <h3 className="footer-section-title text-neo-emerald">{t('footer.support', {}, 'Support')}</h3>
            <ul className="space-y-3">{footerLinks.help.map((link) => <li key={link.path}>{renderNavLink(link)}</li>)}</ul>
          </div>

          <div>
            <h3 className="footer-section-title text-neo-cyan">{t('footer.legal', {}, 'Legal')}</h3>
            <ul className="space-y-3">{footerLinks.policy.map((link) => <li key={link.path}>{renderNavLink(link)}</li>)}</ul>
          </div>

          <div>
            <h3 className="footer-section-title text-neo-emerald">{t('footer.connect', {}, 'Connect')}</h3>
            <ul className="space-y-3">
              {footerLinks.social.map((link) => (
                <li key={link.path}>
                  <a
                    href={link.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 text-sm text-slate-400 hover:text-white transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                      <link.icon className="w-4 h-4 group-hover:text-neo-emerald transition-colors" />
                    </div>
                    <span>{link.name}</span>
                  </a>
                </li>
              ))}
            </ul>
            <h3 className="footer-section-title mt-8 text-slate-100">{t('footer.headquarters', {}, 'Headquarters')}</h3>
            <div className="space-y-4">
              <div className="footer-contact-card">
                <MapPin className="w-5 h-5 text-neo-cyan flex-shrink-0 mt-1" />
                <p className="text-sm text-slate-400 leading-relaxed">
                  Aura Global HQ,
                  <br />
                  Tower 7, Innovation District,
                  <br />
                  Bangalore, 560001, India
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <a href="mailto:support@aura.shop" className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors group">
                  <Mail className="w-5 h-5 text-neo-emerald flex-shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-sm text-slate-400 group-hover:text-white transition-colors">support@aura.shop</span>
                </a>
                <a href="tel:1-800-AURA-01" className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors group">
                  <Phone className="w-5 h-5 text-neo-cyan flex-shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-sm text-slate-400 group-hover:text-white transition-colors">1-800-AURA-01</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="container-custom max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <span className="text-neo-cyan font-black tracking-widest uppercase text-xs">Aura</span>
              <span>Copyright {new Date().getFullYear()} {t('footer.rights', {}, 'All Rights Reserved.')}</span>
            </div>
            <div className="flex flex-col items-center gap-3 md:items-end">
              <div className="flex flex-wrap items-center justify-center gap-2 md:justify-end">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                  hasRuntimeTargetMismatch
                    ? 'border-amber-400/35 bg-amber-500/15 text-amber-100'
                    : 'border-emerald-400/30 bg-emerald-500/12 text-emerald-100'
                }`}>
                  Runtime {runtimeHost}
                </span>
                <span className="inline-flex items-center rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
                  Target {releaseInfo.deployTarget}
                </span>
                <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.06] px-3 py-1 font-mono text-[11px] font-semibold text-slate-200">
                  {releaseInfo.id}
                </span>
              </div>
              <p className="text-center text-[11px] text-slate-500 md:text-right">
                Built {releaseBuiltAtLabel} · Commit {releaseInfo.shortCommitSha} · Source {releaseInfo.source}
              </p>
              <div className="flex items-center gap-3 opacity-60 hover:opacity-100 transition-opacity duration-300">
                <div className="h-8 w-12 bg-white/10 rounded-md flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-slate-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
