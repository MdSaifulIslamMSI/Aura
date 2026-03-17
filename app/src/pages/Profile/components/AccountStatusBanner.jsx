import React from 'react';
import { AlertTriangle, AlertOctagon, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AccountStatusBanner({ accountState, moderation }) {
    if (!accountState || accountState === 'active') return null;

    if (accountState === 'warned') {
        return (
            <div className="bg-orange-500/10 border-l-4 border-orange-500 p-4 mb-8 rounded-r-xl flex items-start gap-4">
                <AlertTriangle className="w-6 h-6 text-orange-500 shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-orange-400 font-bold text-lg">Account Warning</h3>
                    <p className="text-orange-200 mt-1">
                        Your account has received a warning ({moderation?.warningCount || 1} total). 
                        Please adhere to our community guidelines to avoid suspension.
                    </p>
                    {moderation?.lastWarningReason && (
                        <div className="mt-3 p-3 bg-orange-950/30 rounded-lg border border-orange-500/20 text-orange-200/80 text-sm">
                            <span className="font-semibold block mb-1 text-orange-300">Reason:</span>
                            {moderation.lastWarningReason}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (accountState === 'suspended') {
        const untilDate = moderation?.suspendedUntil ? new Date(moderation.suspendedUntil).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : 'Indefinitely';

        return (
            <div className="bg-rose-500/10 border-l-4 border-rose-500 p-4 mb-8 rounded-r-xl flex items-start gap-4">
                <AlertOctagon className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-rose-400 font-bold text-lg">Account Suspended</h3>
                    <p className="text-rose-200 mt-1">
                        Your account has been suspended until <span className="font-semibold text-rose-100">{untilDate}</span>. 
                        Some features like purchasing or selling may be restricted.
                    </p>
                    {moderation?.suspensionReason && (
                        <div className="mt-3 p-3 bg-rose-950/30 rounded-lg border border-rose-500/20 text-rose-200/80 text-sm">
                            <span className="font-semibold block mb-1 text-rose-300">Reason:</span>
                            {moderation.suspensionReason}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    if (accountState === 'deleted') {
        return (
            <div className="bg-zinc-800/50 border-l-4 border-zinc-500 p-4 mb-8 rounded-r-xl flex items-start gap-4">
                <XCircle className="w-6 h-6 text-zinc-400 shrink-0 mt-0.5" />
                <div>
                    <h3 className="text-zinc-300 font-bold text-lg">Account Deleted</h3>
                    <p className="text-zinc-400 mt-1">
                        This account is scheduled for permanent deletion.
                    </p>
                </div>
            </div>
        );
    }

    return null;
}
