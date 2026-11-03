import { runPhotoOperation } from '../app/utils/photoOperation';
import { importPendingSharedImages } from '../app/utils/sharedImageImport';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: {
    listPendingImageShares: jest.fn(),
    consumePendingImageShare: jest.fn(),
    acknowledgePendingImageShare: jest.fn(),
    consumePendingImageShareFailure: jest.fn(),
    importPendingImageShare: jest.fn(),
  },
}));

const pendingId = '00000000-0000-4000-8000-000000000001';
const list = jest.mocked(PhotoVault.listPendingImageShares);
const consume = jest.mocked(PhotoVault.consumePendingImageShare);
const commit = jest.mocked(PhotoVault.importPendingImageShare);
const ack = jest.mocked(PhotoVault.acknowledgePendingImageShare);
const consumeFailure = jest.mocked(PhotoVault.consumePendingImageShareFailure);

beforeEach(() => {
  jest.resetAllMocks();
  consumeFailure.mockResolvedValue(false);
  list.mockResolvedValue([
    {
      id: pendingId,
      uri: 'file:///private/pending.jpg',
      mimeType: 'image/jpeg',
    },
  ]);
  consume.mockResolvedValue({
    id: pendingId,
    uri: 'file:///private/pending.jpg',
    mimeType: 'image/jpeg',
  });
  commit.mockImplementation(async (_id, enabled) => ({
    filename: `photo-share-${pendingId}.${enabled ? 'scv' : 'jpg'}`,
  }));
  ack.mockResolvedValue(undefined);
});

test.each([true, false])(
  'passes persisted automatic-encryption setting explicitly (%s)',
  async (enabled) => {
    const result = await importPendingSharedImages(enabled);
    expect(commit).toHaveBeenCalledWith(pendingId, enabled);
    expect(ack).toHaveBeenCalledWith(pendingId);
    expect(result.imported).toEqual([
      expect.stringContaining(
        `photo-share-${pendingId}.${enabled ? 'scv' : 'jpg'}`
      ),
    ]);
    expect(result.failed).toBe(0);
    expect(result.stageFailure).toBe(false);
  }
);

test('pre-commit failure can retry with changed setting without acknowledging the request', async () => {
  commit.mockRejectedValueOnce(
    new Error('synthetic failure before publication')
  );
  const failed = await importPendingSharedImages(true);
  expect(failed).toEqual({ imported: [], failed: 1, stageFailure: false });
  expect(ack).not.toHaveBeenCalled();
  commit.mockResolvedValueOnce({ filename: `photo-share-${pendingId}.jpg` });
  const retried = await importPendingSharedImages(false);
  expect(commit).toHaveBeenNthCalledWith(1, pendingId, true);
  expect(commit).toHaveBeenNthCalledWith(2, pendingId, false);
  expect(retried.failed).toBe(0);
  expect(retried.stageFailure).toBe(false);
  expect(ack).toHaveBeenCalledTimes(1);
});

test('reports a persisted receive failure even when no pending image was published', async () => {
  consumeFailure.mockResolvedValue(true);
  list.mockResolvedValue([]);
  const result = await importPendingSharedImages(false);
  expect(result).toEqual({ imported: [], failed: 0, stageFailure: true });
  expect(commit).not.toHaveBeenCalled();
  expect(ack).not.toHaveBeenCalled();
});

test('single-flight guard rejects overlapping photo operations', async () => {
  let release!: () => void;
  const first = runPhotoOperation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  await Promise.resolve();
  await expect(runPhotoOperation(async () => undefined)).rejects.toThrow(
    'already running'
  );
  release();
  await first;
});
