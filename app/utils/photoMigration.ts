import PhotoVault from '../../modules/photo-vault/src/PhotoVault';

type MigrationResult = Awaited<
  ReturnType<typeof PhotoVault.migrateLegacyGalleryPhotos>
>;
let pending: Promise<MigrationResult> | null = null;

/** Preserve the active operation across gallery unmounts; never starts on its own. */
export function getPendingMigration() {
  return pending;
}

export function runLegacyMigration(): Promise<MigrationResult> {
  if (pending) return pending;
  const operation = Promise.resolve().then(() =>
    PhotoVault.migrateLegacyGalleryPhotos()
  );
  pending = operation.finally(() => {
    pending = null;
  });
  return pending;
}
