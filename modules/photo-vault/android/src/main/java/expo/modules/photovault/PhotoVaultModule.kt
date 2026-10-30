package expo.modules.photovault

import expo.modules.kotlin.modules.Module
import java.io.File
import android.os.Handler
import android.os.Looper

import expo.modules.kotlin.modules.ModuleDefinition

class PhotoVaultModule : Module() {
  private val cleanupHandler = Handler(Looper.getMainLooper())
  private val cleanupExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
  private val cleanupLifecycleLock = Any()
  private var cleanupDestroyed = false
  private fun queueShareCleanup() = synchronized(cleanupLifecycleLock) {
    if (!cleanupDestroyed) {
      // Capture the coordinator while the module still has its React context.
      val exports = shareExports
      cleanupExecutor.execute { runCatching { exports.cleanup() } }
    }
  }
  private val cleanupTask = object : Runnable {
    override fun run() = synchronized(cleanupLifecycleLock) {
      if (!cleanupDestroyed) {
        try { queueShareCleanup() }
        finally { cleanupHandler.postDelayed(this, 15 * 60 * 1000L) }
      }
    }
  }
  private val shareExports by lazy { ShareExportCoordinator(shareDir()) }
  private val keys = VaultKeyStore()

  private val context get() = appContext.reactContext!!

  private fun cleanViewCache() {
    val cache = File(context.cacheDir, "photo-vault-views")
    cache.listFiles()?.filter { it.name.matches(Regex("view-[0-9a-f-]{36}\\.jpg")) }?.forEach { it.delete() }
  }
  private fun codec() = EncryptedPhotoCodec(context.filesDir, keys)
  private fun galleryDir() = File(context.filesDir, ".secret-camera")
  private fun viewDir() = File(context.cacheDir, "photo-vault-views")
  private fun shareDir() = File(context.cacheDir, "photo-vault-shares")
  private fun cleanShareCache() = shareExports.cleanup()
  private fun prepareShare(filename: String): String {
    require(filename.isNotBlank() && File(filename).name == filename && filename != "." && filename != "..") { "Expected encrypted photo filename" }
    check(galleryDir().isDirectory) { "Encrypted gallery is unavailable" }
    check(shareDir().exists() || shareDir().mkdirs()) { "Private share cache is unavailable" }
    return shareExports.prepare {
      EncryptedPhotoCodec(galleryDir(), keys, trustedOutputDir = shareDir()).prepareShare(filename)
    }.toURI().toString()
  }
  private fun viewCodec() = EncryptedPhotoCodec(galleryDir(), keys, trustedOutputDir = viewDir())
  private fun captureCoordinator() = CaptureCoordinator(context.filesDir, File(context.cacheDir, ".secret-camera"), galleryDir(), viewDir(), keys)

  private fun prepareView(filename: String): String {
    require(filename.isNotBlank() && File(filename).name == filename && filename != "." && filename != "..") { "Expected encrypted photo filename" }
    check(galleryDir().isDirectory) { "Encrypted gallery is unavailable" }
    check(viewDir().exists() || viewDir().mkdirs()) { "Private view cache is unavailable" }
    val file = viewCodec().prepareView(filename)
    return "${file.toURI()}"
  }

  override fun definition() = ModuleDefinition {
    Name("PhotoVault")
    OnCreate {
      cleanViewCache()
      synchronized(cleanupLifecycleLock) {
        queueShareCleanup()
        cleanupHandler.postDelayed(cleanupTask, 15 * 60 * 1000L)
      }
    }
    OnActivityEntersForeground { queueShareCleanup() }
    OnDestroy {
      synchronized(cleanupLifecycleLock) {
        cleanupDestroyed = true
        cleanupHandler.removeCallbacks(cleanupTask)
        cleanupExecutor.shutdown()
      }
    }

    AsyncFunction("initializeNewVault") {
      keys.initializeNewVault()
      VaultKeyStore.DEFAULT_ALIAS
    }

    AsyncFunction("prepareCaptureVault") { captureCoordinator().prepareCaptureVault() }

    AsyncFunction("requireExistingKey") {
      keys.requireExistingKey()
      VaultKeyStore.DEFAULT_ALIAS
    }

    AsyncFunction("encryptFile") { inputPath: String, outputPath: String ->
      codec().encrypt(inputPath, outputPath)
    }

    AsyncFunction("encryptCapturedPhoto") { inputPath: String ->
      val result = captureCoordinator().save(File(inputPath))
      mapOf("filename" to result.filename, "sourceRemoved" to result.sourceRemoved)
    }

    AsyncFunction("decryptFile") { inputPath: String, outputPath: String ->
      codec().decrypt(inputPath, outputPath)
    }

    AsyncFunction("prepareEncryptedPhotoView") { filename: String -> prepareView(filename) }

    AsyncFunction("releaseEncryptedPhotoView") { viewUri: String ->
      val file = File(java.net.URI(viewUri))
      require(file.parentFile.canonicalFile == viewDir().canonicalFile) { "View does not belong to private view cache" }
      if (file.exists()) {
        viewCodec().releaseView(file.name)
        check(!file.exists()) { "Unable to release private view" }
      }
    }

    AsyncFunction("prepareEncryptedPhotoShare") { filename: String -> prepareShare(filename) }
    AsyncFunction("cleanupEncryptedPhotoShares") { cleanShareCache() }
    AsyncFunction("abandonOwnedShare") { uri: String ->
      shareExports.abandon(File(java.net.URI(uri)))
    }
    AsyncFunction("beginEncryptedPhotoShare") { uri: String ->
      shareExports.begin(File(java.net.URI(uri)))
      Unit
    }
    AsyncFunction("finishEncryptedPhotoShare") { uri: String ->
      shareExports.finish(File(java.net.URI(uri)))
    }
  }
}
