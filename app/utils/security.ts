import * as FileSystem from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { APP_DIRECTORY } from '../constants';

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

export async function savePhoto(
  sourceUri: string,
  _filename?: string
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
  let info;
  try {
    info = await FileSystem.getInfoAsync(captureDir);
  } catch (error) {
    throw new PhotoSaveError('SAVE_CACHE_LOOKUP_FAILED', error);
  }
  if (!info.exists)
    try {
      await FileSystem.makeDirectoryAsync(captureDir, { intermediates: true });
    } catch (error) {
      throw new PhotoSaveError('SAVE_DIRECTORY_FAILED', error);
    }
  const source = `${captureDir}capture-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  try {
    await FileSystem.copyAsync({ from: sourceUri, to: source });
  } catch (error) {
    throw new PhotoSaveError('SAVE_COPY_FAILED', error);
  }
  let result: { filename: string; sourceRemoved: boolean };
  try {
    result = await PhotoVault.encryptCapturedPhoto(
      source.replace('file://', '')
    );
  } catch (error) {
    try {
      await FileSystem.deleteAsync(source, { idempotent: true });
    } catch {
      /* preserve encryption failure */
    }
    throw new PhotoSaveError('SAVE_ENCRYPTION_FAILED', error);
  }
  let originalRemoved = false;
  try {
    await FileSystem.deleteAsync(sourceUri, { idempotent: true });
    originalRemoved = true;
  } catch {
    // Encryption is committed; retain the source and report cleanup separately.
  }
  return {
    uri: `${APP_DIRECTORY.SECRET_CAMERA}/${result.filename}`,
    sourceRemoved: result.sourceRemoved && originalRemoved,
  };
}

export async function getPhotoUri(uri: string): Promise<string> {
  return uri;
}
