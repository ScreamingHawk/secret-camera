package expo.modules.photovault

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PhotoVaultModule : Module() {
  private val keys = VaultKeyStore()

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
  }
}
