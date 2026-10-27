import { requireNativeModule } from 'expo-modules-core';

export type PhotoVaultKeyLifecycle = {
  /** Explicitly creates the first key; rejects if the stable alias already exists. */
  initializeNewVault(): Promise<string>;
  /** Retrieves the existing key or rejects without creating/replacing it. */
  requireExistingKey(): Promise<string>;
};

export default requireNativeModule<PhotoVaultKeyLifecycle>('PhotoVault');
