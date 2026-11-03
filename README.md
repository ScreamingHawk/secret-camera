# Secret Camera App 📸

An Android camera application that stores captured photos in app-private storage, with optional authenticated encryption at rest.

## Features

- 🔑 Device authentication (biometrics or device credential) gates app access
- 📱 Take photos using front or back camera
- 🔒 Encrypt stored photos with an Android Keystore AES-256-GCM key
- 🖼️ View photos in a gallery interface
- 📤 Share photos directly from the viewer
- 📱 Android only; iOS vault support is not implemented

## Vault, sharing and recovery

Captured photos are encrypted on-device by default. The Settings page lets you disable encryption for future captures or encrypt/decrypt existing gallery photos in bulk. Photos saved with encryption disabled, and photos explicitly decrypted, remain in app-private storage but are unencrypted at rest. Changing the setting does not convert existing photos. The non-exportable encryption key stays in Android Keystore; it is not tied to biometric authentication under the current key policy. Android cloud backup and device transfer explicitly exclude app data. There is no cloud backup, key export, recovery password, or restore mechanism.

Uninstalling the app removes its private photos and key. Moving to another device does not move the key or vault. Changing enrolled biometrics does not by itself invalidate this key because the key does not require biometric authorization; if Android Keystore nevertheless reports the key missing or unusable (for example after device/security-state changes), the app refuses to replace it for an existing vault. The encrypted photos then cannot be recovered. Keep any photos you need elsewhere before uninstalling or relying on this app.

Sharing decrypts a selected photo into a conventional JPEG in the app cache and grants the selected share target read access. The app attempts to remove unhanded exports and expires handed-off exports after about one hour, but cache eviction/cleanup is best-effort, not secure erasure; recipients can retain copies. Viewing also uses temporary plaintext cache files, cleaned on module startup. Do not share a photo unless you accept that the receiving app may keep it.

Secret Camera can also receive Android JPEG image shares. Received bytes are copied (not moved or deleted) into bounded app-private pending storage and are not shown or committed to the gallery until successful app authentication and settings load. Incoming imports preserve the original JPEG bytes and orientation metadata. The import uses the current persisted “Encrypt automatically” setting: encrypted imports are authenticated ciphertext; disabled imports are ordinary app-private JPEGs. This import does not change the setting and never falls back from encryption to plaintext. Only valid JPEGs up to 32 MiB per image are accepted; the pending area is capped at 20 items and 64 MiB total. PNG, WebP, GIF, corrupt images and oversized files are rejected without changing the sender original. Pending copies are removed only after the gallery file has been verified and durably published.

On Android, selected images can also be imported from the system photo picker. This picker flow currently accepts valid JPEG images only (up to 32 MiB each); PNG, WebP, GIF, other formats, corrupt images and oversized files are not imported. The selected image is copied through bounded private staging and the existing authenticated import path, using the persisted “Encrypt automatically” setting after authentication/settings reload. Importing does not make the original private or remove/change it: originals remain in their existing gallery or storage. Picker access is scoped to the selected items; the feature does not request broad photo-library permission.

## Getting Started

1. Install dependencies and set up development environment

   ```bash
   npm install
   npm run prepare-dev
   ```

2. Start the development server

   ```bash
   npx expo start
   ```

3. Launch the app on your preferred platform:
   - Android (tested)
   - iOS (untested)

## Required Permissions

The app requires the following permissions:

- Camera access
- Microphone access (for future video support)

## Development

- `npm start` - Start the Expo development server
- `npm run android` - Start for Android
- `npm run ios` - Start for iOS (untested)
- `npm run web` - Start for web
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier
- `npm run prepare-dev` - Set up git hooks for development
- `npm test` - Run tests

### Release

- `eas build -p android` - Build for Android
- `eas build -p ios` - Build for iOS (untested)
- `eas submit -p android` - Submit for Android
- `eas submit -p ios` - Submit for iOS (untested)

## Contributing

1. Ensure you have the latest dependencies installed
2. Make your changes
3. Run the linter and formatter:
   ```bash
   npm run lint
   npm run format
   ```
4. Submit your pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
