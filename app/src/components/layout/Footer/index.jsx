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
  Truck,
  ShieldCheck,
  RotateCcw,
  Activity,
  AlertTriangle,
  Server,
  Lock,
  Sparkles,
} from 'lucide-react';
import { trustApi } from '@/services/api';

const STATUS_CLASSES = {
  healthy: 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300 shadow-emerald-500/0 hover:shadow-emerald-500/20',
  degraded: 'bg-amber-500/15 border-amber-400/40 text-amber-200 shadow-amber-500/0 hover:shadow-amber-500/20',
  checking: 'bg-slate-500/15 border-slate-400/30 text-slate-200 shadow-slate-500/0 hover:shadow-slate-500/20',
};

const FOOTER_PILLARS = [
  {
    icon: ShieldCheck,
    title: 'Trust Layer',
    detail: 'Escrow, verified sellers, and product integrity cues stay visible from browse to checkout.',
  },
  {
    icon: Truck,
    title: 'Operations',
    detail: 'Delivery, returns, and payment pathways are framed to feel dependable before they feel fast.',
  },
  {
    icon: Lock,
    title: 'Security',
    detail: 'Client context, backend health, and secure payment posture are surfaced as part of the product experience.',
  },
];

const Footer = () => {
  const location = useLocation();
  const [trustStatus, setTrustStatus] = useState({
    backend: { status: 'checking', db: 'unknown', uptime: 0, timestamp: null },
    client: { online: true, secureContext: false, language: 'unknown', timezone: 'unknown' },
    derivedStatus: 'checking',
  });

  const footerLinks = {
    about: [
      { name: 'Contact Us', path: '/contact' },
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
                Security Operations
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:max-w-4xl">
              <div className={`footer-card px-3 py-2 transition-all duration-300 hover:-translate-y-1 ${STATUS_CLASSES[systemHealthStatus]}`}>
                <p className="text-[10px] uppercase tracking-wider font-bold">System Health</p>
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
                <p className="text-[10px] uppercase tracking-wider font-bold">Payments Safety</p>
                <p className="text-sm font-semibold mt-0.5 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {paymentSafetyStatus === 'healthy' ? 'Protected' : 'Monitoring'}
                </p>
              </div>

              <div className={`footer-card px-3 py-2 transition-all duration-300 hover:-translate-y-1 ${STATUS_CLASSES[emailSecurityStatus]}`}>
                <p className="text-[10px] uppercase tracking-wider font-bold">Email Security</p>
                <p className="text-sm font-semibold mt-0.5 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5" />
                  {emailSecurityStatus === 'healthy' ? 'Strict Active' : 'Syncing'}
                </p>
              </div>
            </div>

            <Link
              to="/contact"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-400/30 bg-amber-500/10 text-amber-200 text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Incident Support
            </Link>
          </div>
        </div>
      </div>

      <div className="relative z-10 border-b border-transparent">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent animate-gradient-x opacity-70" style={{ backgroundSize: '200% auto' }} />
        <div className="container-custom max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            <div className="footer-card flex flex-col items-center text-center gap-3 p-4 border-white/5 hover:border-neo-cyan/30 hover:shadow-[0_0_15px_rgba(6,182,212,0.1)] transition-all duration-300 group">
              <div className="w-12 h-12 rounded-full bg-neo-cyan/10 flex items-center justify-center group-hover:bg-neo-cyan/20 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                <Truck className="w-6 h-6 text-neo-cyan" />
              </div>
              <div>
                <p className="font-bold text-slate-100 mb-1">Express Delivery</p>
                <p className="text-xs text-slate-400">Fast shipping on all orders</p>
              </div>
            </div>

              <div className="footer-card flex flex-col items-center text-center gap-3 p-4 border-white/5 hover:border-neo-emerald/30 hover:shadow-[0_0_15px_rgba(16,185,129,0.14)] transition-all duration-300 group">
              <div className="w-12 h-12 rounded-full bg-neo-emerald/10 flex items-center justify-center group-hover:bg-neo-emerald/20 group-hover:scale-110 group-hover:-rotate-3 transition-all duration-300">
                <RotateCcw className="w-6 h-6 text-neo-emerald" />
              </div>
              <div>
                <p className="font-bold text-slate-100 mb-1">Easy Returns</p>
                <p className="text-xs text-slate-400">30 days hassle-free return policy</p>
              </div>
            </div>

            <div className="footer-card flex flex-col items-center text-center gap-3 p-4 border-white/5 hover:border-neo-cyan/30 hover:shadow-[0_0_15px_rgba(6,182,212,0.1)] transition-all duration-300 group">
              <div className="w-12 h-12 rounded-full bg-neo-cyan/10 flex items-center justify-center group-hover:bg-neo-cyan/20 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300">
                <ShieldCheck className="w-6 h-6 text-neo-cyan" />
              </div>
              <div>
                <p className="font-bold text-slate-100 mb-1">Secure Checkout</p>
                <p className="text-xs text-slate-400">Server-authoritative transaction checks</p>
              </div>
            </div>

            <div className="footer-card flex flex-col items-center text-center gap-3 p-4 border-white/5 hover:border-neo-emerald/30 hover:shadow-[0_0_15px_rgba(16,185,129,0.14)] transition-all duration-300 group">
              <div className="w-12 h-12 rounded-full bg-neo-emerald/10 flex items-center justify-center group-hover:bg-neo-emerald/20 group-hover:scale-110 group-hover:-rotate-3 transition-all duration-300">
                <CreditCard className="w-6 h-6 text-neo-emerald" />
              </div>
              <div>
                <p className="font-bold text-slate-100 mb-1">Flexible Payments</p>
                <p className="text-xs text-slate-400">Tokenized methods with protected fallback paths</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container-custom max-w-7xl mx-auto px-4 py-8 relative z-10">
        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="premium-hero-panel premium-grid-backdrop p-6 sm:p-7">
            <div className="premium-eyebrow">
              <Sparkles className="h-4 w-4" />
              Aura Network
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-black leading-[0.96] tracking-tight text-white sm:text-4xl">
              Commerce should feel assured before it feels fast.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Aura is built to feel like a premium retail operating system: trusted product discovery, clear transaction signals, and a marketplace layer that still looks composed under pressure.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/trust" className="btn-secondary inline-flex items-center gap-2">
                Open Trust Center
              </Link>
              <Link to="/marketplace" className="btn-primary inline-flex items-center gap-2">
                Explore Marketplace
              </Link>
            </div>
          </section>

          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
            {FOOTER_PILLARS.map((pillar) => {
              const Icon = pillar.icon;
              return (
                <article key={pillar.title} className="footer-card rounded-[1.5rem] p-5">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <Icon className="h-5 w-5 text-neo-cyan" />
                  </div>
                  <h3 className="mt-4 text-lg font-black text-white">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{pillar.detail}</p>
                </article>
              );
            })}
          </div>
        </div>
      </div>

      <div className="container-custom max-w-7xl mx-auto px-4 py-12 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8 md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <h3 className="footer-section-title text-neo-cyan">About</h3>
            <ul className="space-y-3">{footerLinks.about.map((link) => <li key={link.path}>{renderNavLink(link)}</li>)}</ul>
          </div>

          <div className="col-span-2 md:col-span-1">
            <h3 className="footer-section-title text-neo-emerald">Support</h3>
            <ul className="space-y-3">{footerLinks.help.map((link) => <li key={link.path}>{renderNavLink(link)}</li>)}</ul>
          </div>

          <div className="col-span-2 md:col-span-1">
            <h3 className="footer-section-title text-neo-cyan">Legal</h3>
            <ul className="space-y-3">{footerLinks.policy.map((link) => <li key={link.path}>{renderNavLink(link)}</li>)}</ul>
          </div>

          <div className="col-span-2 md:col-span-1">
            <h3 className="footer-section-title text-neo-emerald">Network</h3>
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
          </div>

          <div className="col-span-2 md:col-span-2">
            <h3 className="footer-section-title text-slate-100">Headquarters</h3>
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
              <span>© {new Date().getFullYear()} All Rights Reserved.</span>
            </div>
            <div className="flex items-center gap-3 opacity-60 hover:opacity-100 transition-opacity duration-300">
              <div className="h-8 w-12 bg-white/10 rounded-md flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-slate-300" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
