import * as FileSystem from 'expo-file-system';
import { APP_DIRECTORY } from '../app/constants';
import { savePhoto } from '../app/utils/security';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///private/files/',
  cacheDirectory: 'file:///private/cache/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('expo-local-authentication', () => ({}));
jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: { encryptCapturedPhoto: jest.fn() },
}));

const copy = jest.mocked(FileSystem.copyAsync);
const remove = jest.mocked(FileSystem.deleteAsync);
const getInfo = jest.mocked(FileSystem.getInfoAsync);
const encrypt = jest.mocked(PhotoVault.encryptCapturedPhoto);

beforeEach(() => {
  jest.clearAllMocks();
  getInfo.mockResolvedValue({ exists: true } as FileSystem.FileInfo);
  copy.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
  encrypt.mockResolvedValue({
    filename: 'photo-00000000-0000-0000-0000-000000000001.scv',
    sourceRemoved: true,
  });
});

test('saves camera URI only through native encrypted capture and returns encrypted gallery leaf', async () => {
  const saved = await savePhoto('file:///private/camera/original.jpg');
  expect(copy).toHaveBeenCalledWith(
    expect.objectContaining({
      from: 'file:///private/camera/original.jpg',
      to: expect.stringMatching(
        /^file:\/\/\/private\/cache\/.secret-camera\/capture-/
      ),
    })
  );
  const staged = (copy.mock.calls[0][0] as { to: string }).to;
  expect(encrypt).toHaveBeenCalledWith(staged.replace('file://', ''));
  expect(saved.uri).toBe(
    `${APP_DIRECTORY.SECRET_CAMERA}/photo-00000000-0000-0000-0000-000000000001.scv`
  );
  expect(saved.sourceRemoved).toBe(true);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('file:///private/camera/original.jpg', {
    idempotent: true,
  });
  expect(encrypt.mock.invocationCallOrder[0]).toBeGreaterThan(
    copy.mock.invocationCallOrder[0]
  );
});

test('encryption failure rejects and never copies camera source to gallery', async () => {
  encrypt.mockRejectedValue(new Error('native failure'));
  await expect(
    savePhoto('file:///private/camera/original.jpg')
  ).rejects.toThrow('native failure');
  expect(copy).toHaveBeenCalledTimes(1);
  expect(copy.mock.calls[0][0]).not.toMatchObject({
    to: expect.stringContaining('/files/.secret-camera/'),
  });
  expect(remove).toHaveBeenCalledWith(
    expect.stringContaining('.secret-camera/capture-'),
    { idempotent: true }
  );
});

test('rejects non-file camera URI without staging plaintext', async () => {
  await expect(savePhoto('content://provider/photo')).rejects.toThrow(
    'Invalid camera capture'
  );
  expect(copy).not.toHaveBeenCalled();
  expect(encrypt).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test('committed ciphertext remains successful when original-source cleanup fails', async () => {
  remove.mockImplementation(async (uri) => {
    if (uri === 'file:///private/camera/original.jpg')
      throw new Error('cleanup denied');
  });
  const result = await savePhoto('file:///private/camera/original.jpg');
  expect(result.uri).toContain('.scv');
  expect(result.sourceRemoved).toBe(false);
});
