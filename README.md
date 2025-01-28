# Secret Camera App 📸

A secure camera application built with Expo that allows you to take and store photos in a private directory.

## Features

- 📱 Take photos using front or back camera
- 🔒 Store photos in a secure, private directory
- 🖼️ View photos in a gallery interface
- 📤 Share photos directly from the viewer
- 📱 Cross-platform support for iOS and Android

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
