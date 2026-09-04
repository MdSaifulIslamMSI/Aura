import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, userApi } from '@/services/api';
import { isTrustedDeviceChallengeError } from '@/utils/authStepUp';
import {
    ACCOUNT_TELEMETRY_EVENTS,
    trackAccountEvent,
} from '@/services/accountTelemetry';
import {
    PROFILE_FIELDS,
    areProfileFormsEqual,
    createEditForm,
    normalizePhone,
    trimText,
    validateProfileForm,
} from './profileUtils';

const AVATAR_ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Avatar file could not be read.'));
    reader.readAsDataURL(file);
});

export function useProfileDeck({
    canUseProtectedProfileApis,
    currentUser,
    dbUser,
    showMsg,
    t,
    updateProfileInContext,
}) {
    const [profile, setProfile] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileSaving, setProfileSaving] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [editForm, setEditForm] = useState({});
    const [profileFieldErrors, setProfileFieldErrors] = useState({});
    const [profileSubmitError, setProfileSubmitError] = useState('');
    const [profileRequiresReauth, setProfileRequiresReauth] = useState(false);

    const fileInputRef = useRef(null);
    const editModeRef = useRef(false);

    useEffect(() => {
        editModeRef.current = editMode;
    }, [editMode]);

    const refreshProfileDeck = useCallback(async ({ silent = false } = {}) => {
        if (!canUseProtectedProfileApis) {
            setProfile(dbUser || null);
            setDashboard(null);
            setLoading(false);
            return null;
        }

        if (!silent) {
            setLoading(true);
        }

        try {
            const [profileData, dashData] = await Promise.all([
                userApi.getProfile({ firebaseUser: currentUser }),
                userApi.getAccountOverview({ firebaseUser: currentUser }),
            ]);

            setProfile(profileData);
            setDashboard(dashData);
            if (!editModeRef.current) {
                setEditForm(createEditForm(profileData));
            }

            return { profileData, dashData };
        } catch (error) {
            if (!isTrustedDeviceChallengeError(error)) {
                console.error('Profile fetch failed:', error);
            }
            if (dbUser) {
                setProfile((previous) => ({ ...(previous || {}), ...dbUser }));
                if (!editModeRef.current) {
                    setEditForm(createEditForm(dbUser));
                }
            }
            return null;
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }, [canUseProtectedProfileApis, currentUser, dbUser]);

    useEffect(() => {
        void refreshProfileDeck();
    }, [canUseProtectedProfileApis, refreshProfileDeck]);

    useEffect(() => {
        if (!dbUser) return;
        setProfile((previous) => ({ ...(previous || {}), ...dbUser }));
        setEditForm((previous) => ({
            ...previous,
            name: dbUser.name || previous.name || '',
            phone: dbUser.phone || previous.phone || '',
        }));
    }, [dbUser]);

    const handleEditModeChange = useCallback((nextMode) => {
        setEditMode(nextMode);
        if (!nextMode) {
            setProfileFieldErrors({});
            setProfileSubmitError('');
            setProfileRequiresReauth(false);
        }
    }, []);

    const cancelEdit = useCallback(() => {
        setEditMode(false);
        setEditForm(createEditForm(profile));
        setProfileFieldErrors({});
        setProfileSubmitError('');
        setProfileRequiresReauth(false);
    }, [profile]);

    const handleProfileFieldChange = useCallback((field, value) => {
        if (!PROFILE_FIELDS.includes(field)) return;
        setEditForm((previous) => ({ ...previous, [field]: value }));
        setProfileFieldErrors((previous) => {
            if (!previous[field]) return previous;
            const next = { ...previous };
            delete next[field];
            return next;
        });
        setProfileSubmitError('');
        setProfileRequiresReauth(false);
    }, []);

    const handleProfileFieldBlur = useCallback((field) => {
        if (!PROFILE_FIELDS.includes(field)) return;
        const errors = validateProfileForm(editForm, t);
        setProfileFieldErrors((previous) => {
            const next = { ...previous };
            if (errors[field]) {
                next[field] = errors[field];
            } else {
                delete next[field];
            }
            return next;
        });
    }, [editForm, t]);

    const profileDirty = useMemo(() => (
        !areProfileFormsEqual(editForm, createEditForm(profile))
    ), [editForm, profile]);

    const handleSaveProfile = useCallback(async (event) => {
        event?.preventDefault?.();
        if (profileSaving) return;

        const fieldErrors = validateProfileForm(editForm, t);
        if (Object.keys(fieldErrors).length > 0) {
            setProfileFieldErrors(fieldErrors);
            setProfileSubmitError(t('profile.personal.error.reviewFields', {}, 'Review the highlighted fields before saving.'));
            setProfileRequiresReauth(false);
            return;
        }

        const baselineForm = createEditForm(profile);
        if (areProfileFormsEqual(editForm, baselineForm)) {
            setProfileSubmitError(t('profile.personal.error.noChanges', {}, 'Make a change before saving.'));
            return;
        }
        const currentForm = editForm;

        setProfileSaving(true);
        setProfileFieldErrors({});
        setProfileSubmitError('');
        setProfileRequiresReauth(false);
        try {
            const payload = {
                ...editForm,
                phone: normalizePhone(editForm.phone),
                bio: trimText(editForm.bio),
                name: trimText(editForm.name),
                ...(Number.isInteger(profile?.version) ? { version: profile.version } : {}),
            };

            const updated = updateProfileInContext
                ? await updateProfileInContext(payload)
                : await userApi.updateProfile(payload);

            setProfile((previous) => ({ ...previous, ...updated }));
            setEditForm(createEditForm({ ...profile, ...updated }));
            setEditMode(false);
            setProfileFieldErrors({});
            setProfileSubmitError('');
            showMsg('success', t('profile.message.profileUpdated', {}, 'Profile updated successfully.'));
            trackAccountEvent(ACCOUNT_TELEMETRY_EVENTS.PROFILE_UPDATED, {
                changedFields: PROFILE_FIELDS.filter((field) => currentForm[field] !== baselineForm[field]),
            });
        } catch (error) {
            const serverErrors = Array.isArray(error?.data?.errors) ? error.data.errors : [];
            const nextFieldErrors = {};
            serverErrors.forEach((entry) => {
                const field = String(entry?.field || '').split('.').pop();
                if (PROFILE_FIELDS.includes(field)) {
                    nextFieldErrors[field] = entry.message;
                }
            });
            setProfileFieldErrors(nextFieldErrors);
            setProfileSubmitError(error.message || t('profile.message.profileUpdateFailed', {}, 'Failed to update profile.'));
            setProfileRequiresReauth(
                Boolean(editForm.phone !== baselineForm.phone && [401, 403].includes(Number(error?.status || 0)))
            );
        } finally {
            setProfileSaving(false);
        }
    }, [editForm, profile, profileSaving, showMsg, t, updateProfileInContext]);

    const handleAvatarChange = useCallback(async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = '';

        if (!AVATAR_ALLOWED_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
            showMsg('error', t(
                'profile.message.avatarTypeInvalid',
                {},
                'Choose a JPEG, PNG, or WebP image.'
            ));
            return;
        }
        if (file.size < 1 || file.size > AVATAR_MAX_BYTES) {
            showMsg('error', t(
                'profile.message.avatarSizeInvalid',
                {},
                'Choose an image smaller than 2 MB.'
            ));
            return;
        }

        setAvatarUploading(true);
        showMsg('info', t('profile.message.avatarPreparing', {}, 'Preparing secure avatar upload...'));
        try {
            const intent = await authApi.createAvatarUploadIntent({
                fileName: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
            }, { firebaseUser: currentUser });
            const dataUrl = await readFileAsDataUrl(file);
            showMsg('info', t('profile.message.avatarScanning', {}, 'Uploading, scanning, and normalizing your avatar...'));
            const uploaded = await authApi.uploadAvatarMedia({
                uploadToken: intent.uploadToken,
                fileName: file.name,
                mimeType: file.type,
                dataUrl,
            }, { firebaseUser: currentUser });
            showMsg('info', t('profile.message.avatarSaving', {}, 'Saving your new avatar...'));
            const updated = await authApi.finalizeAvatarMedia({
                finalizeToken: uploaded.finalizeToken,
            }, { firebaseUser: currentUser });
            userApi.clearAccountCache();
            setProfile((previous) => ({ ...previous, avatar: updated.avatar }));
            showMsg('success', t('profile.message.avatarUpdated', {}, 'Avatar updated.'));
        } catch (error) {
            showMsg('error', error.message || t('profile.message.avatarUpdateFailed', {}, 'Failed to update avatar.'));
        } finally {
            setAvatarUploading(false);
        }
    }, [currentUser, showMsg, t]);

    return {
        profile,
        setProfile,
        dashboard,
        loading,
        profileSaving,
        avatarUploading,
        editMode,
        handleEditModeChange,
        cancelEdit,
        editForm,
        handleProfileFieldChange,
        handleProfileFieldBlur,
        handleSaveProfile,
        handleAvatarChange,
        profileDirty,
        profileFieldErrors,
        profileSubmitError,
        profileRequiresReauth,
        fileInputRef,
        refreshProfileDeck,
    };
}
