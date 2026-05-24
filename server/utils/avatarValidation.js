const AVATAR_UPLOAD_MAX_BYTES = Number(process.env.AVATAR_UPLOAD_MAX_BYTES || 2 * 1024 * 1024);
const AVATAR_UPLOAD_ALLOWED_MIME = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);

module.exports = {
    AVATAR_UPLOAD_MAX_BYTES,
    AVATAR_UPLOAD_ALLOWED_MIME,
};
