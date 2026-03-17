import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file for upload'));
    reader.readAsDataURL(file);
});

export const uploadApi = {
    signReviewMediaUpload: async ({ fileName, mimeType, sizeBytes }) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/uploads/reviews/sign', { 
            method: 'POST', 
            headers, 
            body: JSON.stringify({ fileName, mimeType, sizeBytes }) 
        });
        return data;
    },
    uploadSignedReviewMedia: async ({ uploadToken, file }) => {
        const dataUrl = await fileToDataUrl(file);
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/uploads/reviews/upload', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                uploadToken,
                fileName: file?.name || 'review-media',
                mimeType: file?.type || '',
                dataUrl,
            }),
        });
        return data;
    },
    uploadReviewMediaFromFile: async (file) => {
        const signData = await uploadApi.signReviewMediaUpload({
            fileName: file?.name || 'review-media',
            mimeType: file?.type || '',
            sizeBytes: file?.size || 0,
        });
        return uploadApi.uploadSignedReviewMedia({
            uploadToken: signData.uploadToken,
            file,
        });
    },
};
