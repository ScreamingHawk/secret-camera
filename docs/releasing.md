# Release versioning

Before creating a stable `vX.Y.Z` release, set `ANDROID_SIGNER_SHA256` to the expected signing certificate's 64-character SHA-256 digest (hex, without colons), and configure the Android SDK using `ANDROID_SDK_ROOT` or `ANDROID_HOME`. The history checker uses SDK build-tools `35.0.0` and requires `gh` authenticated for `ScreamingHawk/secret-camera`.

Run from the repository root:

```sh
node scripts/release-history.js
```

The command prints the highest verified stable APK `versionCode` as a number. It downloads each stable release's `secret-camera.apk`, verifies its APK signature, certificate digest, application ID, and version code, and fails closed if any stable entry is missing or cannot be verified. Drafts and prereleases are ignored. With no stable releases, it prints `0`: this is the explicitly approved baseline for the fresh signer lineage, not a claim about legacy releases.

Use that exact output as `PREVIOUS_VERSION_CODE` when running the release validator, then ensure the next `app.json` Android `versionCode` is greater:

```sh
PREVIOUS_VERSION_CODE="$(node scripts/release-history.js)" node scripts/validate-release.js --release vX.Y.Z
```

For an immutable rerun of a tag already published, first independently verify that release and its assets; do not exclude the current tag from history as a shortcut around monotonic version-code checks.
