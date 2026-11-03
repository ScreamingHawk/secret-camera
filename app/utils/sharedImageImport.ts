import PhotoVault from '../../modules/photo-vault/src/PhotoVault';
import { APP_DIRECTORY } from '../constants';
import { runPhotoOperation } from './photoOperation';

export type SharedImageImportResult = {
  imported: string[];
  failed: number;
  stageFailure: boolean;
};

export async function importPendingSharedImages(
  encryptAutomatically: boolean
): Promise<SharedImageImportResult> {
  return runPhotoOperation(async () => {
    const requests = await PhotoVault.listPendingImageShares();
    const result: SharedImageImportResult = {
      imported: [],
      failed: 0,
      stageFailure: await PhotoVault.consumePendingImageShareFailure(),
    };
    for (const request of requests) {
      try {
        const pending = await PhotoVault.consumePendingImageShare(request.id);
        if (!pending) continue;
        // Explicit setting argument and deterministic native destination make retries safe.
        const saved = await PhotoVault.importPendingImageShare(
          pending.id,
          encryptAutomatically
        );
        await PhotoVault.acknowledgePendingImageShare(pending.id);
        result.imported.push(
          `${APP_DIRECTORY.SECRET_CAMERA}/${saved.filename}`
        );
      } catch {
        // Keep the owned pending copy for a safe later retry; never handle the provider URI here.
        result.failed += 1;
      }
    }
    return result;
  });
}
