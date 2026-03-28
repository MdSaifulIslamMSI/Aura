import { useContext, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, Store, CheckCircle2, Phone, BadgeCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';

const RequirementRow = ({ ok, icon: Icon, label }) => (
  <div
    className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
      ok ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
    }`}
  >
    <Icon className="h-5 w-5 shrink-0" />
    <span className="text-sm font-semibold">{label}</span>
    <CheckCircle2 className={`ml-auto h-5 w-5 ${ok ? 'text-emerald-300' : 'text-rose-300'}`} />
  </div>
);

const BecomeSeller = () => {
  const navigate = useNavigate();
  const { dbUser, activateSeller, deactivateSeller } = useContext(AuthContext);
  const { t } = useMarket();
  const [pendingAction, setPendingAction] = useState('');

  const checks = useMemo(() => ({
    verified: Boolean(dbUser?.isVerified),
    hasPhone: Boolean(dbUser?.phone),
    isSeller: Boolean(dbUser?.isSeller),
  }), [dbUser]);

  const canActivate = checks.verified && checks.hasPhone && !checks.isSeller;
  const canDeactivate = checks.isSeller;

  const handleActivate = async () => {
    if (!canActivate) {
      if (!checks.hasPhone) {
        toast.error(t(
          'sellerBecome.error.addPhone',
          {},
          'Add a valid phone number in your profile before seller activation.'
        ));
      } else if (!checks.verified) {
        toast.error(t(
          'sellerBecome.error.verificationRequired',
          {},
          'Account verification is required before seller activation.'
        ));
      }
      return;
    }

    setPendingAction('activate');
    try {
      await activateSeller();
      toast.success(t(
        'sellerBecome.success.activated',
        {},
        'Seller mode activated. You can now post listings.'
      ));
      navigate('/sell', { replace: true });
    } catch (error) {
      toast.error(error?.message || t('sellerBecome.error.activateFailed', {}, 'Failed to activate seller mode'));
    } finally {
      setPendingAction('');
    }
  };

  const handleDeactivate = async () => {
    if (!canDeactivate) return;
    const confirmed = window.confirm(t(
      'sellerBecome.confirmDeactivate',
      {},
      'Deactivate seller mode? You will lose access to /sell until you activate it again.'
    ));
    if (!confirmed) return;

    setPendingAction('deactivate');
    try {
      await deactivateSeller();
      toast.success(t('sellerBecome.success.deactivated', {}, 'Seller mode deactivated.'));
      navigate('/marketplace', { replace: true });
    } catch (error) {
      toast.error(error?.message || t('sellerBecome.error.deactivateFailed', {}, 'Failed to deactivate seller mode'));
    } finally {
      setPendingAction('');
    }
  };

  return (
    <section className="container-custom py-10 sm:py-14">
      <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-zinc-950/80 p-6 sm:p-8 shadow-[0_0_40px_rgba(6,182,212,0.12)]">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl border border-cyan-400/40 bg-cyan-500/10 p-3">
            <Store className="h-7 w-7 text-cyan-300" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-100 sm:text-3xl">
              {t('sellerBecome.title', {}, 'Become a Seller')}
            </h1>
            <p className="mt-2 text-sm text-slate-400 sm:text-base">
              {t(
                'sellerBecome.body',
                {},
                'Seller mode protects marketplace quality. Only verified accounts with valid contact info can create listings.'
              )}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          <RequirementRow
            ok={checks.verified}
            icon={ShieldCheck}
            label={checks.verified
              ? t('sellerBecome.requirement.verified.ok', {}, 'Account verification complete')
              : t('sellerBecome.requirement.verified.missing', {}, 'Account verification required')}
          />
          <RequirementRow
            ok={checks.hasPhone}
            icon={Phone}
            label={checks.hasPhone
              ? t('sellerBecome.requirement.phone.ok', { phone: dbUser?.phone || '' }, `Phone on file: ${dbUser?.phone || ''}`)
              : t('sellerBecome.requirement.phone.missing', {}, 'Add phone number in profile')}
          />
          <RequirementRow
            ok={checks.isSeller}
            icon={BadgeCheck}
            label={checks.isSeller
              ? t('sellerBecome.requirement.mode.ok', {}, 'Seller mode already active')
              : t('sellerBecome.requirement.mode.missing', {}, 'Seller mode not active yet')}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {!checks.isSeller && (
            <button
              type="button"
              disabled={!canActivate || pendingAction.length > 0}
              onClick={handleActivate}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-neo-cyan to-neo-emerald px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition hover:from-sky-500 hover:to-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'activate'
                ? t('sellerBecome.activating', {}, 'Activating...')
                : t('sellerBecome.activate', {}, 'Activate Seller Mode')}
            </button>
          )}
          {checks.isSeller && (
            <>
              <Link
                to="/sell"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-neo-cyan to-neo-emerald px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 transition hover:from-sky-500 hover:to-emerald-500"
              >
                {t('sellerBecome.goToSell', {}, 'Go to Sell')}
              </Link>
              <button
                type="button"
                disabled={pendingAction.length > 0}
                onClick={handleDeactivate}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-300/30 bg-rose-500/10 px-5 py-3 text-sm font-black text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === 'deactivate'
                  ? t('sellerBecome.deactivating', {}, 'Deactivating...')
                  : t('sellerBecome.deactivate', {}, 'Deactivate Seller Mode')}
              </button>
            </>
          )}
          <Link
            to="/profile"
            className="rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-slate-200 transition hover:border-white/25 hover:bg-white/5"
          >
            {t('sellerBecome.openProfile', {}, 'Open Profile')}
          </Link>
        </div>
      </div>
    </section>
  );
};

export default BecomeSeller;
