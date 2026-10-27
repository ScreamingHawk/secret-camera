# Photo vault key foundation (Android only)

This module is a key-lifecycle foundation only. **It does not encrypt existing or newly captured app photos.** The app is not currently protected at rest by this module.

## Native contract

- `initializeNewVault()` explicitly creates the stable alias `secret-camera.photo-vault.v1` using AndroidKeyStore AES-256 with GCM and no padding. It refuses an already-present alias; it never rotates it.
- `requireExistingKey()` retrieves only that alias. If missing or not a `SecretKey`, it throws a non-secret `IllegalStateException`; it does not create a key or substitute another one. A key invalidated or otherwise rejected by AndroidKeyStore/crypto operations must be surfaced to the caller; do not silently initialize a replacement because previously encrypted content would be unrecoverable.
- The Expo bridge methods return the nonsecret alias only. `SecretKey`/raw bytes remain native and `SecretKey.encoded` is not exportable. Hardware-backed storage depends on the device and is not guaranteed.

## Next consumer contract

A future native file-codec method should call `requireExistingKey()`, use `AES/GCM/NoPadding`, persist the fresh IV alongside authenticated ciphertext, and let authentication/key-loss errors fail visibly. Only the first-vault-creation flow may call `initializeNewVault()`. No file format, photo integration, migration, backup, relock, biometric prompt, or iOS behavior is implemented here.

## Checks

From the repository root, after SDK 52 prebuild has generated `android/`, compile the module and instrumented tests with `cd android && ./gradlew :expo-photo-vault:compileDebugAndroidTestKotlin :expo-photo-vault:assembleDebug`. The actual autolinked Gradle project is `:expo-photo-vault` (confirmed by `./gradlew projects`). On an authorized Android device/emulator run `cd android && ./gradlew :expo-photo-vault:connectedDebugAndroidTest`. Instrumented tests use isolated synthetic aliases and synthetic bytes; they exercise AndroidKeyStore only when run on Android. A JVM/JCA test is not equivalent evidence.
