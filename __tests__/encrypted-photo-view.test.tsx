import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { Image, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import GalleryView from '../app/components/GalleryView';
import { APP_DIRECTORY } from '../app/constants';
import { usePhotoView } from '../app/utils/encryptedPhotoView';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///synthetic/',
  readDirectoryAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: {
    prepareEncryptedPhotoView: jest.fn(),
    releaseEncryptedPhotoView: jest.fn(),
    initializeNewVault: jest.fn(),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
  View: 'View',
  Text: 'Text',
  Image: 'Image',
  StyleSheet: { create: (x: any) => x },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  TouchableOpacity: 'TouchableOpacity',
  FlatList: ({ data, renderItem }: any) =>
    jest
      .requireActual('react')
      .createElement(
        'View',
        null,
        ...data.map((item: any, index: number) =>
          jest
            .requireActual('react')
            .createElement('View', { key: index }, renderItem({ item, index }))
        )
      ),
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

const readDir = jest.mocked(FileSystem.readDirectoryAsync);
const del = jest.mocked(FileSystem.deleteAsync);
const prepare = jest.mocked(PhotoVault.prepareEncryptedPhotoView);
const release = jest.mocked(PhotoVault.releaseEncryptedPhotoView);
const share = jest.mocked(Sharing.shareAsync);
const available = jest.mocked(Sharing.isAvailableAsync);
const legacy = `${APP_DIRECTORY.SECRET_CAMERA}/legacy.jpg`;
const encrypted = `${APP_DIRECTORY.SECRET_CAMERA}/secret.scv`;
const viewUri = 'file:///cache/prepared-view.jpg';
let shareState: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  shareState = jest.fn();
  readDir.mockResolvedValue(['legacy.jpg', 'secret.scv']);
  prepare.mockResolvedValue(viewUri);
  release.mockResolvedValue(undefined);
  available.mockResolvedValue(true);
  share.mockResolvedValue(undefined);
  del.mockResolvedValue(undefined);
});
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const mountGallery = async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <GalleryView onClose={jest.fn()} onShareState={shareState} />
    );
  });
  await settle();
  return renderer;
};
const unmount = (r: TestRenderer.ReactTestRenderer) => act(() => r.unmount());

test('mixed gallery renders prepared encrypted tile and legacy URI, without exposing ciphertext', async () => {
  const r = await mountGallery();
  expect(r.root.findAllByType(Image).map((x) => x.props.source.uri)).toEqual([
    viewUri,
    legacy,
  ]);
  expect(
    r.root.findAllByType(Image).some((x) => x.props.source.uri === encrypted)
  ).toBe(false);
  const matches = r.root
    .findAllByType(TouchableOpacity)
    .filter(
      (x) =>
        x.findAllByType(Image).length === 1 &&
        x.findAllByType(Image)[0].props.source.uri === viewUri
    );
  expect(matches).toHaveLength(1);
  expect(matches[0].props.onPress).toBeTruthy();
  unmount(r);
});

test('legacy full image sharing uses original URI and options', async () => {
  const r = await mountGallery();
  const tile = r.root
    .findAllByType(TouchableOpacity)
    .find((x) =>
      x.findAllByType(Image).some((i) => i.props.source.uri === legacy)
    )!;
  await act(async () => tile.props.onPress());
  const button = r.root
    .findAllByType(TouchableOpacity)
    .find((x) => x.props.accessibilityLabel === 'Share image')!;
  await act(async () => {
    await button.props.onPress();
  });
  expect(share).toHaveBeenCalledWith(legacy, {
    dialogTitle: 'Share Image',
    mimeType: 'image/jpeg',
    UTI: 'public.jpeg',
  });
  expect(shareState.mock.calls).toEqual([[true], [false]]);
  unmount(r);
});

test('selected encrypted photo deletion targets source file, not prepared cache view', async () => {
  const r = await mountGallery();
  const tile = r.root
    .findAllByType(TouchableOpacity)
    .find((x) =>
      x.findAllByType(Image).some((i) => i.props.source.uri === viewUri)
    )!;
  await act(async () => tile.props.onPress());
  await settle();
  const buttons = r.root.findAllByType(TouchableOpacity);
  // Order in ImageView: previous, next, share, delete, close.
  expect(buttons).toHaveLength(5);
  await act(async () => buttons[3].props.onPress());
  expect(del).toHaveBeenCalledWith(encrypted);
  expect(del).not.toHaveBeenCalledWith(viewUri);
  unmount(r);
});

