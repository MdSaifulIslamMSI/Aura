const fs = require('fs');
const os = require('os');
const path = require('path');

describe('local avatar media storage', () => {
    let tempDir;
    let service;

    beforeEach(() => {
        jest.resetModules();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-avatar-media-'));
        process.env.UPLOAD_STORAGE_DRIVER = 'local';
        process.env.AVATAR_UPLOAD_DIR = tempDir;
        service = require('../services/avatarMediaStorageService');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete process.env.AVATAR_UPLOAD_DIR;
    });

    test('keeps normalized media private until finalize then serves the immutable object', async () => {
        const pending = await service.quarantineAvatarMedia({
            fileBuffer: Buffer.from('normalized-webp'),
            ownerId: '507f1f77bcf86cd799439180',
        });

        expect(pending.storageKey).toMatch(/^[A-Za-z0-9_-]+\.webp$/);
        await expect(service.getAvatarMediaObject({ storageKey: pending.storageKey }))
            .rejects.toMatchObject({ code: 404 });
        await expect(service.getQuarantinedAvatarMedia({ storageKey: pending.storageKey }))
            .resolves.toEqual(Buffer.from('normalized-webp'));

        const promoted = await service.promoteAvatarMedia({ storageKey: pending.storageKey });
        expect(promoted.url).toBe(`/uploads/avatars/${pending.storageKey}`);
        const stored = await service.getAvatarMediaObject({ storageKey: pending.storageKey });
        expect(stored.contentType).toBe('image/webp');
        expect(stored.cacheControl).toContain('immutable');
        const chunks = [];
        for await (const chunk of stored.body) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(Buffer.from('normalized-webp'));
    });

    test('cleans stale quarantine files without deleting fresh uploads', async () => {
        const stale = await service.quarantineAvatarMedia({
            fileBuffer: Buffer.from('stale'),
            ownerId: 'owner',
        });
        const fresh = await service.quarantineAvatarMedia({
            fileBuffer: Buffer.from('fresh'),
            ownerId: 'owner',
        });
        const stalePath = path.join(tempDir, '.quarantine', stale.storageKey);
        const old = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
        fs.utimesSync(stalePath, old, old);

        await expect(service.cleanupStaleAvatarQuarantine())
            .resolves.toEqual({ removed: 1 });
        await expect(service.getQuarantinedAvatarMedia({ storageKey: stale.storageKey })).rejects.toThrow();
        await expect(service.getQuarantinedAvatarMedia({ storageKey: fresh.storageKey }))
            .resolves.toEqual(Buffer.from('fresh'));
    });

    test('dry-runs and deletes only old final objects not referenced by a user', async () => {
        const referenced = await service.quarantineAvatarMedia({
            fileBuffer: Buffer.from('referenced'),
            ownerId: 'owner',
        });
        const orphaned = await service.quarantineAvatarMedia({
            fileBuffer: Buffer.from('orphaned'),
            ownerId: 'owner',
        });
        await service.promoteAvatarMedia({ storageKey: referenced.storageKey });
        await service.promoteAvatarMedia({ storageKey: orphaned.storageKey });
        const old = new Date(Date.now() - (8 * 24 * 60 * 60 * 1000));
        fs.utimesSync(path.join(tempDir, referenced.storageKey), old, old);
        fs.utimesSync(path.join(tempDir, orphaned.storageKey), old, old);

        await expect(service.cleanupOrphanedAvatarMedia({
            referencedKeys: [referenced.storageKey],
            dryRun: true,
        })).resolves.toEqual({ removed: 1 });
        expect(fs.existsSync(path.join(tempDir, orphaned.storageKey))).toBe(true);

        await expect(service.cleanupOrphanedAvatarMedia({
            referencedKeys: [referenced.storageKey],
        })).resolves.toEqual({ removed: 1 });
        expect(fs.existsSync(path.join(tempDir, referenced.storageKey))).toBe(true);
        await expect(service.getAvatarMediaObject({ storageKey: orphaned.storageKey }))
            .rejects.toMatchObject({ code: 404 });
    });
});
