package expo.modules.photovault

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.SecretKey
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VaultKeyStoreInstrumentedTest {
  @Test
  fun initializationRefusesExistingAliasAndPreservesOriginalKey() {
    val alias = "secret-camera.test.${java.util.UUID.randomUUID()}"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    try {
      val creator = VaultKeyStore(alias)
      val original = creator.initializeNewVault()
      assertNull("encoded key must not be exportable", original.encoded)
      assertThrows(IllegalStateException::class.java) { VaultKeyStore(alias).initializeNewVault() }

      val reopened = VaultKeyStore(alias).requireExistingKey()
      val plaintext = "synthetic vault test bytes".toByteArray(Charsets.UTF_8)
      val encrypt = Cipher.getInstance("AES/GCM/NoPadding")
      encrypt.init(Cipher.ENCRYPT_MODE, original)
      val ciphertext = encrypt.doFinal(plaintext)
      val decrypt = Cipher.getInstance("AES/GCM/NoPadding")
      decrypt.init(Cipher.DECRYPT_MODE, reopened, javax.crypto.spec.GCMParameterSpec(128, encrypt.iv))
      assertArrayEquals(plaintext, decrypt.doFinal(ciphertext))
      assertFalse("test alias remains in AndroidKeyStore", store.getKey(alias, null) == null)
    } finally {
      store.deleteEntry(alias)
    }
  }

  @Test
  fun missingExistingKeyFailsWithoutCreatingReplacement() {
    val alias = "secret-camera.test.${java.util.UUID.randomUUID()}"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    try {
      val error = assertThrows(IllegalStateException::class.java) {
        VaultKeyStore(alias).requireExistingKey()
      }
      org.junit.Assert.assertTrue(error.message.orEmpty().contains("missing"))
      assertFalse(store.containsAlias(alias))
    } finally {
      store.deleteEntry(alias)
    }
  }
}
