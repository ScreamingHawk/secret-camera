# Android CI and stable releases

Pull requests and pushes to `main` run secret-free Android checks and build a release-variant APK artifact. Production signing credentials are available only to the publish job after a stable `vX.Y.Z` tag passes trust checks. The tag must point to a commit reachable from `main`, its version must match `app.json`, and Android package/version metadata comes from the checked-in release metadata.

The repository variable `ANDROID_SIGNER_SHA256` is the pinned, trusted SHA-256 certificate fingerprint (64 hexadecimal characters, no colons). Configure it in GitHub Actions variables; do not calculate or derive it from the keystore during a release. The release-history verifier uses the same pinned identity and `GH_TOKEN` for read-only release/API access. It checks monotonically increasing Android `versionCode` against verified stable releases.

## Signing setup and backup

Configure GitHub Actions secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, and `ANDROID_STORE_PASSWORD` for the approved Android signing key. The workflow decodes the key into a mode-restricted runner temporary file and installs an EXIT trap to remove it on success or failure. The signing helper checks the final APK against the pinned `ANDROID_SIGNER_SHA256`, package, version name, and version code. Keep an encrypted offline backup of the keystore and passwords separately; loss of this key prevents future updates in this signing lineage. Never commit the keystore or put credentials in ordinary workflow variables.

## Immutable tag reruns

The stable workflow runs `scripts/verify-existing-release.js <stable-tag> <40hex-commit> <output-dir>` before monotonic history checks or building. A confirmed 404 allows a new build. If the release exists, the helper verifies its release/tag/commit, signer, package/version, SHA-256, metadata, and downloads its assets; the workflow then reuses those verified assets without rebuilding, signing, or replacing them. API, authentication, or verification errors fail closed. The publish job repeats the check to handle a release appearing during the workflow; publication occurs only if the helper confirms absence. Existing release assets are never overwritten.

## Local validation

Install dependencies with `npm ci`, then run:

```sh
npm run release:validate -- --metadata
npm run lint
npm run typecheck
npm run test:ci -- --forceExit
npx expo prebuild --platform android --no-install
(cd android && ./gradlew assembleRelease --no-daemon)
```

A CI release-variant APK is not guaranteed to be unsigned and is not a production release. Only the trusted stable-tag workflow's APK after `scripts/sign-apk.sh` verification is production-signed. For production verification, inspect the published APK signature/certificate, package ID, version, and SHA-256.
