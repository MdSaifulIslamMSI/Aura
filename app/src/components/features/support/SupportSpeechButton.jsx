import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const SupportSpeechButton = ({
    supportsSpeechInput = false,
    isListening = false,
    onToggle,
    disabled = false,
    idleLabel = 'Voice draft',
    activeLabel = 'Stop voice',
    className = '',
}) => {
    if (!supportsSpeechInput) {
        return null;
    }

    return (
        <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            className={cn(
                'support-chat-utility inline-flex items-center justify-center gap-2 px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55',
                isListening ? 'border-rose-300/20 bg-rose-500/12 text-rose-100' : '',
                className
            )}
        >
            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {isListening ? activeLabel : idleLabel}
        </button>
    );
};

export default SupportSpeechButton;
