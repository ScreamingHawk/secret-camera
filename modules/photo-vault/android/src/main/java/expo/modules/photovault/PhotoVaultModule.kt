package expo.modules.photovault

import expo.modules.kotlin.modules.Module
import java.io.File

import expo.modules.kotlin.modules.ModuleDefinition

class PhotoVaultModule : Module() {
  private val keys = VaultKeyStore()
  private val context get() = appContext.reactContext!!

  private fun cleanViewCache() {
    val cache = File(context.cacheDir, "photo-vault-views")
    cache.listFiles()?.filter { it.name.matches(Regex("view-[0-9a-f-]{36}\\.jpg")) }?.forEach { it.delete() }
  }
  private fun codec() = EncryptedPhotoCodec(context.filesDir, keys)
  private fun galleryDir() = File(context.filesDir, ".secret-camera")
  private fun viewDir() = File(context.cacheDir, "photo-vault-views")
  private fun viewCodec() = EncryptedPhotoCodec(galleryDir(), keys, trustedOutputDir = viewDir())

  private fun prepareView(filename: String): String {
    require(filename.isNotBlank() && File(filename).name == filename && filename != "." && filename != "..") { "Expected encrypted photo filename" }
    check(galleryDir().isDirectory) { "Encrypted gallery is unavailable" }
    check(viewDir().exists() || viewDir().mkdirs()) { "Private view cache is unavailable" }
    val file = viewCodec().prepareView(filename)
    return "${file.toURI()}"
  }

  override fun definition() = ModuleDefinition {
    Name("PhotoVault")
    OnCreate { cleanViewCache() }

    AsyncFunction("initializeNewVault") {
      keys.initializeNewVault()
      VaultKeyStore.DEFAULT_ALIAS
    }

    AsyncFunction("requireExistingKey") {
      keys.requireExistingKey()
      VaultKeyStore.DEFAULT_ALIAS
    }

    AsyncFunction("encryptFile") { inputPath: String, outputPath: String ->
      codec().encrypt(inputPath, outputPath)
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
  }
}
