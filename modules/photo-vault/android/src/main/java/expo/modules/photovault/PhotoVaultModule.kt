package expo.modules.photovault

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhotoVaultModule : Module() {
  private val keys = VaultKeyStore()
  private fun codec() = EncryptedPhotoCodec(appContext.reactContext!!.filesDir, keys)

  override fun definition() = ModuleDefinition {
    Name("PhotoVault")

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
  }
}
