import { ShieldAlert } from 'lucide-react';
import { useEmergencyStatus } from '@/context/EmergencyStatusContext';

const EmergencyBanner = () => {
    const {
        bannerMessage,
        maintenance,
        readOnly,
    } = useEmergencyStatus();

    if (!bannerMessage && !maintenance && !readOnly) {
        return null;
    }

    const message = bannerMessage
        || (maintenance
            ? 'We are temporarily performing emergency maintenance. Please try again later.'
            : 'The system is temporarily in read-only mode.');

    return (
        <div className="relative z-40 border border-amber-200 bg-amber-100 px-4 py-2 text-amber-700 shadow-sm">
            <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{message}</span>
            </div>
        </div>
    );
};

export default EmergencyBanner;
