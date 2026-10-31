# Privacy Policy

## Scope

Secret Camera currently implements its photo vault on Android. This policy describes the app's local photo handling; it is not a claim that no platform or distribution provider processes diagnostics. The app itself has no photo-upload service or account server.

## Photos and encryption

Photos captured through the wired Android camera flow are encrypted on-device before being stored in the app-private gallery. The app uses AES-256-GCM through Android Keystore. The key is non-exportable and device-bound; photos are available only while that key remains usable. The app uses the Android system authentication prompt (biometrics when enrolled, with device-credential fallback) to gate app access. This app-level gate is separate from the Keystore key policy: the current Keystore key is not configured to require biometric authentication.

Android cloud backup and device-to-device transfer rules exclude the app's private data, including the encrypted gallery, key-state marker, and temporary plaintext cache. This is intentional: Android Keystore key material is not restored with the files, so backing up ciphertext alone would create an unusable apparent recovery. The app has no cloud backup, key export, restore flow, or recovery password.

Uninstalling removes the app-private photo files and its Keystore key. A device change does not transfer that key. A biometric-enrollment change does not by itself invalidate this key under its current policy. If the key is deleted, missing, or becomes unusable, the app refuses to create a replacement for an existing vault; without a recovery mechanism the encrypted photos are permanently inaccessible. Preserve separate copies of photos you cannot afford to lose before uninstalling or changing devices.

## Viewing and sharing

Viewing decrypts a photo to a temporary app-cache file. The app removes prior view-cache files when its native module starts; this is best-effort file cleanup, not guaranteed secure erasure.

Sharing decrypts the selected photo into a conventional JPEG in the app cache and grants the selected share target read access. Unhanded exports can be removed by the app; handed-off exports are retained for up to about one hour and cleanup is best effort. Android may evict cache files sooner. The receiving app or person may copy or retain the shared JPEG; the app cannot control those copies. Sharing therefore sends plaintext to the destination you select.

## Permissions and third parties

Camera permission is used to capture photos. Android permissions may also be declared by the app or inherited from included dependencies and build configuration; their presence in a manifest does not by itself mean the app uses them. The app does not transmit photos to its own servers. Android, device manufacturers, distribution services, and any receiving app may process information according to their own policies. Review the destination before sharing.

## Deletion

You can delete photos through the app. Uninstalling removes app-private photos and the local key, making any remaining ciphertext inaccessible; it is not a recovery or secure-erasure process. Copies previously shared to other apps are outside the app's control.

## Contact

For privacy questions, contact [michael@standen.link](mailto:michael@standen.link).
