jest.mock('@azure/storage-blob', () => ({
    BlobServiceClient: {
        fromConnectionString: jest.fn(),
    },
}));

describe('reviewMediaStorageService', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('uses local storage by default', async () => {
        delete process.env.UPLOAD_STORAGE_DRIVER;
        const service = require('../services/reviewMediaStorageService');

        expect(service.getStorageDriver()).toBe('local');
    });

    test('stores media in Azure Blob when azure-blob driver is enabled', async () => {
        process.env.UPLOAD_STORAGE_DRIVER = 'azure-blob';
        process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
        process.env.AZURE_STORAGE_CONTAINER_NAME = 'review-media';
        const { BlobServiceClient } = require('@azure/storage-blob');

        const uploadData = jest.fn().mockResolvedValue(undefined);
        const createIfNotExists = jest.fn().mockResolvedValue(undefined);
        const getBlockBlobClient = jest.fn().mockReturnValue({ uploadData });
        const getContainerClient = jest.fn().mockReturnValue({
            createIfNotExists,
            getBlockBlobClient,
        });
        BlobServiceClient.fromConnectionString.mockReturnValue({
            getContainerClient,
        });

        const service = require('../services/reviewMediaStorageService');
        const result = await service.storeReviewMedia({
            fileBuffer: Buffer.from('hello'),
            fileName: 'proof.png',
            mimeType: 'image/png',
        });

        expect(service.getStorageDriver()).toBe('azure-blob');
        expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith('UseDevelopmentStorage=true');
        expect(getContainerClient).toHaveBeenCalledWith('review-media');
        expect(createIfNotExists).toHaveBeenCalled();
        expect(uploadData).toHaveBeenCalled();
        expect(result.storageDriver).toBe('azure-blob');
        expect(result.url).toMatch(/^\/uploads\/reviews\//);
    });
});
