import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import CameraView from '../app/components/CameraView';
import { savePhoto } from '../app/utils/security';
import PhotoVault from '../modules/photo-vault/src/PhotoVault';

const mockCameraTakePicture = jest.fn();
jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    CameraView: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        takePictureAsync: mockCameraTakePicture,
      }));
      return React.createElement('CameraMock', props, props.children);
    }),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../modules/photo-vault/src/PhotoVault', () => ({
  __esModule: true,
  default: { prepareCaptureVault: jest.fn() },
}));
jest.mock('../app/utils/security', () => ({ savePhoto: jest.fn() }));

const prepare = jest.mocked(PhotoVault.prepareCaptureVault);
const save = jest.mocked(savePhoto);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const camera = () => TestRenderer.create(<CameraView onClose={jest.fn()} />);
const buttons = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(TouchableOpacity);
const text = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);
const cameraNode = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findByType('CameraMock' as any);
const displayCode: Record<string, string> = {
  VAULT_PREPARATION_PENDING: 'V1_WAIT',
  VAULT_PREPARATION_FAILED: 'V2_VAULT',
  CAMERA_CAPTURE_FAILED_NOT_READY: 'C3_CAMERA',
  CAMERA_CAPTURE_FAILED_READY: 'C2_READY',
  CAMERA_CAPTURE_EMPTY: 'C1_EMPTY',
  SAVE_FAILED: 'S0_SAVE',
  SAVE_URI_INVALID: 'S1_URI',
  SAVE_CACHE_UNAVAILABLE: 'S2_CACHE',
  SAVE_CACHE_LOOKUP_FAILED: 'S3_LOOKUP',
  SAVE_DIRECTORY_FAILED: 'S4_DIR',
  SAVE_COPY_FAILED: 'S5_COPY',
  SAVE_ENCRYPTION_FAILED: 'S6_ENCRYPT',
};
const errorText = (code: string) =>
  `Photo could not be saved\n${displayCode[code]}`;
const tap = async (button: TestRenderer.ReactTestInstance) => {
  await act(async () => {
    button.props.onPress();
  });
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  prepare.mockResolvedValue(undefined);
  mockCameraTakePicture.mockResolvedValue({ uri: 'file:///camera/shot.jpg' });
  save.mockResolvedValue({
    uri: 'file:///gallery/photo.scv',
    sourceRemoved: true,
  });
});

test('switches camera facing from back to front and back', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  expect(cameraNode(tree).props.facing).toBe('back');
  await tap(buttons(tree)[0]);
  expect(cameraNode(tree).props.facing).toBe('front');
  await tap(buttons(tree)[0]);
  expect(cameraNode(tree).props.facing).toBe('back');
  tree.unmount();
});

test('distinguishes pending vault preparation from failure and preserves failure on another press', async () => {
  const gate = deferred<void>();
  prepare.mockReturnValue(gate.promise);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  await tap(buttons(tree)[1]);
  expect(mockCameraTakePicture).not.toHaveBeenCalled();
  expect(text(tree)).toEqual([errorText('VAULT_PREPARATION_PENDING')]);
  await act(async () => {
    gate.resolve();
    await gate.promise;
  });
  await tap(buttons(tree)[1]);
  expect(mockCameraTakePicture).toHaveBeenCalledTimes(1);
  expect(text(tree)).toEqual([]);
  tree.unmount();

  prepare.mockRejectedValueOnce(
    new Error('file:///private/secret native detail')
  );
  await act(async () => {
    tree = camera();
  });
  await flush();
  expect(text(tree)).toEqual([errorText('VAULT_PREPARATION_FAILED')]);
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('VAULT_PREPARATION_FAILED')]);
  expect(text(tree).join(' ')).not.toContain('file:///private/');
  tree.unmount();
});

test('single-flights repeated presses while capture and save are pending', async () => {
  const capture = deferred<{ uri: string }>();
  const saved = deferred<{ uri: string; sourceRemoved: boolean }>();
  mockCameraTakePicture.mockReturnValue(capture.promise);
  save.mockReturnValue(saved.promise);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  await flush();
  const button = buttons(tree)[1];
  await act(async () => {
    button.props.onPress();
    button.props.onPress();
  });
  expect(mockCameraTakePicture).toHaveBeenCalledTimes(1);
  await act(async () => {
    capture.resolve({ uri: 'file:///camera/shot.jpg' });
    await capture.promise;
  });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => {
    button.props.onPress();
    button.props.onPress();
  });
  expect(mockCameraTakePicture).toHaveBeenCalledTimes(1);
  await act(async () => {
    saved.resolve({ uri: 'file:///gallery/photo.scv', sourceRemoved: true });
    await saved.promise;
  });
  tree.unmount();
});

