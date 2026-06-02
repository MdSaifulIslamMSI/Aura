import { useStableIcuMessages } from './useStableIcuMessages';

export const StableText = ({ defaultMessage = '', id, values = {} }) => {
    const t = useStableIcuMessages();

    return t(id, values, defaultMessage);
};
