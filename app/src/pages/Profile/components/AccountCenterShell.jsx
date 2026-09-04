import { Camera, CalendarDays, CheckCircle2, ChevronDown, ShieldAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

const getStateIcon = (accountState) => (
    accountState === 'active' ? CheckCircle2 : ShieldAlert
);

const getStateTone = (accountState) => {
    if (accountState === 'active') return 'text-emerald-200';
    if (accountState === 'warned') return 'text-amber-200';
    return 'text-rose-200';
};

export default function AccountCenterShell({
    tabs,
    activeTab,
    onTabChange,
    profile,
    pageTitle,
    pageDescription,
    memberSince,
    profileCompletion,
    accountState,
    accountStateLabel,
    overviewMetrics = [],
    onAvatarClick,
    avatarUploading = false,
    isOnline = true,
    notice,
    banner,
    children,
}) {
    const t = useStableIcuMessages();
    const StateIcon = getStateIcon(accountState);
    const pageTitleRef = useRef(null);
    const previousTabRef = useRef(activeTab);

    useEffect(() => {
        if (previousTabRef.current !== activeTab) {
            pageTitleRef.current?.focus({ preventScroll: false });
            previousTabRef.current = activeTab;
        }
    }, [activeTab]);

    return (
        <div className="account-center-layout mx-auto grid w-full max-w-[92rem] grid-cols-1 gap-6 px-3 pb-16 pt-4 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:px-4 lg:pt-6">
            <a
                href="#account-center-content"
                className="sr-only fixed left-4 top-4 z-[100] rounded-lg bg-slate-950 px-4 py-3 font-black text-white focus:not-sr-only focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
                {t('profile.accountCenter.skipToContent', {}, 'Skip to account content')}
            </a>
            <aside className="account-center-rail sticky top-24 hidden min-h-[40rem] max-h-[calc(100vh-7.5rem)] flex-col overflow-hidden rounded-xl border lg:flex">
                <div className="grid gap-1 px-5 pb-4 pt-6">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-[#d2a96c]">
                        {t('profile.accountCenter.memberEyebrow', {}, 'Aura member')}
                    </span>
                    <span className="text-lg font-black text-[#fffaf0]">
                        {t('profile.accountCenter.title', {}, 'Account center')}
                    </span>
                </div>

                <div className="mx-3 mb-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
                    <button
                        type="button"
                        className="relative grid h-[52px] w-[52px] place-items-center rounded-xl border border-white/20 bg-white/10 font-black text-[#fffaf0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                        onClick={onAvatarClick}
                        disabled={avatarUploading}
                        aria-busy={avatarUploading || undefined}
                        aria-label={avatarUploading
                            ? t('profile.accountCenter.photoUploadingAria', {}, 'Profile photo upload in progress')
                            : t('profile.accountCenter.changePhotoAria', {}, 'Change profile photo')}
                    >
                        {profile.avatar ? (
                            <img
                                src={profile.avatar}
                                alt=""
                                width="52"
                                height="52"
                                className="h-full w-full rounded-[inherit] object-cover"
                            />
                        ) : (
                            <span aria-hidden="true">{profile.initials}</span>
                        )}
                        <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-lg bg-[#f4efe6] text-[#17231e]" aria-hidden="true">
                            <Camera size={15} strokeWidth={1.8} />
                        </span>
                    </button>
                    <div className="flex min-w-0 flex-col">
                        <strong className="truncate text-sm text-[#fffaf0]">{profile.name}</strong>
                        <span className="truncate text-xs text-[#aeb8b1]">
                            {profile.email || t('profile.accountCenter.noEmail', {}, 'No email on file')}
                        </span>
                    </div>
                </div>

                <nav
                    className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4"
                    aria-label={t('profile.accountCenter.sectionsAria', {}, 'Account sections')}
                >
                    {tabs.map((tab) => {
                        const isCurrent = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 text-left text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${isCurrent
                                    ? 'border-[#d2a96c]/30 bg-[#d2a96c]/10 text-[#f3c982]'
                                    : 'border-transparent text-[#c5cec8] hover:bg-white/5 hover:text-[#fffaf0]'}`}
                                onClick={() => onTabChange(tab.id)}
                                aria-current={isCurrent ? 'page' : undefined}
                            >
                                <tab.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </nav>

                <div className="mx-3 mb-3 flex items-center gap-2 border-t border-white/10 p-3 text-xs text-[#aeb8b1]">
                    <CalendarDays className="h-4 w-4 text-[#d2a96c]" aria-hidden="true" />
                    <span>
                        {t('profile.accountCenter.memberSince', { date: memberSince }, 'Member since {date}')}
                    </span>
                </div>
            </aside>

            <div className="min-w-0">
                <div className="account-center-mobile-nav mb-4 grid grid-cols-1 gap-4 rounded-xl border p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] md:items-end lg:hidden">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#d2a96c]/40 bg-white/5 font-black text-white" aria-hidden="true">
                            {profile.avatar ? (
                                <img
                                    src={profile.avatar}
                                    alt=""
                                    width="44"
                                    height="44"
                                    className="h-full w-full object-cover"
                                />
                            ) : profile.initials}
                        </span>
                        <div className="flex min-w-0 flex-col">
                            <strong className="truncate text-sm text-white">{profile.name}</strong>
                            <span className="truncate text-xs text-slate-400">
                                {t('profile.accountCenter.title', {}, 'Account center')}
                            </span>
                        </div>
                    </div>
                    <label className="grid gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-400">
                        <span>{t('profile.accountCenter.sectionLabel', {}, 'Account section')}</span>
                        <div className="relative">
                            <select
                                aria-label={t('profile.accountCenter.sectionLabel', {}, 'Account section')}
                                value={activeTab}
                                onChange={(event) => onTabChange(event.target.value)}
                                className="min-h-11 w-full appearance-none rounded-lg border border-white/10 bg-slate-900 px-3 pr-10 text-sm font-bold normal-case text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
                            >
                                {tabs.map((tab) => (
                                    <option key={tab.id} value={tab.id}>{tab.label}</option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        </div>
                    </label>
                </div>

                <header className="account-center-header relative mb-4 flex flex-col gap-5 overflow-hidden rounded-xl border p-5 md:flex-row md:items-start md:justify-between md:p-6">
                    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d2a96c]/70 to-transparent" />
                    <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-0 h-48 w-72 rounded-full bg-[#d2a96c]/10 blur-3xl" />
                    <div className="relative">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#d2a96c]">
                            {t('profile.accountCenter.title', {}, 'Account center')}
                        </p>
                        <h1
                            id="account-center-page-title"
                            ref={pageTitleRef}
                            tabIndex={-1}
                            className="account-center-page-title mt-1 text-3xl font-black tracking-tight outline-none sm:text-4xl"
                        >
                            {pageTitle}
                        </h1>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{pageDescription}</p>
                    </div>
                    <dl className="relative grid min-w-0 gap-3 text-sm md:min-w-52">
                        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                            <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                {t('profile.accountCenter.statusLabel', {}, 'Account status')}
                            </dt>
                            <dd className={`inline-flex items-center gap-1.5 font-black ${getStateTone(accountState)}`}>
                                <StateIcon className="h-4 w-4" aria-hidden="true" />
                                {accountStateLabel}
                            </dd>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
                            <dt className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                {t('profile.accountCenter.profileLabel', {}, 'Profile')}
                            </dt>
                            <dd className="font-black text-white">
                                {t(
                                    'profile.accountCenter.completion',
                                    { percent: profileCompletion },
                                    '{percent}% complete'
                                )}
                            </dd>
                        </div>
                    </dl>
                </header>

                {banner}

                {!isOnline ? (
                    <div className="account-center-network-status" role="status" aria-live="polite">
                        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                            <strong>{t('profile.accountCenter.offlineTitle', {}, 'You are offline.')}</strong>{' '}
                            {t(
                                'profile.accountCenter.offlineBody',
                                {},
                                'Saved account details remain visible, but changes wait until you reconnect.'
                            )}
                        </span>
                    </div>
                ) : null}

                {notice}

                {activeTab === 'overview' && overviewMetrics.length > 0 ? (
                    <section className="account-center-summary mb-4 rounded-xl border" aria-labelledby="account-health-title">
                        <h2 id="account-health-title" className="px-5 pt-4 text-xs font-black uppercase tracking-widest text-slate-400">
                            {t('profile.accountCenter.atAGlance', {}, 'At a glance')}
                        </h2>
                        <div className="grid grid-cols-1 p-3 sm:grid-cols-2 xl:grid-cols-4">
                            {overviewMetrics.map((metric) => (
                                <div key={metric.label} className="flex min-w-0 flex-col border-b border-white/10 p-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                                    <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">{metric.label}</span>
                                    <strong className="text-2xl font-black text-white">{metric.value}</strong>
                                    <small className="truncate text-xs text-slate-400">{metric.detail}</small>
                                </div>
                            ))}
                        </div>
                    </section>
                ) : null}

                <main
                    id="account-center-content"
                    className="min-w-0 outline-none"
                    aria-labelledby="account-center-page-title"
                    tabIndex={-1}
                >
                    {children}
                </main>
            </div>
        </div>
    );
}
