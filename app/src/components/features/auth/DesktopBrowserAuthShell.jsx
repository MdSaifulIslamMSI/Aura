import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Shield, ShoppingBag } from 'lucide-react';
import { AuthFeedback } from '@/components/shared/AuthFeedback';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';
import { cn } from '@/lib/utils';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818]';
const primaryButton = cn(
  'flex min-h-[60px] w-full items-center justify-center gap-3 rounded-full bg-[#f7f7f7] px-6 py-4 text-base font-semibold text-[#181818] transition-colors',
  'hover:bg-white disabled:cursor-not-allowed disabled:bg-[#8c8c8c] disabled:text-[#242424]',
  focusRing
);
const secondaryButton = cn(
  'flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full border border-[#3f3f3f] bg-[#2a2a2a] px-6 py-4 text-base font-semibold text-slate-100 transition-colors',
  'hover:border-[#565656] hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-50',
  focusRing
);

const AuraMark = ({ compact = false }) => (
  <img
    src="/assets/icon-512.png"
    alt=""
    width={compact ? 22 : 56}
    height={compact ? 22 : 56}
    className={cn(
      'select-none rounded-[15px] shadow-[0_12px_34px_rgba(0,0,0,0.26)]',
      compact ? 'h-[22px] w-[22px] rounded-md shadow-none' : 'h-14 w-14'
    )}
  />
);

