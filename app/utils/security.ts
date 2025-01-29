import * as FileSystem from 'expo-file-system';
import * as LocalAuthentication from 'expo-local-authentication';
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
  filename: string
): Promise<string> {
  const destination = `${APP_DIRECTORY.SECRET_CAMERA}/${filename}`;
  await FileSystem.copyAsync({
    from: sourceUri,
    to: destination,
  });
  return destination;
}

export async function getPhotoUri(uri: string): Promise<string> {
  return uri;
}