test('finishes save ownership after unmount without stale UI updates', async () => {
  const saved = deferred<{ uri: string; sourceRemoved: boolean }>();
  save.mockReturnValue(saved.promise);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  await flush();
  await act(async () => {
    buttons(tree)[1].props.onPress();
    await Promise.resolve();
  });
  expect(save).toHaveBeenCalledWith('file:///camera/shot.jpg');
  tree.unmount();
  await act(async () => {
    saved.resolve({ uri: 'file:///gallery/photo.scv', sourceRemoved: true });
    await saved.promise;
  });
  expect(save).toHaveBeenCalledTimes(1);
});

test('reports capture/save failures and retries; committed cleanup warning is not a save failure', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  await flush();
  mockCameraTakePicture.mockRejectedValueOnce(
    new Error('file:///private/camera detail')
  );
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('CAMERA_CAPTURE_FAILED_NOT_READY')]);
  save.mockRejectedValueOnce(new Error('file:///private/save detail'));
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('SAVE_FAILED')]);
  await tap(buttons(tree)[1]);
  expect(save).toHaveBeenCalledTimes(2);
  expect(text(tree)).toEqual([]);
  save.mockResolvedValueOnce({
    uri: 'file:///gallery/committed.scv',
    sourceRemoved: false,
  });
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual(['Photo saved, but cleanup was incomplete']);
  tree.unmount();
});

test('observes camera readiness in the failure code and resets it on facing changes without gating capture', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  expect(text(tree)).toEqual([]);
  await act(async () => {
    cameraNode(tree).props.onCameraReady();
  });
  expect(text(tree)).toEqual([]);
  mockCameraTakePicture.mockRejectedValueOnce(
    new Error('private camera detail')
  );
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('CAMERA_CAPTURE_FAILED_READY')]);
  await tap(buttons(tree)[0]);
  mockCameraTakePicture.mockRejectedValueOnce(
    new Error('private camera detail')
  );
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('CAMERA_CAPTURE_FAILED_NOT_READY')]);
  expect(mockCameraTakePicture).toHaveBeenCalledTimes(2);
  tree.unmount();
});

test('reports an empty camera result without invoking save', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  mockCameraTakePicture.mockResolvedValueOnce(undefined);
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('CAMERA_CAPTURE_EMPTY')]);
  expect(save).not.toHaveBeenCalled();
  tree.unmount();
});

test.each([
  'SAVE_URI_INVALID',
  'SAVE_CACHE_UNAVAILABLE',
  'SAVE_CACHE_LOOKUP_FAILED',
  'SAVE_DIRECTORY_FAILED',
  'SAVE_COPY_FAILED',
  'SAVE_ENCRYPTION_FAILED',
])('renders only the whitelisted save-stage code %s', async (stage) => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  save.mockRejectedValueOnce(
    Object.assign(new Error('file:///private/secret.jpg'), { stage })
  );
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText(stage)]);
  expect(text(tree).join(' ')).not.toContain('file:///private/');
  tree.unmount();
});

test('bounds the diagnostic label and puts a short code on its own line', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  save.mockRejectedValueOnce({ stage: 'SAVE_ENCRYPTION_FAILED' });
  await tap(buttons(tree)[1]);
  const label = tree.root.findByType(Text);
  expect(label.props.children).toBe('Photo could not be saved\nS6_ENCRYPT');
  expect(StyleSheet.flatten(label.props.style)).toMatchObject({
    left: 0,
    right: 0,
    textAlign: 'center',
  });
  for (const code of Object.values(displayCode))
    expect(code.length).toBeLessThanOrEqual(10);
  tree.unmount();
});

test('never renders an arbitrary error stage or message', async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = camera();
  });
  save.mockRejectedValueOnce({
    stage: 'file:///private/secret.jpg',
    message: 'PRIVATE_IMAGE_SENTINEL',
  });
  await tap(buttons(tree)[1]);
  expect(text(tree)).toEqual([errorText('SAVE_FAILED')]);
  tree.unmount();
});
