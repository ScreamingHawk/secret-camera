package expo.modules.photovault

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test

class CaptureCoordinatorInstrumentedTest {
  @Test fun freshCapturePreparesVaultEncryptsValidatesAndRemovesSource() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val root = File(context.cacheDir, "coordinator-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.coordinator.${UUID.randomUUID()}"
    val keys = VaultKeyStore(alias)
    val marker = File(root, "initialized")
    try {
      val camera = File(root, "camera")
      val gallery = File(root, "gallery")
      val views = File(root, "views")
      val coordinator = CaptureCoordinator(root, camera, gallery, views, keys, marker)
      coordinator.prepareCaptureVault()
      assertTrue(marker.isFile)
      assertTrue(camera.isDirectory && gallery.isDirectory)
      assertFalse(views.exists())
      val bytes = ByteArray(1024) { (it % 173).toByte() }
      val source = File(camera, "fresh.jpg").apply { writeBytes(bytes) }
      val saved = coordinator.save(source)
      assertTrue(saved.sourceRemoved)
      assertFalse(source.exists())
      val view = EncryptedPhotoCodec(gallery, keys, trustedOutputDir = views).prepareView(saved.filename)
      assertArrayEquals(bytes, view.readBytes())
      view.delete()
      assertFalse(File(gallery, saved.filename).readBytes().contentEquals(bytes))
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      root.deleteRecursively()
    }
  }

  @Test fun markerWithLostKeyRefusesEvenWhenGalleryIsEmpty() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val root = File(context.cacheDir, "lost-key-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.lost.${UUID.randomUUID()}"
    val marker = File(root, "initialized").apply { writeText("initialized") }
    try {
      val gallery = File(root, "gallery").apply { mkdir() }
      val coordinator = CaptureCoordinator(root, File(root, "camera"), gallery, File(root, "views"), VaultKeyStore(alias), marker)
      assertTrue(gallery.listFiles()!!.isEmpty())
      assertThrows(IllegalStateException::class.java) { coordinator.prepareCaptureVault() }
      assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(alias))
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      root.deleteRecursively()
    }
  }

  @Test fun invalidCaptureRetainsOnlyOriginalPlaintextAndRemovesFailedCiphertext() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val root = File(context.cacheDir, "invalid-capture-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.invalid.${UUID.randomUUID()}"
    val keys = VaultKeyStore(alias)
    try {
      val camera = File(root, "camera")
      val gallery = File(root, "gallery")
      val views = File(root, "views")
      val coordinator = CaptureCoordinator(root, camera, gallery, views, keys, File(root, "initialized"), codecFactory = { input, output ->
        if (input == gallery) EncryptedPhotoCodec(input, keys, trustedOutputDir = output, afterPathValidation = {
          val encrypted = input.listFiles()!!.single { it.name.endsWith(".scv") }
          val bytes = encrypted.readBytes()
          bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
          encrypted.writeBytes(bytes)
        }) else EncryptedPhotoCodec(input, keys, trustedOutputDir = output)
      })
      coordinator.prepareCaptureVault()
      val source = File(camera, "invalid.jpg").apply { writeBytes(ByteArray(50) { 1 }) }
      assertThrows(Exception::class.java) { coordinator.save(source) }
      assertTrue(source.isFile)
      assertEquals(listOf(source), camera.listFiles()!!.toList())
      assertTrue(gallery.listFiles()!!.isEmpty())
      assertTrue(views.listFiles()!!.isEmpty())
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      root.deleteRecursively()
    }
  }

  @Test fun legacyJpegAloneAllowsFirstVaultButEncryptedEntryRequiresExistingKey() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val root = File(context.cacheDir, "legacy-admission-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.legacy.${UUID.randomUUID()}"
    try {
      val gallery = File(root, "gallery").apply { mkdir() }
      val legacy = File(gallery, "old.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
      val marker = File(root, "initialized")
      val coordinator = CaptureCoordinator(root, File(root, "camera"), gallery, File(root, "views"), VaultKeyStore(alias), marker)
      coordinator.prepareCaptureVault()
      assertTrue(marker.isFile)
      assertTrue(legacy.readBytes().contentEquals(byteArrayOf(1, 2, 3)))
      val encryptedRoot = File(context.cacheDir, "encrypted-admission-${UUID.randomUUID()}").apply { mkdir() }
      val encryptedAlias = "secret-camera.encrypted-missing.${UUID.randomUUID()}"
      try {
        val encryptedGallery = File(encryptedRoot, "gallery").apply { mkdir() }
        File(encryptedGallery, "old.jpg").writeBytes(byteArrayOf(4))
        File(encryptedGallery, "existing.scv").writeBytes(byteArrayOf(1))
        val missingKey = CaptureCoordinator(encryptedRoot, File(encryptedRoot, "camera"), encryptedGallery, File(encryptedRoot, "views"), VaultKeyStore(encryptedAlias), File(encryptedRoot, "initialized"))
        assertThrows(IllegalStateException::class.java) { missingKey.prepareCaptureVault() }
        assertFalse(File(encryptedRoot, "initialized").exists())
        assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(encryptedAlias))
      } finally {
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(encryptedAlias) }
        encryptedRoot.deleteRecursively()
      }
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      root.deleteRecursively()
    }
  }

  @Test fun committedCaptureReportsSourceCleanupFailureWithoutRetryingEncryption() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val root = File(context.cacheDir, "cleanup-failure-${UUID.randomUUID()}").apply { mkdir() }
    val alias = "secret-camera.cleanup.${UUID.randomUUID()}"
    val keys = VaultKeyStore(alias)
    try {
      val camera = File(root, "camera")
      val gallery = File(root, "gallery")
      val views = File(root, "views")
      val coordinator = CaptureCoordinator(root, camera, gallery, views, keys, File(root, "initialized"), removeSource = { false })
      coordinator.prepareCaptureVault()
      val source = File(camera, "recoverable.jpg").apply { writeBytes(ByteArray(96) { it.toByte() }) }
      val saved = coordinator.save(source)
      assertFalse(saved.sourceRemoved)
      assertTrue(source.isFile)
      assertTrue(File(gallery, saved.filename).isFile)
      assertEquals(1, gallery.listFiles()!!.count { it.name.endsWith(".scv") })
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      root.deleteRecursively()
    }
  }

  @Test fun initializeNewVaultRemainsStrictWhenAliasAlreadyExists() {
    val alias = "secret-camera.strict.${UUID.randomUUID()}"
    try {
      VaultKeyStore(alias).initializeNewVault()
      assertThrows(IllegalStateException::class.java) { VaultKeyStore(alias).initializeNewVault() }
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }
  }
}
