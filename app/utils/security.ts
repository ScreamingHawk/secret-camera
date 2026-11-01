import * as FileSystem from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { APP_DIRECTORY } from '../constants';
import { runPhotoOperation } from './photoOperation';

export type PhotoSaveStage =
  | 'SAVE_URI_INVALID'
  | 'SAVE_CACHE_UNAVAILABLE'
  | 'SAVE_CACHE_LOOKUP_FAILED'
  | 'SAVE_DIRECTORY_FAILED'
  | 'SAVE_COPY_FAILED'
  | 'SAVE_ENCRYPTION_FAILED';
export class PhotoSaveError extends Error {
  constructor(
    readonly stage: PhotoSaveStage,
    original: unknown
  ) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'PhotoSaveError';
  }
}

export async function authenticateUser(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (hasHardware && isEnrolled) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to access Secret Camera',
      fallbackLabel: 'Use PIN',
    });
    return result.success;
  }

  // Fallback to PIN/password if biometrics unavailable
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Enter PIN to access Secret Camera',
    fallbackLabel: 'Use PIN',
    disableDeviceFallback: false,
  });
  return result.success;
}

export function savePhoto(
  sourceUri: string,
  encryptAutomatically = true
): Promise<{ uri: string; sourceRemoved: boolean }> {
  return runPhotoOperation(() =>
    savePhotoOwned(sourceUri, encryptAutomatically)
  );
}

async function savePhotoOwned(
  sourceUri: string,
  encryptAutomatically: boolean
): Promise<{ uri: string; sourceRemoved: boolean }> {
  if (!sourceUri.startsWith('file://'))
    throw new PhotoSaveError(
      'SAVE_URI_INVALID',
      new Error('Invalid camera capture')
    );
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir)
    throw new PhotoSaveError(
      'SAVE_CACHE_UNAVAILABLE',
      new Error('Private capture cache unavailable')
    );
  const captureDir = `${cacheDir}.secret-camera/`;
  let cacheInfo;
  try {
    cacheInfo = await FileSystem.getInfoAsync(captureDir);
  } catch (error) {
    throw new PhotoSaveError('SAVE_CACHE_LOOKUP_FAILED', error);
  }
  if (!cacheInfo.exists) {
    try {
      await FileSystem.makeDirectoryAsync(captureDir, { intermediates: true });
    } catch (error) {
      throw new PhotoSaveError('SAVE_DIRECTORY_FAILED', error);
    }
  }
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staged = `${captureDir}capture-${nonce}.jpg`;
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: staged });
  } catch (error) {
    throw new PhotoSaveError('SAVE_COPY_FAILED', error);
  }

  if (encryptAutomatically) {
    try {
      const result = await PhotoVault.encryptCapturedPhoto(
        staged.replace('file://', '')
      );
      let originalRemoved = false;
      try {
        await FileSystem.deleteAsync(sourceUri, { idempotent: true });
        originalRemoved = true;
      } catch {
        /* Keep capture result; report incomplete cleanup. */
      }
      return {
        uri: `${APP_DIRECTORY.SECRET_CAMERA}/${result.filename}`,
        sourceRemoved: result.sourceRemoved && originalRemoved,
      };
    } catch (error) {
      // Retain the staged private copy and original on encryption failure for recovery/retry.
      throw new PhotoSaveError('SAVE_ENCRYPTION_FAILED', error);
    }
  }

  const gallery = APP_DIRECTORY.SECRET_CAMERA;
  const galleryInfo = await FileSystem.getInfoAsync(gallery).catch((error) => {
    throw new PhotoSaveError('SAVE_DIRECTORY_FAILED', error);
  });
  if (!galleryInfo.exists) {
    try {
      await FileSystem.makeDirectoryAsync(gallery, { intermediates: true });
    } catch (error) {
      throw new PhotoSaveError('SAVE_DIRECTORY_FAILED', error);
    }
  }
  const filename = `photo-${nonce}.jpg`;
  const destination = `${gallery}/${filename}`;
  let destinationCreated = false;
  try {
    const existing = await FileSystem.getInfoAsync(destination);
    if (existing.exists)
      throw new Error('Refusing to overwrite existing photo');
    destinationCreated = true;
    await FileSystem.copyAsync({ from: staged, to: destination });
    const [sourceInfo, destinationInfo] = await Promise.all([
      FileSystem.getInfoAsync(staged),
      FileSystem.getInfoAsync(destination),
    ]);
    if (
      !sourceInfo.exists ||
      !destinationInfo.exists ||
      !destinationInfo.size ||
      destinationInfo.size !== sourceInfo.size
    ) {
      throw new Error('Plaintext photo copy verification failed');
    }
  } catch (error) {
    if (destinationCreated)
      await FileSystem.deleteAsync(destination, { idempotent: true }).catch(
        () => undefined
      );
    throw new PhotoSaveError('SAVE_COPY_FAILED', error);
  }
  let sourceRemoved = false;
  try {
    await FileSystem.deleteAsync(staged, { idempotent: true });
    await FileSystem.deleteAsync(sourceUri, { idempotent: true });
    sourceRemoved = true;
  } catch {
    /* The verified gallery copy is committed; leave recoverable source files. */
  }
  return { uri: destination, sourceRemoved };
}

export async function getPhotoUri(uri: string): Promise<string> {
  return uri;
}
