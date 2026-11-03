package expo.modules.photovault

import android.graphics.Bitmap
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

      val roundTrip = File(base, "round-trip.jpg")
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
