package expo.modules.photovault

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

/** Owns only the stable AndroidKeyStore key for a vault; it never exports key bytes. */
internal class VaultKeyStore(private val alias: String = DEFAULT_ALIAS) {
  fun initializeNewVault(): SecretKey = synchronized(INITIALIZATION_LOCK) {
    val store = keyStore()
    check(!store.containsAlias(alias)) { "Vault key already exists" }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  fun requireExistingKey(): SecretKey {
    val key = keyStore().getKey(alias, null)
      ?: throw IllegalStateException("Vault key is missing; vault data cannot be opened")
    return key as? SecretKey
      ?: throw IllegalStateException("Vault key is unusable; vault data cannot be opened")
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

  companion object {
    const val DEFAULT_ALIAS = "secret-camera.photo-vault.v1"
    private val INITIALIZATION_LOCK = Any()
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  }
}
