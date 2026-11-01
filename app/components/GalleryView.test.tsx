import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import GalleryView from './GalleryView';

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
  default: { deleteGalleryPhoto: jest.fn() },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => ({
  BackHandler: { addEventListener: jest.fn(() => ({ remove() {} })) },
  Dimensions: { get: () => ({ width: 320 }) },
  FlatList: ({ data, renderItem, ...props }: any) =>
    jest
      .requireActual('react')
      .createElement(
        'View',
        { testID: 'gallery-list', ...props },
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

const fs = jest.requireMock('expo-file-system') as {
  readDirectoryAsync: jest.Mock;
};
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
const tiles = (tree: renderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('TouchableOpacity' as any)
    .filter((x) => x.props.style?.padding === 2);

beforeEach(() => {
  fs.readDirectoryAsync
    .mockReset()
    .mockResolvedValue(['plain.jpg', 'locked.scv']);
  jest
    .mocked(PhotoVault.deleteGalleryPhoto)
    .mockReset()
    .mockResolvedValue(undefined);
  mockImageViewSpy.mockClear();
});

test('gallery keeps mixed-format viewing and deletion while removing the legacy migration action', async () => {
  const tree = await mount();
  expect(tiles(tree)).toHaveLength(2);
  expect(
    tree.root.findAll(
      (item) => item.props.accessibilityLabel === 'Encrypt existing photos'
    )
  ).toHaveLength(0);
  await act(async () => tiles(tree)[0].props.onPress());
  expect(mockImageViewSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      uri: 'file:///synthetic/.secret-camera/locked.scv',
    })
  );
  await act(async () => {
    await (
      mockImageViewSpy.mock.calls[0][0] as { onDelete: () => Promise<void> }
    ).onDelete();
  });
  expect(PhotoVault.deleteGalleryPhoto).toHaveBeenCalledWith('locked.scv');
  await act(async () => tree.unmount());
});