test('late preparation after unmount releases its prepared URI once', async () => {
  let resolve!: (uri: string) => void;
  prepare.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const r = await mountGallery();
  unmount(r);
  await act(async () => {
    resolve(viewUri);
    await Promise.resolve();
  });
  expect(release).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledWith(viewUri);
});

test('source switch never renders prior view or error for new source; releases prior preparation', async () => {
  const first = `${APP_DIRECTORY.SECRET_CAMERA}/first.scv`,
    second = `${APP_DIRECTORY.SECRET_CAMERA}/second.scv`;
  let resolveSecond!: (uri: string) => void;
  prepare.mockImplementation((name) =>
    name === 'first.scv'
      ? Promise.resolve('file:///cache/first.jpg')
      : new Promise((r) => {
          resolveSecond = r;
        })
  );
  const renders: Array<{
    source: string;
    view: string | null;
    error: boolean;
  }> = [];
  function Probe({ source }: { source: string }) {
    const result = usePhotoView(source);
    renders.push({ source, view: result.view, error: result.error });
    return result.view ? (
      <Image source={{ uri: result.view }} />
    ) : (
      <Text>{result.error ? 'unavailable' : 'pending'}</Text>
    );
  }
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<Probe source={first} />);
  });
  await settle();
  expect(r.root.findByType(Image).props.source.uri).toBe(
    'file:///cache/first.jpg'
  );
  // A previous source's failure must not leak into the next source's first render.
  await act(async () => {
    r.update(<Probe source={second} />);
  });
  const secondRenders = renders.filter((x) => x.source === second);
  expect(secondRenders.length).toBeGreaterThan(0);
  expect(
    secondRenders.every(
      (x) => x.view !== 'file:///cache/first.jpg' && x.error === false
    )
  ).toBe(true);
  expect(
    r.root
      .findAllByType(Image)
      .some((x) => x.props.source.uri === 'file:///cache/first.jpg')
  ).toBe(false);
  await act(async () => {
    resolveSecond('file:///cache/second.jpg');
    await Promise.resolve();
  });
  expect(r.root.findByType(Image).props.source.uri).toBe(
    'file:///cache/second.jpg'
  );
  expect(release).toHaveBeenCalledWith('file:///cache/first.jpg');
  unmount(r);
});

test('switching from a failed source never renders its error for the new source', async () => {
  const failed = `${APP_DIRECTORY.SECRET_CAMERA}/failed.scv`;
  const next = `${APP_DIRECTORY.SECRET_CAMERA}/next.scv`;
  prepare.mockImplementation((name) =>
    name === 'failed.scv'
      ? Promise.reject(new Error('synthetic unavailable'))
      : new Promise(() => {})
  );
  const renders: { source: string; error: boolean; view: string | null }[] = [];
  function Probe({ source }: { source: string }) {
    const result = usePhotoView(source);
    renders.push({ source, error: result.error, view: result.view });
    return null;
  }
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<Probe source={failed} />);
  });
  await settle();
  expect(renders.some((x) => x.source === failed && x.error)).toBe(true);
  await act(async () => {
    r.update(<Probe source={next} />);
  });
  const nextRenders = renders.filter((x) => x.source === next);
  expect(nextRenders.length).toBeGreaterThan(0);
  expect(nextRenders.every((x) => !x.error && x.view === null)).toBe(true);
  unmount(r);
});

test('corrupt encrypted selection shows unavailable state without creating a vault key', async () => {
  prepare.mockRejectedValue(new Error('synthetic corrupt fixture'));
  const r = await mountGallery();
  const encryptedTile = r.root
    .findAllByType(TouchableOpacity)
    .find(
      (x) => x.props.style?.padding === 2 && x.findAllByType(Image).length === 0
    )!;
  expect(encryptedTile).toBeTruthy();
  await act(async () => encryptedTile.props.onPress());
  await settle();
  expect(
    r.root
      .findAllByType(Text)
      .map((t) => t.props.children)
      .join(' ')
  ).toMatch(/Photo unavailable/);
  expect(
    r.root
      .findAllByType(Text)
      .map((t) => t.props.children)
      .join(' ')
  ).not.toMatch(/secret\.scv|synthetic corrupt/i);
  expect(prepare).toHaveBeenCalledWith('secret.scv');
  expect(PhotoVault.initializeNewVault).not.toHaveBeenCalled();
  unmount(r);
});
