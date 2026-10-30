import * as Sharing from 'expo-sharing';
import React from 'react';
import { AppState, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import ImageView from '../app/components/ImageView';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}));
jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: {
    prepareEncryptedPhotoShare: jest.fn(),
    abandonOwnedShare: jest.fn(),
    beginEncryptedPhotoShare: jest.fn(),
    finishEncryptedPhotoShare: jest.fn(),
  },
}));
jest.mock('../app/utils/encryptedPhotoView', () => ({
  usePhotoView: () => ({
    view: 'file:///private/view-cache.jpg',
    error: false,
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  View: 'View',
  Text: 'Text',
  Image: 'Image',
  StyleSheet: { create: (x: any) => x },
  Dimensions: { get: () => ({ width: 400, height: 800 }) },
  TouchableOpacity: 'TouchableOpacity',
}));

const prepare = jest.mocked(PhotoVault.prepareEncryptedPhotoShare);
const abandon = jest.mocked(PhotoVault.abandonOwnedShare);
const begin = jest.mocked(PhotoVault.beginEncryptedPhotoShare);
const finish = jest.mocked(PhotoVault.finishEncryptedPhotoShare);
const available = jest.mocked(Sharing.isAvailableAsync);
const share = jest.mocked(Sharing.shareAsync);
const source = 'file:///private/gallery/secret.scv';
const exportUri = 'file:///private/photo-vault-shares/export.jpg';
const options = {
  dialogTitle: 'Share Image',
  mimeType: 'image/jpeg',
  UTI: 'public.jpeg',
};
let state: jest.Mock;
let renderer: TestRenderer.ReactTestRenderer;
async function mount(uri = source) {
  await act(async () => {
    renderer = TestRenderer.create(
      <ImageView uri={uri} onClose={jest.fn()} onShareState={state} />
    );
  });
  return renderer;
}
function shareButton(r: TestRenderer.ReactTestRenderer) {
  return r.root
    .findAllByType(TouchableOpacity)
    .find((x) => x.props.accessibilityLabel === 'Share image')!;
}
async function press(r = renderer) {
  await act(async () => {
    await shareButton(r).props.onPress();
  });
}
const tick = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
beforeEach(() => {
  jest.clearAllMocks();
  (AppState as any).currentState = 'active';
  state = jest.fn();
  prepare.mockResolvedValue(exportUri);
  abandon.mockResolvedValue(undefined);
  begin.mockResolvedValue(undefined);
  finish.mockResolvedValue(undefined);
  available.mockResolvedValue(true);
  share.mockResolvedValue(undefined);
});
afterEach(() => {
  if (renderer) {
    act(() => renderer.unmount());
    renderer = undefined as any;
  }
});

test('encrypted selection hands a distinct JPEG export to native sharing, never the view cache or ciphertext', async () => {
  const r = await mount();
  await press(r);
  expect(prepare).toHaveBeenCalledWith('secret.scv');
  expect(begin).toHaveBeenCalledWith(exportUri);
  expect(share).toHaveBeenCalledWith(exportUri, options);
  expect(share).not.toHaveBeenCalledWith(source, expect.anything());
  expect(share).not.toHaveBeenCalledWith(
    'file:///private/view-cache.jpg',
    expect.anything()
  );
  expect(state.mock.calls).toEqual([[true], [false]]);
  expect(finish).toHaveBeenCalledWith(exportUri);
  expect(abandon).not.toHaveBeenCalled();
});
test('legacy image sharing keeps original URI and never prepares encrypted export', async () => {
  const legacy = 'file:///private/gallery/legacy.jpg';
  const r = await mount(legacy);
  await press(r);
  expect(share).toHaveBeenCalledWith(legacy, options);
  expect(prepare).not.toHaveBeenCalled();
  expect(begin).not.toHaveBeenCalled();
  expect(finish).not.toHaveBeenCalled();
});
test('rapid repeated presses while preparation is pending start only one flow', async () => {
  let resolve!: (uri: string) => void;
  prepare.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  const r = await mount();
  await act(async () => {
    const cb = shareButton(r).props.onPress;
    void cb();
    void cb();
  });
  expect(prepare).toHaveBeenCalledTimes(1);
  resolve(exportUri);
  await tick();
  expect(share).toHaveBeenCalledTimes(1);
  expect(begin).toHaveBeenCalledTimes(1);
});
test.each(['unmount', 'background'] as const)(
  'late export after %s is abandoned without showing native sheet',
  async (mode) => {
    let resolve!: (uri: string) => void;
    prepare.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const r = await mount();
    await act(async () => {
      void shareButton(r).props.onPress();
    });
    if (mode === 'unmount') act(() => r.unmount());
    else (AppState as any).currentState = 'background';
    await act(async () => {
      resolve(exportUri);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(share).not.toHaveBeenCalled();
    expect(abandon).toHaveBeenCalledWith(exportUri);
    expect(begin).not.toHaveBeenCalled();
  }
);
test.each(['unmount', 'background'] as const)(
  'lifecycle change while begin is pending prevents handoff and abandons export (%s)',
  async (mode) => {
    let resolve!: () => void;
    begin.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      })
    );
    const r = await mount();
    await act(async () => {
      void shareButton(r).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    if (mode === 'unmount') act(() => r.unmount());
    else (AppState as any).currentState = 'background';
    await act(async () => {
      resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(share).not.toHaveBeenCalled();
    expect(abandon).toHaveBeenCalledWith(exportUri);
  }
);
test('pending native share keeps state active through unmount and finishes handed export on settlement', async () => {
  let resolve!: () => void;
  share.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    })
  );
  const r = await mount();
  await act(async () => {
    void shareButton(r).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(state.mock.calls).toEqual([[true]]);
  act(() => r.unmount());
  await act(async () => {
    resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(finish).toHaveBeenCalledWith(exportUri);
  expect(abandon).not.toHaveBeenCalled();
  expect(state.mock.calls).toEqual([[true], [false]]);
});
test('unavailable sharing and export preparation failure do not expose details or open a sheet', async () => {
  available.mockResolvedValueOnce(false);
  const r = await mount();
  await press(r);
  expect(share).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(state.mock.calls).toEqual([[true], [false]]);
  prepare.mockRejectedValueOnce(new Error('private key/path detail'));
  await press(r);
  expect(share).not.toHaveBeenCalled();
  expect(state.mock.calls.slice(-2)).toEqual([[true], [false]]);
  // Error details are intentionally not surfaced; the component catches and logs generically.
});
