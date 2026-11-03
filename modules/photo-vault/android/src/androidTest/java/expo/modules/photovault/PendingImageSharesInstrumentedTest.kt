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
        val leaf = "photo-share-${received.id}.jpg"
        codec.importImage(temp.path, leaf, encrypted = false)
        codec.importImage(temp.path, leaf, encrypted = false)
        assertArrayEquals(bytes, File(gallery, leaf).readBytes())
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
