import * as FileSystem from 'expo-file-system';
import { convertGallery } from '../app/utils/galleryConversion';
import { getPhotoOperationSnapshot } from '../app/utils/photoOperation';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

jest.mock('expo-file-system', () => ({
  __esModule: true,
  documentDirectory: 'file:///private/files/',
  readDirectoryAsync: jest.fn(),
}));
jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: {
    migrateLegacyGalleryPhotos: jest.fn(),
    decryptGalleryPhoto: jest.fn(),
  },
}));

const readDirectory = jest.mocked(FileSystem.readDirectoryAsync);
const migrate = jest.mocked(PhotoVault.migrateLegacyGalleryPhotos);
const decrypt = jest.mocked(PhotoVault.decryptGalleryPhoto);

beforeEach(() => {
  jest.clearAllMocks();
  readDirectory.mockResolvedValue([
    'plain.jpg',
    'private.jpeg',
    'already.scv',
    'notes.txt',
  ]);
  migrate.mockResolvedValue({
    migrated: 2,
    remaining: 0,
    failed: 0,
    errorCode: null,
  });
  decrypt.mockResolvedValue('decrypted-photo.jpg');
});

test('bulk encrypt delegates mixed gallery to canonical migration and leaves toggle untouched', async () => {
  await expect(convertGallery('encrypt')).resolves.toBe('Encrypted 2 photos.');
  expect(migrate).toHaveBeenCalledTimes(1);
  expect(decrypt).not.toHaveBeenCalled();
  expect(getPhotoOperationSnapshot()).toMatchObject({
    running: false,
    result: 'Encrypted 2 photos.',
  });
});

test('bulk decrypt serially converts ciphertext and reports failures without deleting sources', async () => {
  readDirectory.mockResolvedValue([
    'plain.jpg',
    'one.scv',
    'broken.scv',
    'metadata.json',
  ]);
  decrypt.mockImplementation(async (name) => {
    if (name === 'broken.scv') throw new Error('authentication failed');
    return 'decrypted-one.jpg';
  });
  await expect(convertGallery('decrypt')).resolves.toContain(
    'Decrypted 1; 1 failed and remain encrypted'
  );
  expect(decrypt.mock.calls).toEqual([['one.scv'], ['broken.scv']]);
  expect(migrate).not.toHaveBeenCalled();
  expect(getPhotoOperationSnapshot()).toMatchObject({
    running: false,
    result: expect.stringContaining('1 failed'),
  });
});
