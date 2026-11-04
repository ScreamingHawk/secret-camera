package expo.modules.photovault

import expo.modules.kotlin.modules.Module
import java.io.File
import android.os.Handler
import android.os.Looper

import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

private const val DELIVERY_PROOF = "expo.modules.photovault.delivery-proof"

internal data class PendingImageImportTarget(val filename: String, val encrypted: Boolean)

/** Existing committed format wins; otherwise a pre-commit retry uses the current persisted setting. */
internal fun selectPendingImageImportTarget(gallery: File, id: String, requestedEncrypted: Boolean, mimeType: String = "image/jpeg"): PendingImageImportTarget {
  require(id.matches(Regex("[0-9a-f-]{36}"))) { "Invalid pending image identifier" }
  require(mimeType == "image/jpeg" || mimeType == "image/png") { "Unsupported pending image format" }
  val extension = if (mimeType == "image/png") "png" else "jpg"
  val plain = File(gallery, "photo-share-$id.$extension")
  val encryptedNamed = File(gallery, "photo-share-$id.$extension.scv")
  val legacyEncrypted = File(gallery, "photo-share-$id.scv")
  val otherExtension = if (extension == "png") "jpg" else "png"
  require(!File(gallery, "photo-share-$id.$otherExtension").exists() &&
    !File(gallery, "photo-share-$id.$otherExtension.scv").exists() &&
    (mimeType == "image/jpeg" || !legacyEncrypted.exists())) { "Conflicting import destinations exist" }
  val encrypted = if (encryptedNamed.exists()) encryptedNamed else legacyEncrypted
  require(!(plain.exists() && encrypted.exists()) && !(encryptedNamed.exists() && legacyEncrypted.exists())) { "Conflicting import destinations exist" }
  return when {
    encrypted.exists() -> PendingImageImportTarget(encrypted.name, true)
    plain.exists() -> PendingImageImportTarget(plain.name, false)
    requestedEncrypted -> PendingImageImportTarget(if (mimeType == "image/png") encryptedNamed.name else legacyEncrypted.name, true)
    else -> PendingImageImportTarget(plain.name, false)
  }
}

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
  private val pendingPreferenceStore by lazy {
    context.getSharedPreferences("pending-image-shares", android.content.Context.MODE_PRIVATE)
  }
  private val deliverySecret: ByteArray by lazy {
    val encoded = pendingPreferenceStore.getString("deliverySecret", null)
    if (encoded != null) android.util.Base64.decode(encoded, android.util.Base64.NO_WRAP)
    else ByteArray(32).also { bytes ->
      java.security.SecureRandom().nextBytes(bytes)
      check(pendingPreferenceStore.edit().putString("deliverySecret", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)).commit())
    }
  }
  private fun deliveryProof(token: String): String {
    val mac = javax.crypto.Mac.getInstance("HmacSHA256")
    mac.init(javax.crypto.spec.SecretKeySpec(deliverySecret, "HmacSHA256"))
    return android.util.Base64.encodeToString(mac.doFinal(token.toByteArray(Charsets.UTF_8)), android.util.Base64.NO_WRAP)
  }
  private val pendingShares by lazy {
    val resolver = context.contentResolver
    PendingImageShares(
      File(context.filesDir, ".secret-camera-pending"), resolver::getType, resolver::openInputStream,
      { pendingPreferenceStore.getString("lastDeliveryToken", null) == it },
      { token -> check(pendingPreferenceStore.edit().putString("lastDeliveryToken", token).commit()) }
    )
  }
  private val pendingShareExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()

  private fun receiveShare(intent: android.content.Intent) {
    val suppliedToken = intent.getStringExtra(PendingImageShares.DELIVERY_TOKEN)
    val suppliedProof = intent.getStringExtra(DELIVERY_PROOF)
    val token = if (suppliedToken != null && suppliedProof != null &&
      java.security.MessageDigest.isEqual(suppliedProof.toByteArray(), deliveryProof(suppliedToken).toByteArray())) {
      suppliedToken
    } else UUID.randomUUID().toString()
    intent.putExtra(PendingImageShares.DELIVERY_TOKEN, token)
    intent.putExtra(DELIVERY_PROOF, deliveryProof(token))
    appContext.currentActivity?.intent = intent
    val isShareIntent = intent.action == android.content.Intent.ACTION_SEND || intent.action == android.content.Intent.ACTION_SEND_MULTIPLE
    pendingShareExecutor.execute {
      val result = runCatching { pendingShares.receive(intent) }
      if (result.getOrNull()?.isNotEmpty() == true) {
        sendEvent("pendingImageSharesChanged", mapOf("failed" to false))
      } else if (isShareIntent && result.isFailure) {
        pendingPreferenceStore.edit().putBoolean("receiveFailurePending", true).commit()
        sendEvent("pendingImageSharesChanged", mapOf("failed" to true))
      }
    }
  }

  private fun importPendingImage(id: String, encrypted: Boolean): String = synchronized(PhotoMutationGate.lock) {
    require(id.matches(Regex("[0-9a-f-]{36}"))) { "Invalid pending image identifier" }
    val staged = pendingShares.consume(id) ?: error("Pending image is no longer available")
    val gallery = galleryDir()
    check(gallery.exists() || gallery.mkdirs()) { "Private gallery unavailable" }
    val target = selectPendingImageImportTarget(gallery, id, encrypted, staged.mimeType)
    val committedEncrypted = target.encrypted
    val leaf = target.filename
    val source = File(java.net.URI(staged.uri))
    check(source.canonicalFile.parentFile == File(context.filesDir, ".secret-camera-pending").canonicalFile && source.isFile) {
      "Owned pending image is unavailable"
    }
    val temp = File(context.filesDir, ".pending-import-$id.tmp")
    try {
      if (committedEncrypted) captureCoordinator().prepareCaptureVault()
      check(!temp.exists() || temp.delete()) { "Unable to clear owned import staging" }
      source.inputStream().use { input -> temp.outputStream().use { output ->
        input.copyTo(output); output.fd.sync()
      } }
      check(temp.length() == source.length() && temp.readBytes().contentEquals(source.readBytes())) {
        "Owned import staging verification failed"
      }
      EncryptedPhotoCodec(context.filesDir, keys, trustedOutputDir = gallery)
        .importImage(temp.path, leaf, committedEncrypted)
      check(pendingPreferenceStore.edit().putBoolean("importCommitted.$id", committedEncrypted).commit()) {
        "Unable to record verified import"
      }
      leaf
    } finally { temp.delete() }
  }


  private val context get() = appContext.reactContext!!

  private fun cleanViewCache() {
    val cache = File(context.cacheDir, "photo-vault-views")
    cache.listFiles()?.filter { it.name.matches(Regex("view-[0-9a-f-]{36}\\.(jpg|png)")) }?.forEach { it.delete() }
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
    Events("pendingImageSharesChanged")
    OnCreate {
      appContext.currentActivity?.intent?.let(::receiveShare)
      cleanViewCache()
      synchronized(cleanupLifecycleLock) {
        queueShareCleanup()
        cleanupHandler.postDelayed(cleanupTask, 15 * 60 * 1000L)
      }
    }
    OnActivityEntersForeground { queueShareCleanup() }
    OnNewIntent { intent -> receiveShare(intent) }
    OnDestroy {
      synchronized(cleanupLifecycleLock) {
        cleanupDestroyed = true
        cleanupHandler.removeCallbacks(cleanupTask)
        cleanupExecutor.shutdown()
        pendingShareExecutor.shutdown()
      }
    }

    AsyncFunction("listPendingImageShares") {
      pendingShares.list().map { mapOf("id" to it.id, "uri" to it.uri, "mimeType" to it.mimeType) }
    }
    AsyncFunction("consumePendingImageShare") { id: String ->
      pendingShares.consume(id)?.let { mapOf("id" to it.id, "uri" to it.uri, "mimeType" to it.mimeType) }
    }
    AsyncFunction("acknowledgePendingImageShare") { id: String ->
      pendingShares.acknowledge(id)
      pendingPreferenceStore.edit()
        .remove("importEncrypted.$id")
        .remove("importCommitted.$id")
        .apply()
    }
    AsyncFunction("consumePendingImageShareFailure") {
      val failed = pendingPreferenceStore.getBoolean("receiveFailurePending", false)
      if (failed) check(pendingPreferenceStore.edit().remove("receiveFailurePending").commit())
      failed
    }
    AsyncFunction("stagePickedImage") { uriString: String ->
      val uri = android.net.Uri.parse(uriString)
      pendingShares.stagePickerImageFile(uri, context.cacheDir)
      Unit
    }
    AsyncFunction("importPendingImageShare") { id: String, encryptAutomatically: Boolean ->
      mapOf("filename" to importPendingImage(id, encryptAutomatically))
    }

    AsyncFunction("initializeNewVault") {
      keys.initializeNewVault()
      VaultKeyStore.DEFAULT_ALIAS
    }

    AsyncFunction("prepareCaptureVault") { captureCoordinator().prepareCaptureVault() }

    AsyncFunction("migrateLegacyGalleryPhotos") {
      val capture = captureCoordinator()
      LegacyPhotoMigrator(galleryDir(), capture) {
        EncryptedPhotoCodec(galleryDir(), keys, trustedOutputDir = galleryDir())
      }.migrate().let { mapOf("migrated" to it.migrated, "remaining" to it.remaining, "failed" to it.failed, "errorCode" to it.errorCode) }
    }

    AsyncFunction("decryptGalleryPhoto") { filename: String ->
      check(galleryDir().isDirectory) { "Private gallery is unavailable" }
      LegacyPhotoMigrator(galleryDir(), captureCoordinator()) {
        EncryptedPhotoCodec(galleryDir(), keys, trustedOutputDir = galleryDir())
      }.decrypt(filename)
    }

    AsyncFunction("deleteGalleryPhoto") { filename: String ->
      PhotoMutationGate.deleteGalleryPhoto(galleryDir(), filename)
    }

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
