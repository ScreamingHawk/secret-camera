# Beads issue tracking

This repository uses the `bd` CLI (initialized with Beads 1.0.3) with issue prefix `sc` and a local embedded Dolt database.

## Daily commands

```sh
bd prime
bd list --limit 0
bd ready --limit 0
bd show <id>
bd update <id> --status in_progress
bd close <id> --reason "Implemented and verified ..."
```

Creating a ticket is not authorization to implement it. Keep future tasks open until implementation is requested. Put tests and real verification in each implementation ticket; do not create separate proof-only tickets for routine development acceptance.

## Publication and collaboration

There is **no Dolt remote configured**. The database is local and ignored by Git; `git push` does not publish that database. The reviewed `.beads/issues.jsonl` export is the versioned issue snapshot.

After all issue edits and comments are complete:

```sh
bd export --no-memories -o .beads/issues.jsonl
bd dep cycles
bd lint
bd blocked
bd ready --limit 0
# Review the JSONL for secrets and personal runtime metadata.
git add .beads/issues.jsonl
git commit -m "chore: update tracked issues"
git push
```

Use the configured project actor for tracker audit fields; preserve the approved Git author and signing configuration. Owner fields may default to local Git identity: normalize public snapshot owner/audit metadata to `Project Contributors` after the final export, preserving all actual issue content. Do not claim the snapshot updates automatically on Git commits. A populated-tracker restore procedure has not been tested here; consult the installed `bd` help before importing into a fresh local database.

Do not commit Dolt runtime directories, backup state, credentials, signing keys, or plaintext/private photos. No Git hooks were installed by this initialization, so the existing Lefthook setup remains unchanged.
