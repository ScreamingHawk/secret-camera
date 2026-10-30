package expo.modules.photovault

import android.system.Os
import android.system.OsConstants
import java.io.File
import java.util.UUID

/** Production capture lifecycle shared by the Expo bridge and instrumented tests. */
internal class CaptureCoordinator(
  private val filesDir: File,
  private val cacheDir: File,
  private val galleryDir: File,
  private val viewDir: File,
  private val keys: VaultKeyStore,
  private val marker: File = File(filesDir, ".secret-camera-vault-initialized"),
  private val removeSource: (File) -> Boolean = { it.delete() },
  private val codecFactory: (File, File) -> EncryptedPhotoCodec = { input, output ->
    EncryptedPhotoCodec(input, keys, trustedOutputDir = output)
  }
) {
  private companion object { val PROCESS_LOCK = Any() }

  data class SaveResult(val filename: String, val sourceRemoved: Boolean)

  fun prepareCaptureVault() = synchronized(PROCESS_LOCK) { prepareCaptureVaultLocked() }

  private fun prepareCaptureVaultLocked() {
    ensureDir(cacheDir)
    ensureDir(galleryDir)
    val galleryEntries = galleryDir.listFiles() ?: error("Encrypted gallery unavailable")
    val marked = marker.exists()
    if (marked || galleryEntries.isNotEmpty()) {
      keys.requireExistingKey()
      if (!marked) createMarker()
      return
    }
    // Exclusive marker precedes key creation: a crash is a visible refusal, never implicit recovery.
    createMarker()
    try { keys.initializeNewVault() }
    catch (failure: Exception) {
      try { keys.requireExistingKey() }
      catch (missing: Exception) { throw IllegalStateException("Vault initialization failed; refusing silent recovery", failure) }
    }
  }

  fun initializeNewVault(): String = synchronized(PROCESS_LOCK) { keys.initializeNewVault().let { VaultKeyStore.DEFAULT_ALIAS } }

  fun save(source: File): SaveResult = synchronized(PROCESS_LOCK) {
    prepareCaptureVaultLocked()
    ensureDir(viewDir)
    require(source.isAbsolute && source.parentFile?.canonicalFile == cacheDir.canonicalFile && source.isFile) {
      "Capture must be directly inside private camera cache"
    }
    val filename = "photo-${UUID.randomUUID()}.scv"
    val encrypted = File(galleryDir, filename)
    codecFactory(cacheDir, galleryDir).encrypt(source.path, encrypted.path)
    try {
      val view = codecFactory(galleryDir, viewDir).prepareView(filename)
      try { check(view.isFile) { "Encrypted photo validation failed" } } finally { view.delete() }
    } catch (failure: Exception) {
      encrypted.delete()
      throw failure
    }
    SaveResult(filename, removeSource(source))
  }

  private fun ensureDir(dir: File) { check(dir.exists() || dir.mkdirs()) { "Private photo directory unavailable" }; check(dir.isDirectory) { "Private photo directory unavailable" } }

  private fun createMarker() {
    val fd = try { Os.open(marker.path, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 0x180) }
    catch (failure: Exception) {
      if (marker.isFile) return
      throw IllegalStateException("Vault state marker unavailable; refusing silent recovery", failure)
    }
    try { Os.fsync(fd) } finally { Os.close(fd) }
    var directoryFd: java.io.FileDescriptor? = null
    try {
      val fd = Os.open(filesDir.path, OsConstants.O_RDONLY or OsConstants.O_CLOEXEC, 0)
      directoryFd = fd
      Os.fsync(fd)
    } catch (failure: Exception) {
      throw IllegalStateException("Vault state marker could not be persisted", failure)
    } finally {
      directoryFd?.let { Os.close(it) }
    }
  }
}
