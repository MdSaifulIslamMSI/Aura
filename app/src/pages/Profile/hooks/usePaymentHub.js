import { useCallback, useEffect, useRef, useState } from 'react';
import { intelligenceApi, paymentApi, userApi } from '@/services/api';
import { isTrustedDeviceChallengeError } from '@/utils/authStepUp';
import { openStripeSetupModal } from '@/utils/stripe';
import { isNotFoundError } from './profileUtils';

export function usePaymentHub({ canUseProtectedProfileApis, showMsg, t }) {
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
    const [netbankingCatalog, setNetbankingCatalog] = useState(null);
    const [netbankingCatalogLoading, setNetbankingCatalogLoading] = useState(false);
    const [rewards, setRewards] = useState(null);
    const [rewardsLoading, setRewardsLoading] = useState(false);
    const [intelligenceData, setIntelligenceData] = useState(null);
    const [intelligenceLoading, setIntelligenceLoading] = useState(false);
    const [optimizing, setOptimizing] = useState(false);
    const optimizeTimerRef = useRef(null);

    useEffect(() => () => {
        if (optimizeTimerRef.current) window.clearTimeout(optimizeTimerRef.current);
    }, []);

    const refreshPaymentMethods = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setPaymentMethods([]);
            setPaymentMethodsLoading(false);
            return [];
        }

        if (!silent) {
            setPaymentMethodsLoading(true);
        }
        try {
            const methodsResult = await paymentApi.getMethods();
            const nextMethods = Array.isArray(methodsResult)
                ? methodsResult
                : Array.isArray(methodsResult?.paymentMethods)
                    ? methodsResult.paymentMethods
                    : [];
            setPaymentMethods(nextMethods);
            return nextMethods;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Failed to load payment methods', error);
            }
            setPaymentMethods([]);
            return [];
        } finally {
            if (!silent) {
                setPaymentMethodsLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const refreshNetbankingCatalog = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setNetbankingCatalog(null);
            setNetbankingCatalogLoading(false);
            return null;
        }

        if (!silent) {
            setNetbankingCatalogLoading(true);
        }

        try {
            const catalog = await paymentApi.getNetbankingBanks();
            setNetbankingCatalog(catalog || { banks: [], featuredBanks: [] });
            return catalog;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Failed to load netbanking catalog', error);
            }
            if (!silent) {
                showMsg('error', error.message || t('profile.message.netbankingCatalogFailed', {}, 'Failed to load netbanking banks.'));
            }
            setNetbankingCatalog({ banks: [], featuredBanks: [], stale: true, source: 'unavailable' });
            return null;
        } finally {
            if (!silent) {
                setNetbankingCatalogLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, showMsg, t]);

    const refreshIntelligence = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setIntelligenceData(null);
            setIntelligenceLoading(false);
            return null;
        }

        if (!silent) {
            setIntelligenceLoading(true);
        }
        try {
            const nextData = await intelligenceApi.getLatestRewards();
            setIntelligenceData(nextData || null);
        } catch (error) {
            if (!isNotFoundError(error) && !isTrustedDeviceChallengeError(error)) {
                console.error('Intelligence fetch failed:', error);
            }
            setIntelligenceData(null);
        } finally {
            if (!silent) {
                setIntelligenceLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const refreshRewards = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setRewards(null);
            setRewardsLoading(false);
            return null;
        }

        if (!silent) {
            setRewardsLoading(true);
        }

        try {
            const result = await userApi.getRewards();
            setRewards(result?.rewards || result || null);
            return result?.rewards || result || null;
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Rewards fetch failed:', error);
            }
            setRewards(null);
            return null;
        } finally {
            if (!silent) {
                setRewardsLoading(false);
            }
        }
    }, [canUseProtectedProfileApis]);

    const handleSetDefaultMethod = useCallback(async (methodId) => {
        try {
            await paymentApi.setDefaultMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', t('profile.message.defaultPaymentUpdated', {}, 'Default payment method updated.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.defaultPaymentUpdateFailed', {}, 'Failed to update default payment method.'));
        }
    }, [refreshPaymentMethods, showMsg, t]);

    const handleDeletePaymentMethod = useCallback(async (methodId) => {
        try {
            await paymentApi.deleteMethod(methodId);
            await refreshPaymentMethods();
            showMsg('success', t('profile.message.paymentMethodDeleted', {}, 'Payment method deleted.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.paymentMethodDeleteFailed', {}, 'Failed to delete payment method.'));
        }
    }, [refreshPaymentMethods, showMsg, t]);

    const handleAddStripeCard = useCallback(async () => {
        try {
            const setup = await paymentApi.createMethodSetupIntent({ provider: 'stripe', type: 'card' });
            const setupIntent = await openStripeSetupModal({
                publishableKey: setup.publishableKey,
                clientSecret: setup.clientSecret,
                title: t('profile.payments.addCard.title', {}, 'Add card'),
                submitLabel: t('profile.payments.addCard.submit', {}, 'Save card'),
                cancelLabel: t('profile.payments.addCard.cancel', {}, 'Cancel'),
            });

            await paymentApi.saveMethod({
                provider: 'stripe',
                type: 'card',
                providerSetupIntentId: setupIntent.id || setup.setupIntentId,
                metadata: {
                    enrollmentSource: 'settings',
                },
            });
            await refreshPaymentMethods();
            showMsg('success', t('profile.message.cardSaved', {}, 'Card saved successfully.'));
        } catch (error) {
            if (/cancelled/i.test(String(error?.message || ''))) return;
            showMsg('error', error.message || t('profile.message.cardSaveFailed', {}, 'Failed to save card.'));
        }
    }, [refreshPaymentMethods, showMsg, t]);

    const handleSaveNetbankingBank = useCallback(async (bank) => {
        const bankCode = String(bank?.code || '').trim().toUpperCase();
        if (!bankCode) {
            showMsg('error', t('profile.message.bankRequired', {}, 'Choose a netbanking bank to save.'));
            return;
        }

        try {
            await paymentApi.saveMethod({
                provider: 'razorpay',
                type: 'bank',
                providerMethodId: bankCode,
                isDefault: paymentMethods.length === 0,
                metadata: {
                    enrollmentSource: 'settings',
                    bankCode,
                    bankName: bank?.name || bankCode,
                },
            });
            await Promise.all([
                refreshPaymentMethods(),
                refreshNetbankingCatalog({ silent: true }),
            ]);
            showMsg('success', t('profile.message.bankPreferenceSaved', {}, 'NetBanking bank saved.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.bankPreferenceFailed', {}, 'Failed to save netbanking bank.'));
        }
    }, [paymentMethods.length, refreshNetbankingCatalog, refreshPaymentMethods, showMsg, t]);

    const handleOptimizeRewards = useCallback(async () => {
        setOptimizing(true);
        try {
            await intelligenceApi.optimizeRewards();
            showMsg('success', t('profile.message.optimizationStarted', {}, 'Aura Intelligence optimization started. Fresh insights will appear shortly.'));
            if (optimizeTimerRef.current) window.clearTimeout(optimizeTimerRef.current);
            optimizeTimerRef.current = window.setTimeout(() => {
                void refreshIntelligence({ silent: true });
            }, 6000);
        } catch (error) {
            showMsg('error', error.message || t('profile.message.optimizationFailed', {}, 'Failed to start optimization.'));
        } finally {
            setOptimizing(false);
        }
    }, [refreshIntelligence, showMsg, t]);

    return {
        paymentMethods,
        paymentMethodsLoading,
        netbankingCatalog,
        netbankingCatalogLoading,
        rewards,
        rewardsLoading,
        intelligenceData,
        intelligenceLoading,
        optimizing,
        paymentHubActions: {
            refreshPaymentMethods,
            refreshNetbankingCatalog,
            refreshIntelligence,
            refreshRewards,
            handleSetDefaultMethod,
            handleDeletePaymentMethod,
            handleAddStripeCard,
            handleSaveNetbankingBank,
            handleOptimizeRewards,
        },
    };
}
