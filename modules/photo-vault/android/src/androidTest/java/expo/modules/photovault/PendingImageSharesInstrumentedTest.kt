package expo.modules.photovault

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PendingImageSharesInstrumentedTest {
  @Test fun transparentPngPickerBytesKeepMimeStorageViewAndShareFormat() {
    val base = File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "png-import-${UUID.randomUUID()}").apply { mkdirs() }
    val appCache = File(base, "cache").apply { mkdirs() }
    val pickerCache = File(appCache, "ImagePicker").apply { mkdirs() }
    val privateFiles = File(base, "files").apply { mkdirs() }
    val gallery = File(privateFiles, ".secret-camera").apply { mkdirs() }
    val viewDir = File(base, "views").apply { mkdirs() }
    val shareDir = File(base, "shares").apply { mkdirs() }
    val bitmap = Bitmap.createBitmap(3, 2, Bitmap.Config.ARGB_8888).apply {
      setPixel(0, 0, 0x00112233)
      setPixel(1, 0, 0x80445566.toInt())
    }
    val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it); bitmap.recycle() }.toByteArray()
    val incoming = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
      type = "image/png"
      putExtra(android.content.Intent.EXTRA_STREAM, Uri.parse("content://synthetic.share/png"))
    }
    val shared = PendingImageShares(File(privateFiles, ".share-pending"), { "image/png" }, { ByteArrayInputStream(bytes) })
      .receive(incoming).single()
    assertEquals("image/png", shared.mimeType)
    assertTrue(shared.uri.endsWith(".png"))
    val pickerFile = File(pickerCache, "${UUID.randomUUID()}.png").apply { writeBytes(bytes) }
    val pendingDir = File(privateFiles, ".secret-camera-pending")
    val pending = PendingImageShares(pendingDir, { null }, { null })
    val alias = "secret-camera.png-import.${UUID.randomUUID()}"
    try {
      val staged = pending.stagePickerImageFile(Uri.fromFile(pickerFile), appCache)
      assertEquals("image/png", staged.mimeType)
      assertTrue(staged.uri.endsWith(".png"))
      val source = File(privateFiles, ".png-import-${staged.id}.tmp").apply {
        File(java.net.URI(staged.uri)).copyTo(this)
      }
      assertArrayEquals(bytes, source.readBytes())
      VaultKeyStore(alias).initializeNewVault()
      val galleryCodec = EncryptedPhotoCodec(privateFiles, VaultKeyStore(alias), trustedOutputDir = gallery)
      val encryptedTarget = selectPendingImageImportTarget(gallery, staged.id, true, staged.mimeType)
      assertEquals("photo-share-${staged.id}.png.scv", encryptedTarget.filename)
      galleryCodec.importImage(source.path, encryptedTarget.filename, encryptedTarget.encrypted)
      val viewCodec = EncryptedPhotoCodec(gallery, VaultKeyStore(alias), trustedOutputDir = viewDir)
      val view = viewCodec.prepareView(encryptedTarget.filename)
      assertTrue(view.name.endsWith(".png"))
      assertArrayEquals(bytes, view.readBytes())
      assertEquals(0, BitmapFactory.decodeFile(view.path).getPixel(0, 0) ushr 24)
      viewCodec.releaseView(view.name)
      val exports = ShareExportCoordinator(shareDir)
      val shareCodec = EncryptedPhotoCodec(gallery, VaultKeyStore(alias), trustedOutputDir = shareDir)
      val share = exports.prepare { shareCodec.prepareShare(encryptedTarget.filename) }
      assertTrue(share.name.endsWith(".png"))
      assertArrayEquals(bytes, share.readBytes())
      exports.abandon(share)
      assertFalse(share.exists())
      val conversionCodec = EncryptedPhotoCodec(gallery, VaultKeyStore(alias))
      val decryptedName = conversionCodec.decryptGalleryFile(encryptedTarget.filename)
      assertTrue(decryptedName.endsWith(".png"))
      assertArrayEquals(bytes, File(gallery, decryptedName).readBytes())
      val reencryptedName = conversionCodec.migrateLegacyFile(decryptedName)
      assertTrue(reencryptedName.endsWith(".png.scv"))
      val convertedView = viewCodec.prepareView(reencryptedName)
      assertArrayEquals(bytes, convertedView.readBytes())
      viewCodec.releaseView(convertedView.name)
      val plainTarget = selectPendingImageImportTarget(gallery, UUID.randomUUID().toString(), false, staged.mimeType)
      assertEquals(".png", plainTarget.filename.takeLast(4))
      galleryCodec.importImage(source.path, plainTarget.filename, false)
      assertArrayEquals(bytes, File(gallery, plainTarget.filename).readBytes())
    } finally {
      java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      base.deleteRecursively()
    }
  }

  @Test fun pickerFileAdmissionCopiesOnlyUuidJpegFromExpoImagePickerCache() {
    val base = File(
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
      "picker-cache-admission-${UUID.randomUUID()}"
    ).apply { mkdirs() }
    val appCache = File(base, "cache").apply { mkdirs() }
    val pickerCache = File(appCache, "ImagePicker").apply { mkdirs() }
    val privateFiles = File(base, "files").apply { mkdirs() }
    val pendingDir = File(privateFiles, ".secret-camera-pending")
    val bitmap = Bitmap.createBitmap(4, 3, Bitmap.Config.ARGB_8888)
    val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 96, it); bitmap.recycle() }.toByteArray()
    val original = File(base, "original.jpg").apply { writeBytes(bytes) }
    val image = File(pickerCache, "${UUID.randomUUID()}.jpeg").apply { writeBytes(original.readBytes()) }
    val coordinator = PendingImageShares(pendingDir, { null }, { null })
    try {
      val pending = coordinator.stagePickerImageFile(Uri.fromFile(image), appCache)
      assertArrayEquals(bytes, File(java.net.URI(pending.uri)).readBytes())
      assertArrayEquals(bytes, original.readBytes())
      assertFalse("owned picker cache copy should be removed", image.exists())
      assertEquals(1, coordinator.list().size)
      assertThrows(IllegalArgumentException::class.java) {
        coordinator.stagePickerImageFile(Uri.fromFile(original), appCache)
      }
      assertArrayEquals(bytes, original.readBytes())
      val corrupt = File(pickerCache, "${UUID.randomUUID()}.png").apply { writeBytes(byteArrayOf(1, 2, 3)) }
      assertThrows(IllegalArgumentException::class.java) {
        coordinator.stagePickerImageFile(Uri.fromFile(corrupt), appCache)
      }
      assertFalse("rejected owned cache copy should be removed", corrupt.exists())
      assertEquals(1, coordinator.list().size)
    } finally { base.deleteRecursively() }
  }

  @Test fun encryptedImportRoundTripsIsIdempotentAndRejectsMismatchedRetryWithoutChangingSources() {
    val bitmap = Bitmap.createBitmap(5, 4, Bitmap.Config.ARGB_8888)
    val original = ByteArrayOutputStream().also {
      bitmap.compress(Bitmap.CompressFormat.JPEG, 93, it)
      bitmap.recycle()
    }.toByteArray()
    val differentBitmap = Bitmap.createBitmap(4, 5, Bitmap.Config.ARGB_8888)
    val mismatchBytes = ByteArrayOutputStream().also {
      differentBitmap.compress(Bitmap.CompressFormat.JPEG, 91, it)
      differentBitmap.recycle()
    }.toByteArray()
    val base = File(
      androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,
      "pending-encrypted-import-${UUID.randomUUID()}"
    ).apply { mkdirs() }
    val gallery = File(base, "gallery").apply { mkdirs() }
    val source = File(base, "staged.jpg").apply { writeBytes(original) }
    val mismatch = File(base, "mismatch.jpg").apply { writeBytes(mismatchBytes) }
    val alias = "secret-camera.pending-import-test.${UUID.randomUUID()}"
    try {
      VaultKeyStore(alias).initializeNewVault()
      val codec = EncryptedPhotoCodec(base, VaultKeyStore(alias), trustedOutputDir = gallery)
      val leaf = "photo-share-${UUID.randomUUID()}.scv"
      codec.importImage(source.path, leaf, encrypted = true)
      val encrypted = File(gallery, leaf)
      val ciphertext = encrypted.readBytes()
      assertFalse(ciphertext.contentEquals(original))
      codec.importImage(source.path, leaf, encrypted = true)
      assertArrayEquals(ciphertext, encrypted.readBytes())

      val roundTrip = File(gallery, "round-trip.jpg")
      EncryptedPhotoCodec(gallery, VaultKeyStore(alias)).decrypt(encrypted.path, roundTrip.path)
      assertArrayEquals(original, roundTrip.readBytes())

      assertThrows(Exception::class.java) {
        codec.importImage(mismatch.path, leaf, encrypted = true)
      }
      assertArrayEquals(ciphertext, encrypted.readBytes())
      assertArrayEquals(original, source.readBytes())
      assertArrayEquals(mismatchBytes, mismatch.readBytes())
    } finally {
      java.security.KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
        deleteEntry(alias)
      }
      base.deleteRecursively()
    }
  }

  @Test fun syntheticJpegStagesOnceAcrossCoordinatorRecreationAndAcknowledgesWithoutChangingOriginal() {
    val bitmap = Bitmap.createBitmap(4, 3, Bitmap.Config.ARGB_8888)
    val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 94, it); bitmap.recycle() }.toByteArray()
    val source = bytes.copyOf()
    val seen = mutableSetOf<String>()
    val root = File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "pending-test-${UUID.randomUUID()}")
    try {
      fun coordinator() = PendingImageShares(root, { "image/jpeg" }, {
        object : ByteArrayInputStream(source) {
          override fun read(buffer: ByteArray, offset: Int, length: Int): Int = super.read(buffer, offset, minOf(length, 1))
        }
      }, { it in seen }, { seen.add(it) })
      val receiver = coordinator()
      val incoming = android.content.Intent(android.content.Intent.ACTION_SEND).apply { type = "image/jpeg"; putExtra(android.content.Intent.EXTRA_STREAM, Uri.parse("content://synthetic.share/image")) }
      val received = receiver.receive(incoming).single()
      assertArrayEquals(bytes, File(java.net.URI(received.uri)).readBytes())
      assertTrue(receiver.receive(incoming).isEmpty())
      assertTrue("same delivered intent must dedupe after module recreation", coordinator().receive(incoming).isEmpty())
      assertEquals(received.id, coordinator().list().single().id)
      assertNotNull(coordinator().consume(received.id))

      val gallery = File(root.parentFile, "gallery-${UUID.randomUUID()}").apply { mkdirs() }
      val temp = File(root.parentFile, "import-${UUID.randomUUID()}.jpg")
      try {
        File(java.net.URI(received.uri)).copyTo(temp, overwrite = false)
        val codec = EncryptedPhotoCodec(root.parentFile, VaultKeyStore("pending-import-test-${UUID.randomUUID()}"), trustedOutputDir = gallery)
        val attempted = selectPendingImageImportTarget(gallery, received.id, requestedEncrypted = true)
        assertTrue(attempted.encrypted)
        // Simulate failure before publication, then retry after the saved setting changes.
        val retry = selectPendingImageImportTarget(gallery, received.id, requestedEncrypted = false)
        assertFalse(retry.encrypted)
        assertEquals("photo-share-${received.id}.jpg", retry.filename)
        codec.importImage(temp.path, retry.filename, encrypted = retry.encrypted)
        val afterCommit = selectPendingImageImportTarget(gallery, received.id, requestedEncrypted = true)
        assertFalse(afterCommit.encrypted)
        assertEquals(retry, afterCommit)
        codec.importImage(temp.path, afterCommit.filename, encrypted = afterCommit.encrypted)
        assertArrayEquals(bytes, File(gallery, afterCommit.filename).readBytes())
        assertEquals(1, gallery.listFiles()!!.size)
      } finally {
        temp.delete()
        gallery.deleteRecursively()
      }
      receiver.acknowledge(received.id)
      assertTrue(receiver.list().isEmpty())
      assertArrayEquals(bytes, source)
    } finally { root.deleteRecursively() }
  }
}
