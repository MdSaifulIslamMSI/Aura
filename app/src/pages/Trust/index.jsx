import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, ShieldCheck, FileText, ArrowRight } from 'lucide-react';
import { getTrustPageContent, trustMeta, trustRouteToKey } from '@/config/trustContent';

const getKeyFromPath = (pathname = '') => {
  return trustRouteToKey[pathname] || 'security';
};

export default function TrustPage() {
  const location = useLocation();
  const pageKey = getKeyFromPath(location.pathname);
  const content = getTrustPageContent(pageKey);

  return (
    <div className="min-h-screen bg-zinc-950 text-slate-200">
      <div className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(217,70,239,0.12),transparent_35%)] pointer-events-none" />
        <div className="max-w-5xl mx-auto px-4 py-14 sm:py-20 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neo-cyan/30 bg-neo-cyan/10 text-neo-cyan text-xs font-bold tracking-wider uppercase">
            <ShieldCheck className="w-3.5 h-3.5" />
            Trust Center
          </div>
          <h1 className="mt-4 text-3xl sm:text-4xl font-black text-white leading-tight">{content.title}</h1>
          <p className="mt-4 text-slate-300 max-w-3xl leading-relaxed">{content.summary}</p>
          <div className="mt-5 text-xs text-slate-400 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" />
            Last updated: {trustMeta.lastUpdated}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8 sm:py-10 space-y-6">
        {content.sections.map((section) => (
          <section key={section.heading} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-xl font-bold text-white">{section.heading}</h2>
            <ul className="mt-4 space-y-3">
              {section.points.map((point) => (
                <li key={point} className="text-sm text-slate-300 flex items-start gap-3 leading-relaxed">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-neo-cyan flex-shrink-0" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-amber-200">Security Notice</h3>
              <p className="mt-1 text-sm text-amber-100/90">
                Aura will never ask for OTP, card CVV, or password over call, chat, or social media.
                If you see suspicious activity, use official support channels immediately.
              </p>
            </div>
          </div>
        </section>

        {content.cta?.to && (
          <div className="pt-2">
            <Link
              to={content.cta.to}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-neo-cyan/20 border border-neo-cyan/40 text-neo-cyan font-bold text-sm hover:bg-neo-cyan/30 transition-colors"
            >
              {content.cta.label}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