const DesktopBrowserAuthShell = ({
  authError,
  authSuccess,
  canUseDesktopOwnerAccessSignIn,
  desktopBrowserSignInPending,
  emergencyAuthDisabled,
  handleCancelDesktopBrowserSignIn,
  handleDesktopAdminSignIn,
  handleDesktopBrowserSignIn,
  handleDesktopOwnerAccessSignIn,
  handleFeedbackAction,
  handleReopenDesktopBrowserSignIn,
  isLoading,
  isSessionCheckpointPending,
  sessionStatus,
  t: legacyT,
}) => {
  const headingRef = useRef(null);
  const t = useStableIcuMessages(legacyT);
  const checkpointIsMfa = sessionStatus === 'mfa_challenge_required';
  const phase = isSessionCheckpointPending
    ? 'checkpoint'
    : desktopBrowserSignInPending
      ? 'pending'
      : isLoading
        ? 'loading'
        : authError
          ? 'error'
          : 'idle';

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const renderFeedback = () => (
    <>
      {authError ? (
        <div className="w-full text-left" aria-live="assertive">
          <AuthFeedback
            type="error"
            title={authError.title}
            detail={authError.detail}
            hint={authError.hint}
            actionLabel={authError.actionLabel}
            onAction={authError.action ? handleFeedbackAction : undefined}
          />
        </div>
      ) : null}
      {authSuccess && !desktopBrowserSignInPending ? (
        <div className="w-full text-left" aria-live="polite">
          <AuthFeedback type="success" title={authSuccess.title} detail={authSuccess.detail} />
        </div>
      ) : null}
    </>
  );

  return (
    <section
      aria-labelledby="desktop-auth-title"
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#181818] px-6 py-16 text-slate-50 sm:px-10"
      data-desktop-auth-phase={phase}
    >
      <div aria-hidden="true" className="fixed inset-x-0 top-0 z-10 h-10 [-webkit-app-region:drag]" />

      <div className="w-full max-w-[425px] [-webkit-app-region:no-drag]">
        {isSessionCheckpointPending ? (
          <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
            <AuraMark />
            <Loader2 className="mt-8 h-6 w-6 animate-spin text-slate-300 motion-reduce:animate-none" aria-hidden="true" />
            <h1
              ref={headingRef}
              tabIndex={-1}
              id="desktop-auth-title"
              className="mt-6 text-[2rem] font-medium leading-tight tracking-normal outline-none"
            >
              {checkpointIsMfa
                ? t('login.checkpoint.mfaTitle', {}, 'Complete multi-factor verification')
                : t('login.checkpoint.deviceTitle', {}, 'Verify this device')}
            </h1>
            <p className="mt-4 max-w-sm text-base leading-6 text-slate-400">
              {t(
                'login.checkpoint.body',
                {},
                'Finish the security checkpoint shown on this page. You will continue automatically only after the session is fully verified.'
              )}
            </p>
            <p className="mt-3 text-sm leading-5 text-slate-500">
              {t('login.checkpoint.stayHere', {}, 'Keep this page open. Do not submit your sign-in details again.')}
            </p>
          </div>
        ) : desktopBrowserSignInPending ? (
          <div className="flex flex-col items-center text-center" role="status" aria-live="polite" aria-busy="true">
            <AuraMark />
            <h1
              ref={headingRef}
              tabIndex={-1}
              id="desktop-auth-title"
              className="mt-9 text-[2rem] font-medium leading-tight tracking-normal outline-none"
            >
              {authSuccess?.title || t('login.desktopBrowser.startedTitle', {}, 'Continue in Your Browser')}
            </h1>
            <p className="mt-4 max-w-sm text-base leading-6 text-slate-400">
              {authSuccess?.detail || t(
                  'login.desktopBrowser.waitingDetail',
                  {},
                  'Finish sign-in in the browser window that just opened. Aura Desktop will continue automatically.'
                )}
            </p>

            <div className="mt-10 w-full space-y-4">
              <button type="button" onClick={handleCancelDesktopBrowserSignIn} className={secondaryButton}>
                {t('login.desktopBrowser.cancel', {}, 'Cancel browser sign-in')}
              </button>
              <button
                type="button"
                onClick={handleReopenDesktopBrowserSignIn}
                className={cn('mx-auto flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-slate-300 transition-colors hover:text-white', focusRing)}
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                {t('login.desktopBrowser.reopen', {}, 'Open browser again')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center">
            <AuraMark />
            <h1
              ref={headingRef}
              tabIndex={-1}
              id="desktop-auth-title"
              className="mt-8 text-[2.25rem] font-medium leading-[1.2] tracking-normal outline-none"
            >
              {t('login.desktopBrowser.welcomeTitle', {}, 'Welcome back')}
            </h1>
            <p className="mt-3 max-w-sm text-base leading-6 text-slate-400">
              {t('login.desktopBrowser.desktopDetail', {}, 'Use your browser to complete Aura sign-in securely.')}
            </p>

            <div className="mt-9 w-full space-y-4">
              {renderFeedback()}
              <button
                type="button"
                onClick={handleDesktopBrowserSignIn}
                disabled={isLoading || emergencyAuthDisabled}
                className={cn(primaryButton, 'justify-start text-left')}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <ShoppingBag className="h-5 w-5 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block">{t('nav.account', {}, 'Account')}</span>
                  <span className="mt-0.5 block text-xs font-medium leading-4 text-[#575757]">
                    {t('nav.accountSummary', {}, 'Profile, orders, and saved shopping links.')}
                  </span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={handleDesktopAdminSignIn}
                disabled={isLoading || emergencyAuthDisabled}
                className={cn(secondaryButton, 'justify-start text-left')}
              >
                <Shield className="h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block">{t('nav.adminPortal', {}, 'Admin portal')}</span>
                  <span className="mt-0.5 block text-xs font-medium leading-4 text-slate-400">
                    {t(
                      'profile.settings.devices.adminBody',
                      {},
                      'Admin access accepts only verified, user-verified passkeys. A remembered browser improves recognition but never satisfies admin MFA.'
                    )}
                  </span>
                </span>
                <ExternalLink className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              </button>

              {canUseDesktopOwnerAccessSignIn ? (
                <button
                  type="button"
                  onClick={handleDesktopOwnerAccessSignIn}
                  disabled={isLoading || emergencyAuthDisabled}
                  className={cn('mx-auto flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-slate-400 transition-colors hover:text-white', focusRing)}
                >
                  <Shield className="h-4 w-4" aria-hidden="true" />
                  {t('login.desktopOwnerAccess.button', {}, 'Owner Access')}
                </button>
              ) : null}

              <Link
                to="/marketplace"
                className={cn('mx-auto flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold text-slate-400 transition-colors hover:text-white', focusRing)}
              >
                <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                {t('desktopWelcome.openMarketplace', {}, 'Open marketplace')}
              </Link>
            </div>

            <p className="mt-7 text-sm leading-5 text-slate-400">
              {t(
                'login.desktopBrowser.signupHint',
                {},
                'New to Aura? Continue in the browser, then choose Sign up.'
              )}
            </p>

            <div className="mt-9 border-t border-[#333] pt-6 text-center text-sm leading-5 text-slate-500">
              <p>{t('login.securityWarning', {}, 'Keep passwords and verification codes private. Aura support will never ask you to share a code.')}</p>
              <p className="mt-4 text-xs">
                {t('login.terms.prefix', {}, 'By continuing, you accept our')}{' '}
                <Link to="/terms" className={cn('rounded underline underline-offset-2 hover:text-slate-300', focusRing)}>
                  {t('login.terms.use', {}, 'Terms of Use')}
                </Link>{' '}
                {t('login.terms.middle', {}, 'and')}{' '}
                <Link to="/privacy" className={cn('rounded underline underline-offset-2 hover:text-slate-300', focusRing)}>
                  {t('login.terms.privacy', {}, 'Privacy Policy')}
                </Link>.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default DesktopBrowserAuthShell;
