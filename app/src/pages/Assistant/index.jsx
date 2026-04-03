import AssistantActionRail from './components/AssistantActionRail';
import AssistantContextRail from './components/AssistantContextRail';
import AssistantDisabledState from './components/AssistantDisabledState';
import AssistantHero from './components/AssistantHero';
import AssistantThreadPanel from './components/AssistantThreadPanel';
import { isAssistantV2Enabled } from '@/services/assistantFeatureFlags';
import { useAssistantWorkspace } from './useAssistantWorkspace';

const AssistantPage = () => {
    const assistantEnabled = isAssistantV2Enabled();
    const {
        cartSummary,
        formatPrice,
        handleAction,
        handleSubmit,
        inputValue,
        isLoading,
        lastAssistantWithActions,
        messages,
        originContext,
        originProduct,
        sessionId,
        setInputValue,
    } = useAssistantWorkspace();

    if (!assistantEnabled) {
        return <AssistantDisabledState />;
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-slate-100">
            <AssistantHero originContext={originContext} />

            <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[19rem_minmax(0,1fr)_18rem]">
                <AssistantContextRail
                    cartSummary={cartSummary}
                    formatPrice={formatPrice}
                    originContext={originContext}
                    originProduct={originProduct}
                />
                <AssistantThreadPanel
                    handleAction={handleAction}
                    handleSubmit={handleSubmit}
                    inputValue={inputValue}
                    isLoading={isLoading}
                    messages={messages}
                    sessionId={sessionId}
                    setInputValue={setInputValue}
                />
                <AssistantActionRail
                    handleAction={handleAction}
                    isLoading={isLoading}
                    lastAssistantWithActions={lastAssistantWithActions}
                />
            </div>
        </div>
    );
};

export default AssistantPage;
