import * as FileSystem from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { APP_DIRECTORY } from '../constants';

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
    throw new Error('Invalid camera capture');
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) throw new Error('Private capture cache unavailable');
  const captureDir = `${cacheDir}.secret-camera/`;
  const info = await FileSystem.getInfoAsync(captureDir);
  if (!info.exists)
    await FileSystem.makeDirectoryAsync(captureDir, { intermediates: true });
  const source = `${captureDir}capture-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: sourceUri, to: source });
  let result: { filename: string; sourceRemoved: boolean };
  try {
    result = await PhotoVault.encryptCapturedPhoto(
      source.replace('file://', '')
    );
  } catch (error) {
    await FileSystem.deleteAsync(source, { idempotent: true });
    throw error;
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
