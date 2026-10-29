package expo.modules.photovault

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EncryptedPhotoCodecInstrumentedTest {
  @Test
  fun roundTripsWithFreshNoncesAndReopenedKeystoreKey() = withFixture { dir, codec, alias ->
    val synthetic = ByteArray(8192) { (it % 251).toByte() }
    val source = File(dir, "synthetic.jpg").apply { writeBytes(synthetic) }
    val encrypted1 = File(dir, "one.scv")
    val encrypted2 = File(dir, "two.scv")
    val reopenedCodec = EncryptedPhotoCodec(dir, VaultKeyStore(alias))
    codec.encrypt(source.path, encrypted1.path)
    reopenedCodec.encrypt(source.path, encrypted2.path)
    assertTrue(encrypted1.length() == synthetic.size.toLong() + 5 + 12 + 16)
    assertArrayEquals(byteArrayOf(0x53, 0x43, 0x50, 0x48, 0x01), encrypted1.readBytes().copyOfRange(0, 5))
    assertFalse(encrypted1.readBytes().contentEquals(synthetic))
    assertNotEquals(encrypted1.readBytes().copyOfRange(5, 17).toList(), encrypted2.readBytes().copyOfRange(5, 17).toList())
    val restored = File(dir, "restored.jpg")
    reopenedCodec.decrypt(encrypted1.path, restored.path)
    assertArrayEquals(synthetic, restored.readBytes())
  }

  @Test
  fun rejectsTamperingTruncationAndWrongVersionWithoutPlaintextDestination() = withFixture { dir, codec, _ ->
    val source = File(dir, "synthetic.jpg").apply { writeBytes(ByteArray(1024) { it.toByte() }) }
    val original = File(dir, "good.scv")
    codec.encrypt(source.path, original.path)
    val good = original.readBytes()
    val mutations = listOf(
      good.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() },
      good.copyOf().also { it[4] = 2 },
      good.copyOf().also { it[5] = (it[5].toInt() xor 1).toByte() },
      good.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() },
      good.copyOf(good.size - 1),
      good.copyOf(4)
    )
    mutations.forEachIndexed { index, damaged ->
      val input = File(dir, "bad-$index.scv").apply { writeBytes(damaged) }
      val output = File(dir, "plaintext-$index.jpg")
      assertThrows(Exception::class.java) { codec.decrypt(input.path, output.path) }
      assertFalse("failed decrypt published output", output.exists())
      assertTrue("staging file leaked", dir.listFiles()!!.none { it.name.startsWith(".vault-") })
    }
  }

  @Test
  fun refusesOverwriteAndExternalPaths() = withFixture { dir, codec, _ ->
    val source = File(dir, "source.jpg").apply { writeText("synthetic") }
    val destination = File(dir, "dest.scv").apply { writeText("keep") }
    assertThrows(Exception::class.java) { codec.encrypt(source.path, destination.path) }
    assertTrue(destination.readText() == "keep")
    val outside = File(dir.parentFile, "outside-${UUID.randomUUID()}").apply { writeText("synthetic") }
    try {
      assertThrows(Exception::class.java) { codec.encrypt(outside.path, File(dir, "out.scv").path) }
    } finally { outside.delete() }
  }

  @Test
  fun rejectsSymlinksAndOversizedInputsWithoutOutput() = withFixture { dir, codec, _ ->
    val source = File(dir, "source.jpg").apply { writeText("synthetic") }
    val link = File(dir, "linked.jpg")
    android.system.Os.symlink(source.path, link.path)
    val output = File(dir, "out.scv")
    assertThrows(Exception::class.java) { codec.encrypt(link.path, output.path) }
    assertFalse(output.exists())
    val large = File(dir, "large.jpg")
    java.io.RandomAccessFile(large, "rw").use { it.setLength(64L * 1024 * 1024 + 1) }
    assertThrows(Exception::class.java) { codec.encrypt(large.path, output.path) }
    assertFalse(output.exists())
    assertTrue(dir.listFiles()!!.none { it.name.startsWith(".vault-") })
  }

  @Test
  fun missingKeyNeverCreatesReplacementOrPublishesPlaintext() = withFixture { dir, codec, alias ->
    val source = File(dir, "source.jpg").apply { writeText("synthetic") }
    val encrypted = File(dir, "good.scv")
    codec.encrypt(source.path, encrypted.path)
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    store.deleteEntry(alias)
    val restored = File(dir, "restored.jpg")
    assertThrows(Exception::class.java) { codec.decrypt(encrypted.path, restored.path) }
    assertFalse(restored.exists())
    assertFalse(store.containsAlias(alias))
    assertTrue(source.readText() == "synthetic")
  }

  @Test
  fun pinnedDirectoryResistsParentSwapDuringReadAndPublication() = withFixture { dir, codec, alias ->
    val source = File(dir, "source.jpg").apply { writeText("original synthetic bytes") }
    val destination = File(dir, "photo.scv")
    val moved = File(dir.parentFile, "moved-${UUID.randomUUID()}")
    val redirected = File(dir.parentFile, "redirect-${UUID.randomUUID()}").apply { mkdir() }
    File(redirected, source.name).writeText("wrong synthetic bytes")
    val racing = EncryptedPhotoCodec(dir, VaultKeyStore(alias)) {
      check(dir.renameTo(moved))
      android.system.Os.symlink(redirected.path, dir.path)
    }
    try {
      racing.encrypt(source.path, destination.path)
      assertFalse(File(redirected, destination.name).exists())
      assertTrue(File(moved, destination.name).isFile)
      assertTrue(File(redirected, source.name).readText() == "wrong synthetic bytes")
    } finally {
      if (moved.exists()) {
        File(dir.path).delete()
        check(moved.renameTo(dir))
      }
      redirected.deleteRecursively()
    }
    val restored = File(dir, "restored.jpg")
    codec.decrypt(destination.path, restored.path)
    assertTrue(restored.readText() == "original synthetic bytes")
  }

  private fun withFixture(block: (File, EncryptedPhotoCodec, String) -> Unit) {
    val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    val dir = File(context.filesDir, "codec-test-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.codec-test.${UUID.randomUUID()}"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    try {
      VaultKeyStore(alias).initializeNewVault()
      block(dir, EncryptedPhotoCodec(dir, VaultKeyStore(alias)), alias)
    } finally {
      store.deleteEntry(alias)
      dir.deleteRecursively()
    }
  }
}
