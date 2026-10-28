import React from 'react';
import { AppState, Button, Text, TouchableOpacity } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import Index from '../app/index';
import { authenticateUser } from '../app/utils/security';

jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
jest.mock('../app/utils/security', () => ({ authenticateUser: jest.fn() }));
jest.mock('../app/components/CameraView', () => () => null);
jest.mock('../app/components/GalleryView', () => {
  const React = require('react');
  const { Text, TouchableOpacity } = require('react-native');
  return function GalleryMock({
    onShareState,
  }: {
    onShareState: (active: boolean) => void;
  }) {
    React.useEffect(() => {
      mockGalleryMounts++;
      return () => {
        mockGalleryUnmounts++;
      };
    }, []);
    return (
      <TouchableOpacity
        onPress={() => {
          galleryShare = onShareState;
          onShareState(true);
        }}
      >
        <Text>View Gallery</Text>
      </TouchableOpacity>
    );
  };
});
jest.mock('../app/components/AboutView', () => () => null);

const auth = jest.mocked(authenticateUser);
let changeState: (state: string) => void;
let mockGalleryMounts = 0;
let mockGalleryUnmounts = 0;
let galleryShare: (active: boolean) => void = () => {};

beforeEach(() => {
  auth.mockReset();
  changeState = () => {};
  mockGalleryMounts = 0;
  mockGalleryUnmounts = 0;
  galleryShare = () => {};
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

test('relocks on background and requires successful authentication on resume', async () => {
  let finish: (value: boolean) => void;
  auth.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Index />);
  });
  await act(async () => {
    finish!(true);
  });
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(false);
  await act(async () => {
    changeState('background');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
  });
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(true);
  await act(async () => {
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
    changeState('active');
  });
  expect(auth).toHaveBeenCalledTimes(2);
  await act(async () => {
    finish!(false);
  });
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(true);
});

test('biometric prompt lifecycle does not create a second prompt', async () => {
  let finish: (value: boolean) => void;
  auth.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => {
    TestRenderer.create(<Index />);
  });
  await act(async () => {
    changeState('inactive');
    changeState('active');
  });
  expect(auth).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish!(true);
  });
  expect(auth).toHaveBeenCalledTimes(1);
});

test('deferred share keeps gallery mounted under cover and authenticates once on return', async () => {
  const finishes: Array<(value: boolean) => void> = [];
  auth.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      })
  );
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Index />);
  });
  await act(async () => {
    finishes[0](true);
  });
  const galleryButton = renderer!.root
    .findAllByType(TouchableOpacity)
    .find((node) =>
      node
        .findAllByType(Text)
        .some((text) => text.props.children === 'View Gallery')
    )!;
  await act(async () => {
    galleryButton.props.onPress();
  });
  await act(async () => {
    renderer!.root
      .findAllByType(TouchableOpacity)
      .find((node) => node.props.onPress)
      ?.props.onPress();
  });
  expect(mockGalleryMounts).toBe(1);
  await act(async () => {
    galleryShare(true);
  });
  await act(async () => {
    changeState('background');
    changeState('active');
  });
  expect(mockGalleryMounts).toBe(1);
  expect(mockGalleryUnmounts).toBe(0);
  expect(
    renderer!.root.findByProps({ children: 'Private content hidden' })
  ).toBeTruthy();
  expect(auth).toHaveBeenCalledTimes(1);
  await act(async () => {
    galleryShare(false);
  });
  expect(auth).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishes[1](false);
  });
  expect(renderer!.root.findByProps({ children: 'Authenticate' })).toBeTruthy();
  await act(async () => {
    renderer!.root
      .findAllByType(Button)
      .find((button) => button.props.title === 'Authenticate')!
      .props.onPress();
    finishes[2](true);
  });
  // Once the share promise has settled, locking may unmount the private view.
  // Successful reauthentication restores it; only an in-flight share must retain its owner.
  expect(mockGalleryMounts).toBe(2);
  expect(mockGalleryUnmounts).toBe(1);
});

test('stale authentication is discarded and exactly one fresh prompt follows resume', async () => {
  const finishes: Array<(value: boolean) => void> = [];
  auth.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      })
  );
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Index />);
  });
  await act(async () => {
    changeState('background');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'background',
    });
    changeState('active');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
  });
  await act(async () => {
    finishes[0](true);
  });
  expect(auth).toHaveBeenCalledTimes(2);
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(true);
  await act(async () => {
    finishes[1](false);
  });
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(true);
});

test('rejected authentication remains locked and can be retried explicitly', async () => {
  auth
    .mockRejectedValueOnce(new Error('biometric unavailable'))
    .mockResolvedValueOnce(true);
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<Index />);
  });
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(true);
  await act(async () => {
    renderer!.root
      .findAllByType(Button)
      .find((button) => button.props.title === 'Authenticate')!
      .props.onPress();
  });
  expect(
    renderer!.root
      .findAllByType(Button)
      .some((button) => button.props.title === 'Authenticate')
  ).toBe(false);
});
