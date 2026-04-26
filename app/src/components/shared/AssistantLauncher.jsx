import { Brain, CornerDownLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { pushClientDiagnostic } from '@/services/clientObservability';
import {
    buildAssistantWorkspacePath,
    isAdminPath,
    isAssistantWorkspacePath,
    shouldShowAssistantLauncher,
} from '@/services/assistantUiConfig';

const AssistantLauncher = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const hasMobileStickyCommerceBar = location.pathname.startsWith('/product/');

    if (
        isAssistantWorkspacePath(location.pathname)
        || isAdminPath(location.pathname)
        || !shouldShowAssistantLauncher({ pathname: location.pathname })
    ) {
        return null;
    }

    return (
        <div
            className={[
                'aura-assistant-launcher pointer-events-none fixed bottom-4 right-4 z-[72] flex items-end justify-end sm:bottom-6 sm:right-6',
                hasMobileStickyCommerceBar ? 'hidden sm:flex sm:bottom-6' : '',
            ].filter(Boolean).join(' ')}
        >
            <button
                type="button"
                aria-label="Open the focused commerce copilot"
                onClick={() => {
                    pushClientDiagnostic('assistant_workspace.launcher_opened', {
                        context: {
                            originPath: `${location.pathname || '/'}${location.search || ''}`,
                        },
                    });
                    navigate(buildAssistantWorkspacePath(location));
                }}
                className="aura-floating-utility aura-floating-utility--assistant pointer-events-auto flex items-center gap-3 rounded-full border px-3 py-3 text-left text-slate-50 transition-transform duration-300 hover:-translate-y-0.5"
            >
                <div className="aura-floating-utility__icon flex h-11 w-11 items-center justify-center rounded-full border">
                    <Brain className="h-5 w-5" />
                </div>
                <div className="aura-floating-utility__copy hidden sm:block">
                    <p className="aura-floating-utility__eyebrow text-[10px] font-black uppercase tracking-[0.18em]">Assistant Workspace</p>
                    <p className="aura-floating-utility__title text-sm font-semibold">Open the focused commerce copilot</p>
                </div>
                <CornerDownLeft className="aura-floating-utility__hint hidden h-4 w-4 sm:block" />
            </button>
        </div>
    );
};

export default AssistantLauncher;
