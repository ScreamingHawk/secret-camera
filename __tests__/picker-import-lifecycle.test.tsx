import React from 'react';
import { AppState, Platform, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import Index from '../app/index';
import { authenticateUser } from '../app/utils/security';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

let mockPickerResult: any;
let mockPreference = true;
let mockPending: Array<{ id: string; uri: string; mimeType: string }> = [];
let mockGalleryProps: any;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => mockPickerResult),
}));
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///synthetic/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  readAsStringAsync: jest.fn(async () =>
    JSON.stringify({ encryptAutomatically: mockPreference })
  ),
}));
jest.mock('../app/utils/security', () => ({
  authenticateUser: jest.fn(async () => true),
}));
jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    listPendingImageShares: jest.fn(async () => mockPending),
    consumePendingImageShareFailure: jest.fn(async () => false),
    consumePendingImageShare: jest.fn(
      async (id: string) => mockPending.find((item) => item.id === id) ?? null
    ),
    stagePickedImage: jest.fn(async (uri: string) => {
      if (uri.includes('reject')) throw new Error('synthetic rejected item');
      mockPending.push({
        id: `id-${uri}`,
        uri: 'file:///private/pending.jpg',
        mimeType: 'image/jpeg',
      });
    }),
    importPendingImageShare: jest.fn(
      async (id: string, encrypted: boolean) => ({
        filename: `photo-share-${id}.${encrypted ? 'scv' : 'jpg'}`,
      })
    ),
    acknowledgePendingImageShare: jest.fn(async (id: string) => {
      mockPending = mockPending.filter((item) => item.id !== id);
    }),
    deleteGalleryPhoto: jest.fn(),
  },
}));
jest.mock('../app/components/CameraView', () => () => null);
jest.mock('../app/components/SettingsView', () => () => null);
jest.mock('../app/components/AboutView', () => () => null);
jest.mock('../app/components/GalleryView', () => (props: any) => {
  mockGalleryProps = props;
  return require('react').createElement(
    require('react-native').Text,
    null,
    props.importNotice
  );
});

const vault = jest.mocked(PhotoVault);
const picker = jest.requireMock('expo-image-picker')
  .launchImageLibraryAsync as jest.Mock;
let changeState: (state: string) => void = () => {};

beforeEach(() => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    value: 'android',
  });
  jest.clearAllMocks();
  mockPickerResult = {
    canceled: false,
    assets: [{ uri: 'file:///synthetic/selected.jpeg' }],
  };
  mockPreference = true;
  mockPending = [];
  mockGalleryProps = undefined;
  changeState = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    listener: (state: string) => void
  ) => {
    changeState = listener;
    return { remove: jest.fn() };
  }) as never);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
});
afterEach(() => jest.restoreAllMocks());

async function selectAndWait() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Index />);
  });
  const importButton = () =>
    renderer.root
      .findAllByType(TouchableOpacity)
      .find((node) =>
        node
          .findAllByType(Text)
          .some((text) => text.props.children === 'Import JPEG Photos')
      )!;
  await act(async () => {
    importButton().props.onPress();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer;
}

test.each([true, false])(
  'selection stages then reaches canonical import with current preference=%s',
  async (enabled) => {
    mockPreference = enabled;
    await selectAndWait();
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true, quality: 1 })
    );
    expect(vault.stagePickedImage).toHaveBeenCalledWith(
      'file:///synthetic/selected.jpeg'
    );
    expect(vault.importPendingImageShare).toHaveBeenCalledWith(
      expect.any(String),
      enabled
    );
    expect(vault.acknowledgePendingImageShare).toHaveBeenCalledTimes(1);
  }
);

test('picker cancellation stages and imports nothing', async () => {
  mockPickerResult = { canceled: true, assets: null };
  await selectAndWait();
  expect(vault.stagePickedImage).not.toHaveBeenCalled();
  expect(vault.importPendingImageShare).not.toHaveBeenCalled();
});

test('partial staging failure retains and imports successful selection with current setting', async () => {
  mockPreference = true;
  mockPickerResult = {
    canceled: false,
    assets: [
      { uri: 'file:///reject.jpeg' },
      { uri: 'file:///synthetic/good.jpeg' },
    ],
  };
  await selectAndWait();
  expect(vault.stagePickedImage).toHaveBeenCalledTimes(2);
  expect(vault.importPendingImageShare).toHaveBeenCalledTimes(1);
  expect(vault.importPendingImageShare).toHaveBeenCalledWith(
    expect.any(String),
    true
  );
  expect(mockGalleryProps.importNotice).toContain('1 staged; 1 failed');
  expect(mockGalleryProps.importNotice).toContain(
    'Original photos remain unchanged'
  );
});

test.each([true, false])(
  'background return gates import on fresh setting/authentication (auth completes first=%s)',
  async (authFirst) => {
    let completeAuth!: (success: boolean) => void;
    let completePicker!: (result: any) => void;
    picker.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completePicker = resolve;
        })
    );
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<Index />);
    });
    const importButton = renderer.root
      .findAllByType(TouchableOpacity)
      .find((node) =>
        node
          .findAllByType(Text)
          .some((text) => text.props.children === 'Import JPEG Photos')
      )!;
    await act(async () => {
      importButton.props.onPress();
      await Promise.resolve();
    });
    expect(vault.stagePickedImage).not.toHaveBeenCalled();
    jest.mocked(authenticateUser).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeAuth = resolve;
        })
    );
    mockPreference = false;
    await act(async () => {
      changeState('background');
      changeState('active');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (authFirst) {
      await act(async () => {
        completeAuth(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(vault.importPendingImageShare).not.toHaveBeenCalled();
    }
    await act(async () => {
      completePicker({
        canceled: false,
        assets: [{ uri: 'file:///synthetic/selected.jpeg' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(vault.stagePickedImage).toHaveBeenCalled();
    if (!authFirst) {
      expect(vault.importPendingImageShare).not.toHaveBeenCalled();
      await act(async () => {
        completeAuth(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(vault.importPendingImageShare).toHaveBeenCalledWith(
      expect.any(String),
      false
    );
  }
);
