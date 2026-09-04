// Mock dependencies (must precede the controller require: jest.mock calls in
// this repo are not hoisted past a top-level require)
jest.mock('../models/User');
jest.mock('../services/authProfileVault');
jest.mock('../middleware/authMiddleware');
jest.mock('../services/authSecurityTelemetryService');
jest.mock('../services/avatarImageService', () => ({
  normalizeAvatarImage: jest.fn(),
}));
jest.mock('../services/avatarMediaStorageService', () => ({
  deleteAvatarMedia: jest.fn(),
  promoteAvatarMedia: jest.fn(),
  quarantineAvatarMedia: jest.fn(),
}));

const { updateUserProfile } = require('../controllers/userController');

describe('User Controller - Avatar Validation', () => {
  let req, res, next;
  let User;

  beforeEach(() => {
    req = {
      user: { _id: 'test-user-id', email: 'test@example.com' },
      body: {}
    };
    res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    next = jest.fn();

    // Mock User.findOneAndUpdate
    User = require('../models/User');
    const { normalizeAvatarImage } = require('../services/avatarImageService');
    const {
      deleteAvatarMedia,
      promoteAvatarMedia,
      quarantineAvatarMedia,
    } = require('../services/avatarMediaStorageService');
    User.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ avatarMedia: { storageKey: '' } }),
    });
    normalizeAvatarImage.mockResolvedValue({
      fileBuffer: Buffer.from('normalized-webp'),
      mimeType: 'image/webp',
      sizeBytes: 1024,
      width: 512,
      height: 512,
    });
    quarantineAvatarMedia.mockResolvedValue({ storageKey: 'quarantine-key', storageDriver: 'local' });
    promoteAvatarMedia.mockResolvedValue({
      storageKey: 'quarantine-key',
      storageDriver: 'local',
      url: '/uploads/avatars/quarantine-key',
    });
    deleteAvatarMedia.mockResolvedValue(undefined);
    User.findOneAndUpdate.mockResolvedValue({
      _id: 'test-user-id',
      email: 'test@example.com',
      name: 'Test User',
      avatar: '',
      gender: '',
      dob: null,
      bio: '',
      isAdmin: false,
      isVerified: false,
      isSeller: false,
      sellerActivatedAt: null,
      accountState: 'active',
      moderation: {},
      addresses: [],
      wishlist: []
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateUserProfile', () => {
    it('should reject non-string avatar', async () => {
      req.body.avatar = 123;

      await updateUserProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Avatar must be a string',
          statusCode: 400
        })
      );
    });

    it('should allow empty string avatar (clears avatar and media metadata)', async () => {
      req.body.avatar = '';

      await updateUserProfile(req, res, next);

      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { email: 'test@example.com' },
        {
          $set: { avatar: '', avatarMedia: null },
          $inc: { __v: 1 }
        },
        { returnDocument: 'after', projection: expect.any(String), lean: true }
      );
      expect(res.json).toHaveBeenCalled();
    });

    it('should reject invalid data URI format', async () => {
      req.body.avatar = 'not-a-data-uri';

      await updateUserProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid avatar format. Must be a data URI.',
          statusCode: 400
        })
      );
    });

    it('should reject unsupported MIME type', async () => {
      req.body.avatar = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

      await updateUserProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unsupported avatar image type. Only JPEG, PNG, and WebP are allowed.',
          statusCode: 400
        })
      );
    });

    it('should reject oversized avatar', async () => {
      // Create a base64 string larger than 2MB
      const largeBase64 = 'A'.repeat(3 * 1024 * 1024); // 3MB
      req.body.avatar = `data:image/jpeg;base64,${largeBase64}`;

      await updateUserProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Avatar too large'),
          statusCode: 400
        })
      );
    });

    it('should reject mismatched magic bytes', async () => {
      // PNG header but claiming to be JPEG
      const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      req.body.avatar = `data:image/jpeg;base64,${pngBase64}`;

      await updateUserProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Avatar content does not match declared image type',
          statusCode: 400
        })
      );
    });

    it('should normalize a valid JPEG avatar through the shared media pipeline', async () => {
      // 1x1 pixel JPEG
      const jpegBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQECAQECAQEBAQICAwICAgQDAwIDBQMFBQUEBAQFBgcGBQUHBgcIBwcHCgsKGh4eHh4eIRERERUVFRUVFRUVERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgL/2wBBAQEBAQIDAwMDAwQEBBAQIECAgICAgQEBAQEBBQUEBAQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5/ooooA//2Q==';
      req.body.avatar = `data:image/jpeg;base64,${jpegBase64}`;

      await updateUserProfile(req, res, next);

      expect(User.findOneAndUpdate).toHaveBeenCalledWith(
        { email: 'test@example.com' },
        {
          $set: expect.objectContaining({
            avatar: '/uploads/avatars/quarantine-key',
            avatarMedia: expect.objectContaining({
              storageKey: 'quarantine-key',
              mimeType: 'image/webp',
            }),
          }),
          $inc: { __v: 1 }
        },
        { returnDocument: 'after', projection: expect.any(String), lean: true }
      );
      expect(res.json).toHaveBeenCalled();
    });
  });
});
