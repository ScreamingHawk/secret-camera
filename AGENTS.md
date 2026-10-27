# Repository working agreement

## Issue tracking

Use Beads (`bd`) for implementation tasks. Run `bd prime` and read the exact issue with `bd show <id>` before working. See `.beads/README.md` for the actual Git/JSONL publication procedure; there is no configured Dolt remote.

The initial tickets are backlog capture, not authorization to implement, claim, dispatch, or close them. Verification belongs in each implementation ticket rather than a separate proof-only ticket. Do not seed the earlier broad revival plan as additional tasks without approval.

## Approved scope and release direction

- Android only; no iOS work.
- Keep Expo/React Native unless a demonstrated requirement warrants a change.
- Release target: a developer-operated F-Droid binary repository and documentation published together through CI on GitHub Pages. This is not the default f-droid.org catalogue.
- Routine Google Play publication can be automated, but review/policy/rejection states can require manual intervention. The user's hard condition is no manual steps between deployments; do not substitute Play without explicit approval of those exceptions.
- A one-time signing/repository setup is distinct from recurring deployments. After that setup and a valid release tag, the build, signing, GitHub Release and F-Droid/Pages publication must run without manual approvals or console/upload/indexing steps. Real failures must fail visibly, not be represented as deployed.
- Preserve `link.standen.secretcamera`, compatible signing identity and existing photos. Do not uninstall or delete user photos as an upgrade workaround.
- Encrypt stored photos; normal viewing and sharing must decrypt automatically after authentication. Sharing exports a conventional image, not an encrypted container or a new manual-decrypt workflow.
- Remove unused barcode-scanning dependencies from release artifacts; inspect resolved dependencies rather than assuming a config flag proves removal.
- Preserve the approved Git identity/signing configuration. Never commit secrets, application signing material, private photos or local tracker databases.
