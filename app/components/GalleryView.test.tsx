import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import GalleryView from './GalleryView';

let backHandler: (() => boolean) | undefined;
const mockImageViewSpy = jest.fn((_props: unknown) => null);
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///synthetic/',
  readDirectoryAsync: jest.fn(),
}));
jest.mock('../utils/encryptedPhotoView', () => ({
  usePhotoView: () => ({ view: null, error: false }),
}));
jest.mock('./ImageView', () => (props: unknown) => mockImageViewSpy(props));
jest.mock('../../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: {
    migrateLegacyGalleryPhotos: jest.fn(),
    deleteGalleryPhoto: jest.fn(),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => ({
  BackHandler: {
    addEventListener: jest.fn((_name, handler) => {
      backHandler = handler;
      return { remove() {} };
    }),
  },
  Dimensions: { get: () => ({ width: 400 }) },
  FlatList: ({ data, renderItem }: any) =>
    jest
      .requireActual('react')
      .createElement(
        'View',
        null,
        ...data.map((item: string, index: number) =>
          renderItem({ item, index })
        )
      ),
  Image: 'Image',
  StyleSheet: { create: (value: unknown) => value },
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const fs = jest.requireMock('expo-file-system') as {
  readDirectoryAsync: jest.Mock;
};
const migrate = PhotoVault.migrateLegacyGalleryPhotos as jest.Mock;
const mount = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <GalleryView onClose={jest.fn()} onShareState={jest.fn()} />
    );
    await Promise.resolve();
  });
  return tree;
};
const pressMigration = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findByProps({ accessibilityLabel: 'Encrypt existing photos' })
    .props.onPress();
const tiles = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('TouchableOpacity' as any)
    .filter((x) => x.props.style?.padding === 2);

beforeEach(() => {
  fs.readDirectoryAsync.mockReset().mockResolvedValue(['old.jpg', 'new.scv']);
  migrate.mockReset();
  mockImageViewSpy.mockClear();
  backHandler = undefined;
});

describe('Gallery legacy migration action', () => {
  it('keeps tiles blocked while native migration is pending; back consumes without closing', async () => {
    const pending = deferred<any>();
    migrate.mockReturnValue(pending.promise);
    const onClose = jest.fn();
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <GalleryView onClose={onClose} onShareState={jest.fn()} />
      );
      await Promise.resolve();
    });
    const before = fs.readDirectoryAsync.mock.calls.length;
    await act(async () => {
      pressMigration(tree);
    });
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(backHandler?.()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      tiles(tree).forEach((tile) => tile.props.onPress());
    });
    expect(mockImageViewSpy).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ migrated: 1, remaining: 0, failed: 0 });
      await pending.promise;
    });
    expect(fs.readDirectoryAsync).toHaveBeenCalledTimes(before + 1);
    expect(
      tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props
        .children
    ).toMatch(/Encrypted 1 photos/);
  });

  it('joins the same pending migration after unmount/remount, then permits selection after success', async () => {
    const pending = deferred<any>();
    migrate.mockReturnValue(pending.promise);
    const first = await mount();
    await act(async () => {
      pressMigration(first);
    });
    await act(async () => {
      first.unmount();
    });
    const second = await mount();
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(tiles(second)).toHaveLength(0);
    await act(async () => {
      tiles(second).forEach((tile) => tile.props.onPress());
    });
    expect(mockImageViewSpy).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve({ migrated: 2, remaining: 0, failed: 0 });
      await pending.promise;
    });
    expect(mockImageViewSpy).not.toHaveBeenCalled();
    expect(tiles(second)).toHaveLength(2);
    await act(async () => {
      tiles(second)[0].props.onPress();
    });
    expect(mockImageViewSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      second.unmount();
    });
  });

  it('single-flights rapid presses and preserves originals/reloads after native rejection', async () => {
    const pending = deferred<any>();
    migrate.mockReturnValue(pending.promise);
    const tree = await mount();
    const before = fs.readDirectoryAsync.mock.calls.length;
    await act(async () => {
      pressMigration(tree);
      pressMigration(tree);
    });
    expect(migrate).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ migrated: 1, remaining: 1, failed: 1 });
      await pending.promise;
    });
    expect(fs.readDirectoryAsync).toHaveBeenCalledTimes(before + 1);
    expect(
      tree.root.findByProps({ accessibilityLiveRegion: 'polite' }).props
        .children
    ).toMatch(/Original files are retained/);
    await act(async () => {
      tree.unmount();
    });
  });
});
