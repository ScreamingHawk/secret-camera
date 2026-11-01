import * as FileSystem from 'expo-file-system';
import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { APP_DIRECTORY } from '../constants';
import {
  finishPhotoOperation,
  runPhotoOperation,
  setPhotoOperationProgress,
} from './photoOperation';

export async function convertGallery(
  mode: 'encrypt' | 'decrypt'
): Promise<string> {
  return runPhotoOperation(async () => {
    const files = await FileSystem.readDirectoryAsync(
      APP_DIRECTORY.SECRET_CAMERA
    );
    if (mode === 'encrypt') {
      const result = await PhotoVault.migrateLegacyGalleryPhotos();
      const message = result.failed
        ? `Encrypted ${result.migrated}; ${result.remaining} plaintext photos remain. Failed originals are retained; retry is safe.`
        : result.migrated
          ? `Encrypted ${result.migrated} photos.`
          : 'No plaintext photos to encrypt.';
      finishPhotoOperation(message);
      return message;
    }

    const encrypted = files.filter((name) =>
      name.toLowerCase().endsWith('.scv')
    );
    if (!encrypted.length) {
      const message = 'No encrypted photos to decrypt.';
      finishPhotoOperation(message);
      return message;
    }
    let converted = 0;
    const failures: string[] = [];
    for (let index = 0; index < encrypted.length; index += 1) {
      const filename = encrypted[index];
      setPhotoOperationProgress(
        `Decrypting ${index + 1} of ${encrypted.length}…`
      );
      try {
        await PhotoVault.decryptGalleryPhoto(filename);
        converted += 1;
      } catch {
        failures.push(filename);
      }
    }
    const message = failures.length
      ? `Decrypted ${converted}; ${failures.length} failed and remain encrypted. Originals were retained; retry is safe.`
      : `Decrypted ${converted} photos to unencrypted app-private files.`;
    finishPhotoOperation(message);
    return message;
  });
}
