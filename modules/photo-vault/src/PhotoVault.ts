import { requireNativeModule } from 'expo-modules-core';

export type PhotoVaultKeyLifecycle = {
  /** Explicitly creates the first key; rejects if the stable alias already exists. */
  initializeNewVault(): Promise<string>;
  /** Prepares a new capture vault or refuses when initialized state lost its key. */
  prepareCaptureVault(): Promise<void>;
  /** Retrieves the existing key or rejects without creating/replacing it. */
  requireExistingKey(): Promise<string>;
  /** Encrypts a file directly inside the app-private filesDir. Never overwrites. */
  encryptFile(inputPath: string, outputPath: string): Promise<void>;
  /** Encrypts trusted camera-cache input into the private encrypted gallery. */
  encryptCapturedPhoto(
    inputPath: string
  ): Promise<{ filename: string; sourceRemoved: boolean }>;
  /** Authenticates completely before publishing plaintext; never overwrites. */
  decryptFile(inputPath: string, outputPath: string): Promise<void>;
  /** Authenticates an encrypted gallery leaf and returns a private file:// image URI. */
  prepareEncryptedPhotoView(filename: string): Promise<string>;
  /** Idempotently removes a URI previously returned by prepareEncryptedPhotoView. */
  releaseEncryptedPhotoView(viewUri: string): Promise<void>;
  /**
   * Both file operations resolve paths only against the app-private filesDir;
   * each operation pins that directory and rejects swapped parent/symlinked leaves.
   * The app-private root is a trusted platform context, not an adversarial boundary.
   */
};

export default requireNativeModule<PhotoVaultKeyLifecycle>('PhotoVault');
