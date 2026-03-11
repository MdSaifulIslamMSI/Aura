import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck, UserRound, UserX } from 'lucide-react';
import AdminPremiumShell, { AdminHeroStat, AdminPremiumPanel, AdminPremiumSubpanel } from '@/components/shared/AdminPremiumShell';
import PremiumSelect from '@/components/ui/premium-select';
import { adminApi } from '@/services/api';

const LIMIT = 25;

const stateBadgeClass = {
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warned: 'border-amber-200 bg-amber-50 text-amber-700',
    suspended: 'border-rose-200 bg-rose-50 text-rose-700',
    deleted: 'border-slate-300 bg-slate-100 text-slate-700',
};

const accountStateLabel = (value) => {
    if (!value) return 'unknown';
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
};

const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

export default function AdminUsers() {
    const [loading, setLoading] = useState(true);
    const [users, setUsers] = useState([]);
    const [stats, setStats] = useState({ active: 0, warned: 0, suspended: 0, deleted: 0 });
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [filters, setFilters] = useState({
        search: '',
        accountState: '',
        isSeller: '',
        isVerified: '',
    });

    const [selectedUserId, setSelectedUserId] = useState('');
    const [detailLoading, setDetailLoading] = useState(false);
    const [detail, setDetail] = useState(null);
    const [actionBusy, setActionBusy] = useState('');
    const [reason, setReason] = useState('');
    const [durationHours, setDurationHours] = useState(72);
    const [scrubPII, setScrubPII] = useState(false);

    const selectedUser = detail?.user || null;

    const loadUsers = useCallback(async () => {
        try {
            setLoading(true);
            const response = await adminApi.listUsers({
                page,
                limit: LIMIT,
                search: filters.search.trim() || undefined,
                accountState: filters.accountState || undefined,
                isSeller: filters.isSeller || undefined,
                isVerified: filters.isVerified || undefined,
            });
            const nextUsers = Array.isArray(response?.users) ? response.users : [];
            setUsers(nextUsers);
            setStats(response?.stats || { active: 0, warned: 0, suspended: 0, deleted: 0 });
            setTotal(Number(response?.total || 0));
            setPages(Math.max(Number(response?.pages || 1), 1));

            if (!selectedUserId && nextUsers.length > 0) {
                setSelectedUserId(String(nextUsers[0]._id));
            } else if (selectedUserId && !nextUsers.some((entry) => String(entry._id) === String(selectedUserId))) {
                setSelectedUserId(nextUsers.length > 0 ? String(nextUsers[0]._id) : '');
            }
        } catch (error) {
            toast.error(error.message || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }, [filters.accountState, filters.isSeller, filters.isVerified, filters.search, page, selectedUserId]);

    const loadDetail = useCallback(async () => {
        if (!selectedUserId) {
            setDetail(null);
            return;
        }

        try {
            setDetailLoading(true);
            const response = await adminApi.getUserDetails(selectedUserId);
            setDetail(response || null);
        } catch (error) {
            toast.error(error.message || 'Failed to load user details');
        } finally {
            setDetailLoading(false);
        }
    }, [selectedUserId]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    useEffect(() => {
        loadDetail();
    }, [loadDetail]);

    const runAction = async (actionKey, actionFn, payload) => {
        if (!selectedUserId) {
            toast.error('Select a user first');
            return;
        }
        try {
            setActionBusy(actionKey);
            const response = await actionFn(selectedUserId, payload);
            toast.success(response?.message || 'Action completed');
            await Promise.all([loadUsers(), loadDetail()]);
        } catch (error) {
            toast.error(error.message || 'Action failed');
        } finally {
            setActionBusy('');
        }
    };

    const stateCounts = useMemo(() => ([
        { key: 'active', label: 'Active', value: Number(stats.active || 0), icon: <ShieldCheck className="h-4 w-4" /> },
        { key: 'warned', label: 'Warned', value: Number(stats.warned || 0), icon: <AlertTriangle className="h-4 w-4" /> },
        { key: 'suspended', label: 'Suspended', value: Number(stats.suspended || 0), icon: <ShieldAlert className="h-4 w-4" /> },
        { key: 'deleted', label: 'Deleted', value: Number(stats.deleted || 0), icon: <UserX className="h-4 w-4" /> },
    ]), [stats.active, stats.deleted, stats.suspended, stats.warned]);

    return (
        <AdminPremiumShell
            eyebrow="Trust governance"
            title="User governance center"
            description="Warn, suspend, reactivate, and soft-delete users from a premium moderation surface with strong audit visibility."
            actions={(
                <div className="admin-premium-tag">
                    Total users in filter: <span className="font-semibold">{total}</span>
                </div>
            )}
            stats={stateCounts.map((item) => (
                <AdminHeroStat key={item.key} label={item.label} value={item.value} detail="Current filtered cohort" icon={item.icon} />
            ))}
        >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <AdminPremiumPanel className="xl:col-span-5">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <input
                            value={filters.search}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, search: event.target.value }));
                            }}
                            className="admin-premium-control"
                            placeholder="Search name/email/phone"
                        />
                        <PremiumSelect
                            value={filters.accountState}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, accountState: event.target.value }));
                            }}
                            className="admin-premium-control"
                        >
                            <option value="">All states</option>
                            <option value="active">Active</option>
                            <option value="warned">Warned</option>
                            <option value="suspended">Suspended</option>
                            <option value="deleted">Deleted</option>
                        </PremiumSelect>
                        <PremiumSelect
                            value={filters.isVerified}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, isVerified: event.target.value }));
                            }}
                            className="admin-premium-control"
                        >
                            <option value="">All verification</option>
                            <option value="true">Verified</option>
                            <option value="false">Unverified</option>
                        </PremiumSelect>
                        <PremiumSelect
                            value={filters.isSeller}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, isSeller: event.target.value }));
                            }}
                            className="admin-premium-control"
                        >
                            <option value="">All seller states</option>
                            <option value="true">Seller</option>
                            <option value="false">Non-seller</option>
                        </PremiumSelect>
                    </div>

                    <div className="admin-premium-table-shell mt-4 overflow-x-auto">
                        <table className="admin-premium-table min-w-full text-sm">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>State</th>
                                    <th>Verified</th>
                                    <th>Seller</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-slate-400">
                                            <span className="inline-flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading users...
                                            </span>
                                        </td>
                                    </tr>
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-slate-400">No users found</td>
                                    </tr>
                                ) : (
                                    users.map((entry) => (
                                        <tr
                                            key={entry._id}
                                            className={`cursor-pointer transition ${String(selectedUserId) === String(entry._id) ? 'bg-white/10 ring-1 ring-[rgb(var(--theme-primary-rgb))]/25' : 'hover:bg-white/5'}`}
                                            onClick={() => setSelectedUserId(String(entry._id))}
                                        >
                                            <td className="py-2 pr-3">
                                                <p className="font-semibold admin-premium-text-strong">{entry.name || 'Unnamed User'}</p>
                                                <p className="text-xs admin-premium-text-muted">{entry.email || '-'}</p>
                                            </td>
                                            <td className="py-2 pr-3">
                                                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${stateBadgeClass[entry.accountState] || stateBadgeClass.active}`}>
                                                    {accountStateLabel(entry.accountState)}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3">{entry.isVerified ? 'Yes' : 'No'}</td>
                                            <td className="py-2 pr-3">{entry.isSeller ? 'Yes' : 'No'}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                            className="admin-premium-button px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <span className="text-sm admin-premium-text-muted">Page {page} / {pages}</span>
                        <button
                            type="button"
                            disabled={page >= pages}
                            onClick={() => setPage((prev) => Math.min(prev + 1, pages))}
                            className="admin-premium-button px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                </AdminPremiumPanel>

                <AdminPremiumPanel className="xl:col-span-7">
                    {!selectedUserId ? (
                        <div className="flex min-h-[26rem] h-full items-center justify-center admin-premium-text-muted">
                            Select a user to view governance controls
                        </div>
                    ) : detailLoading ? (
                        <div className="flex min-h-[26rem] h-full items-center justify-center admin-premium-text-muted">
                            <span className="inline-flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading user details...
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <AdminPremiumSubpanel>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="admin-premium-text-strong text-lg font-bold">{selectedUser?.name || 'Unnamed User'}</p>
                                        <p className="admin-premium-text text-sm">{selectedUser?.email || '-'}</p>
                                        <p className="admin-premium-text-muted text-xs">{selectedUser?.phone || 'No phone on file'}</p>
                                    </div>
                                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${stateBadgeClass[selectedUser?.accountState] || stateBadgeClass.active}`}>
                                        {accountStateLabel(selectedUser?.accountState)}
                                    </span>
                                </div>
                                <div className="admin-premium-text mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                                    <p>Orders: <span className="admin-premium-text-strong font-semibold">{detail?.metrics?.orders || 0}</span></p>
                                    <p>Listings: <span className="admin-premium-text-strong font-semibold">{detail?.metrics?.listings || 0}</span></p>
                                    <p>Active listings: <span className="admin-premium-text-strong font-semibold">{detail?.metrics?.activeListings || 0}</span></p>
                                    <p>Payments: <span className="admin-premium-text-strong font-semibold">{detail?.metrics?.paymentIntents || 0}</span></p>
                                </div>
                            </AdminPremiumSubpanel>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                    <label className="premium-kicker">Reason</label>
                                    <textarea
                                        value={reason}
                                        onChange={(event) => setReason(event.target.value)}
                                        rows={3}
                                        className="admin-premium-control mt-1"
                                        placeholder="Required for warning/suspend/delete"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="premium-kicker">Suspension Duration (hours)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={24 * 365}
                                        value={durationHours}
                                        onChange={(event) => setDurationHours(Number(event.target.value || 72))}
                                        className="admin-premium-control"
                                    />
                                    <label className="admin-premium-text inline-flex items-center gap-2 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={scrubPII}
                                            onChange={(event) => setScrubPII(event.target.checked)}
                                        />
                                        Scrub PII on delete
                                    </label>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                                <button
                                    type="button"
                                    onClick={() => runAction('warn', adminApi.warnUser, { reason })}
                                    disabled={actionBusy !== '' || reason.trim().length < 5}
                                    className="admin-premium-button px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    {actionBusy === 'warn' ? '...' : 'Warn'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction('suspend', adminApi.suspendUser, { reason, durationHours })}
                                    disabled={actionBusy !== '' || reason.trim().length < 5}
                                    className="admin-premium-button admin-premium-button-danger px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    {actionBusy === 'suspend' ? '...' : 'Suspend'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction('dismiss', adminApi.dismissWarning, { reason })}
                                    disabled={actionBusy !== ''}
                                    className="admin-premium-button px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    {actionBusy === 'dismiss' ? '...' : 'Dismiss Warning'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction('reactivate', adminApi.reactivateUser, { reason })}
                                    disabled={actionBusy !== ''}
                                    className="admin-premium-button admin-premium-button-success px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    {actionBusy === 'reactivate' ? '...' : 'Reactivate'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!window.confirm('Soft-delete this user account?')) return;
                                        runAction('delete', adminApi.deleteUser, { reason, scrubPII });
                                    }}
                                    disabled={actionBusy !== '' || reason.trim().length < 5}
                                    className="admin-premium-button admin-premium-button-danger px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    {actionBusy === 'delete' ? '...' : 'Delete'}
                                </button>
                            </div>

                            <div>
                                <h3 className="premium-kicker mb-2">Governance Timeline</h3>
                                <div className="admin-premium-table-shell admin-premium-scroll max-h-[20rem] overflow-auto">
                                    <table className="admin-premium-table min-w-full text-sm">
                                        <thead>
                                            <tr>
                                                <th>Action</th>
                                                <th>Reason</th>
                                                <th>Actor</th>
                                                <th>Time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Array.isArray(detail?.logs) && detail.logs.length > 0 ? (
                                                detail.logs.map((entry) => (
                                                    <tr key={entry.actionId}>
                                                        <td className="px-3 py-2 font-semibold admin-premium-text-strong">{String(entry.actionType || '').replace('_', ' ')}</td>
                                                        <td className="px-3 py-2 admin-premium-text">{entry.reason || '-'}</td>
                                                        <td className="px-3 py-2 admin-premium-text">{entry.actorEmail || '-'}</td>
                                                        <td className="px-3 py-2 admin-premium-text">{formatDateTime(entry.createdAt)}</td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={4} className="px-3 py-6 text-center admin-premium-text-muted">No governance actions yet</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </AdminPremiumPanel>
            </div>

            <p className="admin-premium-text-muted inline-flex items-center gap-1 text-xs">
                <UserRound className="h-3.5 w-3.5" />
                Admin controls are enforced server-side with strict audit logging.
            </p>
        </AdminPremiumShell>
    );
}
