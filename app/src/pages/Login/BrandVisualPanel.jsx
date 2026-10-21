import { Heart, PackageCheck, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

export const AuraBrand = ({ compact = false, t }) => (
  <Link
    to="/"
    className={compact ? 'login-brand login-brand--compact' : 'login-brand'}
    // No aria-label on purpose. axe-core 4.14 enables `label-content-name-mismatch`
    // by default, and that rule compares the visible text of an explicitly
    // labelled element against its accessible name word by word. The visible
    // text here includes the decorative monogram, which is aria-hidden and so
    // must stay out of the accessible name - no aria-label string can satisfy
    // the rule. Letting the name come from the content gives it "Aura", which
    // is exactly the visible wordmark.
  >
    <span className="login-brand__mark" aria-hidden="true">
      <span>{t('login.brand.initials', {}, 'AR')}</span>
    </span>
    <span className="login-brand__wordmark">Aura</span>
  </Link>
);

const benefits = [
  {
    icon: Heart,
    id: 'saved',
    label: (t) => t('login.editorial.benefit.saved', {}, 'Your edit'),
  },
  {
    icon: PackageCheck,
    id: 'orders',
    label: (t) => t('login.editorial.benefit.orders', {}, 'Order archive'),
  },
  {
    icon: Sparkles,
    id: 'personal',
    label: (t) => t('login.editorial.benefit.personal', {}, 'Private by design'),
  },
];

const BrandVisualPanel = ({ t: legacyT }) => {
  const t = useStableIcuMessages(legacyT);

  return (
    <aside
      className="login-editorial"
      aria-label={t('login.editorial.label', {}, 'Aura member benefits')}
    >
      <div className="login-editorial__media" aria-hidden="true" />
      <div className="login-editorial__grain" aria-hidden="true" />

      <div className="login-editorial__top">
        <AuraBrand t={t} />
        <span className="login-editorial__edition">
          {t('login.editorial.edition', {}, 'Private access / 01')}
        </span>
      </div>

      <div className="login-editorial__story">
        <p className="login-editorial__eyebrow">
          {t('login.editorial.eyebrow', {}, 'Your Aura, held in one place')}
        </p>
        <h2>{t('login.editorial.title', {}, 'Everything you chose. Still here.')}</h2>
        <p className="login-editorial__copy">
          {t(
            'login.editorial.copy',
            {},
            'Saved pieces, orders, preferences, and the next thing worth finding—remembered privately.'
          )}
        </p>

        <ul className="login-editorial__benefits" aria-label={t('login.editorial.benefitsLabel', {}, 'Member benefits')}>
          {benefits.map(({ icon: Icon, id, label }) => (
            <li key={id}>
              <Icon aria-hidden="true" />
              <span>{label(t)}</span>
            </li>
          ))}
        </ul>

        <div className="login-editorial__trust">
          <ShieldCheck aria-hidden="true" />
          <span>{t('login.editorial.trust', {}, 'Protected by multi-step verification')}</span>
        </div>
      </div>
    </aside>
  );
};

export default BrandVisualPanel;
