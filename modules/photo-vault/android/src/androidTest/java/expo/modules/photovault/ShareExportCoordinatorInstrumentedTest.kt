package expo.modules.photovault

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ShareExportCoordinatorInstrumentedTest {
  @Test
  fun authenticatedJpegExportUsesCoordinatorLeasesRetentionAndRestartState() = withFixture { base, alias ->
    val gallery = File(base, "gallery").apply { mkdir() }
    val exports = File(base, "exports").apply { mkdir() }
    val jpeg = Bitmap.createBitmap(7, 5, Bitmap.Config.ARGB_8888)
    val original = ByteArrayOutputStream().also { jpeg.compress(Bitmap.CompressFormat.JPEG, 92, it) }.toByteArray()
    val plain = File(base, "synthetic.jpg").apply { writeBytes(original) }
    val encrypted = File(gallery, "selected.scv")
    EncryptedPhotoCodec(base, VaultKeyStore(alias), trustedOutputDir = gallery).encrypt(plain.path, encrypted.path)
    val codec = EncryptedPhotoCodec(gallery, VaultKeyStore(alias), trustedOutputDir = exports)
    var now = 10_000L
    val coordinator = ShareExportCoordinator(exports, { now }, RETENTION)
    val share = coordinator.prepare { codec.prepareShare(encrypted.name) }
    assertTrue(share.name.matches(Regex("share-[0-9a-f-]{36}\\.jpg")))
    assertArrayEquals(original, share.readBytes())
    assertEquals(7, BitmapFactory.decodeFile(share.path).width)
    assertTrue(encrypted.isFile)

    coordinator.begin(share)
    now += RETENTION + 1
    coordinator.cleanup(now)
    assertTrue("active receiver lease must survive cleanup", share.isFile)
    assertThrows(IllegalArgumentException::class.java) { coordinator.abandon(share) }
    coordinator.finish(share)
    coordinator.cleanup(now)
    assertTrue("finish must renew retention", share.isFile)

    now += RETENTION + 1
    val restarted = ShareExportCoordinator(exports, { now }, RETENTION)
    restarted.cleanup(now)
    assertFalse("expired persisted export must be removed after restart", share.exists())
  }

  @Test
  fun persistedExpirySurvivesRestartAndCorruptOrMissingSidecarGetsSafeFallback() = withFixture { base, _ ->
    val root = File(base, "exports").apply { mkdir() }
    var now = 50_000L
    val first = ShareExportCoordinator(root, { now }, RETENTION)
    val persisted = first.prepare { newExport(root) }
    now += RETENTION - 1
    ShareExportCoordinator(root, { now }, RETENTION).cleanup(now)
    assertTrue(persisted.exists())
    now += 2
    ShareExportCoordinator(root, { now }, RETENTION).cleanup(now)
    assertFalse(persisted.exists())

    val missing = newExport(root).apply { setLastModified(now - RETENTION * 10) }
    val freshExpiry = now + RETENTION
    ShareExportCoordinator(root, { now }, RETENTION).cleanup(now)
    assertTrue("missing metadata must not trigger immediate deletion", missing.exists())
    assertTrue(File(root, missing.name + ".expiry").readText().toLong() >= freshExpiry)
    now += RETENTION + 1
    ShareExportCoordinator(root, { now }, RETENTION).cleanup(now)
    assertFalse(missing.exists())

    val corrupt = newExport(root).apply { setLastModified(now - RETENTION * 10) }
    File(root, corrupt.name + ".expiry").writeText("not-an-expiry")
    ShareExportCoordinator(root, { now }, RETENTION).cleanup(now)
    assertTrue("corrupt metadata must receive a fresh fallback", corrupt.exists())
    assertTrue(File(root, corrupt.name + ".expiry").readText().toLong() >= now + RETENTION)
    now += RETENTION + 1
    ShareExportCoordinator(root, { now }, RETENTION).cleanup(now)
    assertFalse(corrupt.exists())
  }

  @Test
  fun abandonsOnlyUnhandedOwnedExportsAndIsIdempotent() = withFixture { base, _ ->
    val root = File(base, "exports").apply { mkdir() }
    val coordinator = ShareExportCoordinator(root, { 100L }, RETENTION)
    val export = coordinator.prepare { newExport(root) }
    coordinator.abandon(export)
    coordinator.abandon(export)
    assertFalse(export.exists())
    assertFalse(File(root, export.name + ".expiry").exists())

    val active = coordinator.prepare { newExport(root) }
    coordinator.begin(active)
    assertThrows(IllegalArgumentException::class.java) { coordinator.abandon(active) }
    coordinator.finish(active)

    val outside = File(base, "share-${UUID.randomUUID()}.jpg").apply { writeBytes(byteArrayOf(1)) }
    assertThrows(IllegalArgumentException::class.java) { coordinator.abandon(outside) }
    val target = File(root, "target-${UUID.randomUUID()}").apply { writeBytes(byteArrayOf(2)) }
    val link = File(root, "share-${UUID.randomUUID()}.jpg")
    android.system.Os.symlink(target.path, link.path)
    assertThrows(IllegalArgumentException::class.java) { coordinator.begin(link) }
    assertThrows(IllegalArgumentException::class.java) { coordinator.abandon(link) }
    assertEquals(byteArrayOf(2).toList(), target.readBytes().toList())
    outside.delete()
  }

  @Test
  fun authenticationFailureAndKeyLossNeverPublishShareExport() = withFixture { base, alias ->
    val gallery = File(base, "gallery").apply { mkdir() }
    val exports = File(base, "exports").apply { mkdir() }
    val source = File(base, "synthetic.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    val encrypted = File(gallery, "photo.scv")
    val codec = EncryptedPhotoCodec(base, VaultKeyStore(alias), trustedOutputDir = gallery)
    codec.encrypt(source.path, encrypted.path)
    val exportCodec = EncryptedPhotoCodec(gallery, VaultKeyStore(alias), trustedOutputDir = exports)
    val coordinator = ShareExportCoordinator(exports, { 1_000L }, RETENTION)
    encrypted.writeBytes(encrypted.readBytes().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() })
    assertThrows(Exception::class.java) { coordinator.prepare { exportCodec.prepareShare(encrypted.name) } }
    assertTrue(exports.listFiles()!!.isEmpty())

    encrypted.writeBytes(ByteArray(0))
    codec.encrypt(source.path, encrypted.path)
    KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    assertThrows(Exception::class.java) { coordinator.prepare { exportCodec.prepareShare(encrypted.name) } }
    assertTrue("key loss must not publish plaintext", exports.listFiles()!!.isEmpty())
  }

  private fun newExport(root: File): File = File(root, "share-${UUID.randomUUID()}.jpg").apply { writeBytes(byteArrayOf(7)) }

  private fun withFixture(block: (File, String) -> Unit) {
    val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    val base = File(context.filesDir, "share-coordinator-test-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.share-test.${UUID.randomUUID()}"
    try {
      VaultKeyStore(alias).initializeNewVault()
      block(base, alias)
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      base.deleteRecursively()
    }
  }

  companion object { private const val RETENTION = 60L * 60 * 1000 }
}
