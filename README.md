# Secret Camera App 📸

An Android camera application built with Expo that stores captured photos as authenticated encrypted files in app-private storage.

## Features

- 🔑 Device authentication (biometrics or device credential) gates app access
- 📱 Take photos using front or back camera
- 🔒 Encrypt stored photos with an Android Keystore AES-256-GCM key
- 🖼️ View photos in a gallery interface
- 📤 Share photos directly from the viewer
- 📱 Android only; iOS vault support is not implemented

## Vault, sharing and recovery

Captured photos are encrypted on-device. The non-exportable key stays in Android Keystore; it is not tied to biometric authentication under the current key policy. Android cloud backup and device transfer explicitly exclude app data, including encrypted photos and temporary plaintext cache files, because restoring ciphertext without its device-bound key would be unusable. There is no cloud backup, key export, recovery password, or restore mechanism.

Uninstalling the app removes its private photos and key. Moving to another device does not move the key or vault. Changing enrolled biometrics does not by itself invalidate this key because the key does not require biometric authorization; if Android Keystore nevertheless reports the key missing or unusable (for example after device/security-state changes), the app refuses to replace it for an existing vault. The encrypted photos then cannot be recovered. Keep any photos you need elsewhere before uninstalling or relying on this app.

Sharing decrypts a selected photo into a conventional JPEG in the app cache and grants the selected share target read access. The app attempts to remove unhanded exports and expires handed-off exports after about one hour, but cache eviction/cleanup is best-effort, not secure erasure; recipients can retain copies. Viewing also uses temporary plaintext cache files, cleaned on module startup. Do not share a photo unless you accept that the receiving app may keep it.

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
