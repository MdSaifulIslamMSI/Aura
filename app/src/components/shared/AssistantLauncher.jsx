import { Brain, CornerDownLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { pushClientDiagnostic } from '@/services/clientObservability';
import {
    buildAssistantWorkspacePath,
    isAdminPath,
    isAssistantWorkspacePath,
} from '@/services/assistantUiConfig';

const AssistantLauncher = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const hasMobileStickyCommerceBar = location.pathname.startsWith('/product/');

    if (isAssistantWorkspacePath(location.pathname) || isAdminPath(location.pathname)) {
        return null;
    }

    return (
        <div
            className={[
                'pointer-events-none fixed inset-0 z-[2147483600] flex items-end justify-end p-4 sm:p-6',
                hasMobileStickyCommerceBar ? 'pb-[calc(7.25rem+env(safe-area-inset-bottom))] sm:pb-6' : '',
            ].filter(Boolean).join(' ')}
        >
            <button
                type="button"
                onClick={() => {
                    pushClientDiagnostic('assistant_v2.launcher_opened', {
                        context: {
                            originPath: `${location.pathname || '/'}${location.search || ''}`,
                        },
                    });
                    navigate(buildAssistantWorkspacePath(location));
                }}
                className="pointer-events-auto flex items-center gap-3 rounded-full border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(8,12,24,0.96),rgba(14,23,42,0.94))] px-4 py-3 text-left text-slate-50 shadow-[0_22px_60px_rgba(2,6,23,0.52)] backdrop-blur-xl transition-transform duration-300 hover:-translate-y-0.5"
            >
                <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-400/12 text-cyan-100">
                    <Brain className="h-5 w-5" />
                </div>
                <div className="hidden sm:block">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">Assistant Workspace</p>
                    <p className="text-sm font-semibold">Open the focused commerce copilot</p>
                </div>
                <CornerDownLeft className="hidden h-4 w-4 text-cyan-100/70 sm:block" />
            </button>
        </div>
    );
};

export default AssistantLauncher;
