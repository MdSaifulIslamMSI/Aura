import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, ShieldAlert, ShieldCheck, UserRound, UserX } from 'lucide-react';
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
        <div className="container mx-auto space-y-6 px-4 py-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Admin User Governance</h1>
                    <p className="text-sm text-slate-500">Warn, suspend, reactivate, and soft-delete users with full audit logs.</p>
                </div>
                <div className="rounded-lg border bg-white px-3 py-2 text-sm text-slate-600">
                    Total users in filter: <span className="font-semibold text-slate-900">{total}</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {stateCounts.map((item) => (
                    <div key={item.key} className="rounded-xl border bg-white p-3 shadow-sm">
                        <div className="flex items-center justify-between text-slate-500">
                            <span className="text-xs font-semibold uppercase tracking-wide">{item.label}</span>
                            {item.icon}
                        </div>
                        <p className="mt-2 text-2xl font-bold text-slate-900">{item.value}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
                <div className="rounded-xl border bg-white p-4 shadow-sm xl:col-span-5">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <input
                            value={filters.search}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, search: event.target.value }));
                            }}
                            className="rounded-lg border px-3 py-2 text-sm"
                            placeholder="Search name/email/phone"
                        />
                        <select
                            value={filters.accountState}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, accountState: event.target.value }));
                            }}
                            className="rounded-lg border px-3 py-2 text-sm"
                        >
                            <option value="">All states</option>
                            <option value="active">Active</option>
                            <option value="warned">Warned</option>
                            <option value="suspended">Suspended</option>
                            <option value="deleted">Deleted</option>
                        </select>
                        <select
                            value={filters.isVerified}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, isVerified: event.target.value }));
                            }}
                            className="rounded-lg border px-3 py-2 text-sm"
                        >
                            <option value="">All verification</option>
                            <option value="true">Verified</option>
                            <option value="false">Unverified</option>
                        </select>
                        <select
                            value={filters.isSeller}
                            onChange={(event) => {
                                setPage(1);
                                setFilters((prev) => ({ ...prev, isSeller: event.target.value }));
                            }}
                            className="rounded-lg border px-3 py-2 text-sm"
                        >
                            <option value="">All seller states</option>
                            <option value="true">Seller</option>
                            <option value="false">Non-seller</option>
                        </select>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="py-2 pr-3">User</th>
                                    <th className="py-2 pr-3">State</th>
                                    <th className="py-2 pr-3">Verified</th>
                                    <th className="py-2 pr-3">Seller</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-slate-500">
                                            <span className="inline-flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Loading users...
                                            </span>
                                        </td>
                                    </tr>
                                ) : users.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="py-8 text-center text-slate-500">No users found</td>
                                    </tr>
                                ) : (
                                    users.map((entry) => (
                                        <tr
                                            key={entry._id}
                                            className={`cursor-pointer border-t transition ${String(selectedUserId) === String(entry._id) ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}
                                            onClick={() => setSelectedUserId(String(entry._id))}
                                        >
                                            <td className="py-2 pr-3">
                                                <p className="font-semibold text-slate-900">{entry.name || 'Unnamed User'}</p>
                                                <p className="text-xs text-slate-500">{entry.email || '-'}</p>
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
                            className="rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Previous
                        </button>
                        <span className="text-sm text-slate-600">Page {page} / {pages}</span>
                        <button
                            type="button"
                            disabled={page >= pages}
                            onClick={() => setPage((prev) => Math.min(prev + 1, pages))}
                            className="rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Next
                        </button>
                    </div>
                </div>

                <div className="rounded-xl border bg-white p-4 shadow-sm xl:col-span-7">
                    {!selectedUserId ? (
                        <div className="flex h-full min-h-[26rem] items-center justify-center text-slate-500">
                            Select a user to view governance controls
                        </div>
                    ) : detailLoading ? (
                        <div className="flex h-full min-h-[26rem] items-center justify-center text-slate-500">
                            <span className="inline-flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Loading user details...
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-xl border bg-slate-50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="text-lg font-bold text-slate-900">{selectedUser?.name || 'Unnamed User'}</p>
                                        <p className="text-sm text-slate-600">{selectedUser?.email || '-'}</p>
                                        <p className="text-xs text-slate-500">{selectedUser?.phone || 'No phone on file'}</p>
                                    </div>
                                    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${stateBadgeClass[selectedUser?.accountState] || stateBadgeClass.active}`}>
                                        {accountStateLabel(selectedUser?.accountState)}
                                    </span>
                                </div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 md:grid-cols-4">
                                    <p>Orders: <span className="font-semibold text-slate-900">{detail?.metrics?.orders || 0}</span></p>
                                    <p>Listings: <span className="font-semibold text-slate-900">{detail?.metrics?.listings || 0}</span></p>
                                    <p>Active listings: <span className="font-semibold text-slate-900">{detail?.metrics?.activeListings || 0}</span></p>
                                    <p>Payments: <span className="font-semibold text-slate-900">{detail?.metrics?.paymentIntents || 0}</span></p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</label>
                                    <textarea
                                        value={reason}
                                        onChange={(event) => setReason(event.target.value)}
                                        rows={3}
                                        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                                        placeholder="Required for warning/suspend/delete"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suspension Duration (hours)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={24 * 365}
                                        value={durationHours}
                                        onChange={(event) => setDurationHours(Number(event.target.value || 72))}
                                        className="w-full rounded-lg border px-3 py-2 text-sm"
                                    />
                                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
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
                                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 disabled:opacity-50"
                                >
                                    {actionBusy === 'warn' ? '...' : 'Warn'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction('suspend', adminApi.suspendUser, { reason, durationHours })}
                                    disabled={actionBusy !== '' || reason.trim().length < 5}
                                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50"
                                >
                                    {actionBusy === 'suspend' ? '...' : 'Suspend'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction('dismiss', adminApi.dismissWarning, { reason })}
                                    disabled={actionBusy !== ''}
                                    className="rounded-lg border px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
                                >
                                    {actionBusy === 'dismiss' ? '...' : 'Dismiss Warning'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => runAction('reactivate', adminApi.reactivateUser, { reason })}
                                    disabled={actionBusy !== ''}
                                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-50"
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
                                    className="rounded-lg border border-slate-400 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
                                >
                                    {actionBusy === 'delete' ? '...' : 'Delete'}
                                </button>
                            </div>

                            <div>
                                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Governance Timeline</h3>
                                <div className="max-h-[20rem] overflow-auto rounded-lg border">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                            <tr>
                                                <th className="px-3 py-2">Action</th>
                                                <th className="px-3 py-2">Reason</th>
                                                <th className="px-3 py-2">Actor</th>
                                                <th className="px-3 py-2">Time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Array.isArray(detail?.logs) && detail.logs.length > 0 ? (
                                                detail.logs.map((entry) => (
                                                    <tr key={entry.actionId} className="border-t">
                                                        <td className="px-3 py-2 font-semibold text-slate-800">{String(entry.actionType || '').replace('_', ' ')}</td>
                                                        <td className="px-3 py-2 text-slate-600">{entry.reason || '-'}</td>
                                                        <td className="px-3 py-2 text-slate-600">{entry.actorEmail || '-'}</td>
                                                        <td className="px-3 py-2 text-slate-600">{formatDateTime(entry.createdAt)}</td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">No governance actions yet</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <p className="inline-flex items-center gap-1 text-xs text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
                Admin controls are enforced server-side with strict audit logging.
            </p>
        </div>
    );
}
