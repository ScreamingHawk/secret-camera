# Repository working agreement

## Issue tracking

Use Beads (`bd`) for implementation tasks. Run `bd prime` and read the exact issue with `bd show <id>` before working. See `.beads/README.md` for the actual Git/JSONL publication procedure; there is no configured Dolt remote.

Implementation is authorized for the publishing chain: `sc-21g` (deterministic versioning) -> `sc-5rc` (tag-triggered signed APK releases) -> `sc-k8v` (personal F-Droid repository plus docs CI). Separately, encryption epic `sc-5ht` is split into seven children; only `sc-5ht.1` (Android Keystore key lifecycle) is authorized now. Its worker owns only `modules/photo-vault/` and must stop after that one slice, without automatically starting later children. Publishing and encryption use separate worktrees; root package/config/version/workflow integration stays publishing-owned until the orchestrator reconciles it. Relock, barcode cleanup and all later encryption children remain unstarted backlog. The orchestrator owns tracker transitions, review, commits and publication. Verification belongs in each implementation ticket rather than a separate proof-only ticket. Do not seed the earlier broad revival plan as additional tasks without approval. Missing signing keys or historical version evidence are real release blockers, not permission to invent a baseline or replace the signer.

## Development verification policy

Prioritise short implementation-to-phone-feedback cycles, not complete coverage. For small UI-only changes, use relevant existing regression tests, typecheck and the ordinary build/bundle check. Do not add a benchmark framework, exhaustive device matrix or repeated native-security runs for unchanged native paths. Deeper checks belong to changes affecting encryption, authentication, conversion or deletion. Preserve signing, upgrades and photo data; never claim a speedup from mocked tests. A representative phone check can supply performance acceptance. Existing CI remains enabled.

Read the exact current ticket for execution authority: the kickoff assignments above are historical, not the current completion state. Settings and the automatic-encryption capture fix are released through v1.1.9; the user confirmed the toggle works. The user now authorised only sc-a5d: incoming Android image-share import honouring that setting. Native URI reception, regenerable manifest/config wiring and authenticated app/storage integration are in scope as needed. Picker import, other backlog work and another signed release need their own approval.

## Approved scope and release direction

- Android only; no iOS work.
- Keep Expo/React Native unless a demonstrated requirement warrants a change.
- Release target: a developer-operated F-Droid binary repository and documentation published together through CI on GitHub Pages. This is not the default f-droid.org catalogue.
- Routine Google Play publication can be automated, but review/policy/rejection states can require manual intervention. The user's hard condition is no manual steps between deployments; do not substitute Play without explicit approval of those exceptions.
- A one-time signing/repository setup is distinct from recurring deployments. After that setup and a valid release tag, the build, signing, GitHub Release and F-Droid/Pages publication must run without manual approvals or console/upload/indexing steps. Real failures must fail visibly, not be represented as deployed.
- Preserve `link.standen.secretcamera`, compatible signing identity and existing photos. Do not uninstall or delete user photos as an upgrade workaround.
- Under sc-s5q, encrypt new camera saves only when the persisted "Encrypt automatically" setting is enabled (default on). Disabled captures and explicit bulk decryption remain app-private but unencrypted at rest. Bulk actions do not change the toggle. Viewing/sharing must transparently support both formats after authentication; sharing exports a conventional image.
- Remove unused barcode-scanning dependencies from release artifacts; inspect resolved dependencies rather than assuming a config flag proves removal.
- Preserve the approved Git identity/signing configuration. Never commit secrets, application signing material, private photos or local tracker databases.
