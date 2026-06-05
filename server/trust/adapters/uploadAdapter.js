const loadUploadResource = async (req = {}) => {
    const actorId = String(req.user?._id || req.user?.id || '').trim();
    const uploadId = String(req.body?.uploadId || req.body?.uploadToken || req.params?.uploadId || 'review-media').trim();
    return {
        id: uploadId,
        type: 'upload',
        resourceType: 'upload',
        ownerId: actorId,
        userId: actorId,
        state: req.body?.scanState || req.body?.status || 'pending',
        mimeType: req.body?.mimeType || '',
        sizeBytes: Number(req.body?.sizeBytes || 0),
    };
};

module.exports = {
    loadUploadResource,
};
