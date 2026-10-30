package expo.modules.photovault

import java.io.File

/** Serial, resumable migration of direct legacy JPEG children in the trusted gallery. */
internal class LegacyPhotoMigrator(
  private val gallery: File,
  private val capture: CaptureCoordinator,
  private val codec: () -> EncryptedPhotoCodec
) {
  data class Result(val migrated: Int, val remaining: Int, val failed: Int, val errorCode: String?)

  fun migrate(): Result = synchronized(PhotoMutationGate.lock) {
    val sources = eligibleSources()
    if (sources.isEmpty()) return@synchronized Result(0, 0, 0, null)
    capture.prepareCaptureVault()
    var migrated = 0
    for (source in sources) {
      try { codec().migrateLegacyFile(source.name); migrated++ }
      catch (_: Exception) {
        return@synchronized Result(migrated, eligibleSources().size, 1, "migration_failed")
      }
    }
    Result(migrated, eligibleSources().size, 0, null)
  }

  private fun eligibleSources(): List<File> = gallery.listFiles()?.filter {
    !it.isSymbolicLink() && it.isFile &&
      (it.name.endsWith(".jpg", true) || it.name.endsWith(".jpeg", true))
  } ?: error("Gallery unavailable")

  private fun File.isSymbolicLink(): Boolean = try { android.system.Os.lstat(path).let { (it.st_mode and android.system.OsConstants.S_IFMT) == android.system.OsConstants.S_IFLNK } } catch (_: Exception) { true }
}

internal object PhotoMutationGate {
  val lock = Any()
  fun deleteGalleryPhoto(gallery: File, filename: String) = synchronized(lock) {
    require(filename.isNotBlank() && File(filename).name == filename && filename != "." && filename != "..")
    val target = File(gallery, filename)
    require(target.canonicalFile.parentFile == gallery.canonicalFile && target.isFile)
    check(!java.nio.file.Files.isSymbolicLink(target.toPath()))
    check(target.delete())
  }
}
