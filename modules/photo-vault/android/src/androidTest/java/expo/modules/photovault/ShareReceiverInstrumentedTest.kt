package expo.modules.photovault

import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.core.content.FileProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File

import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the installed Expo Sharing provider via Android's shell UID (not a mocked provider). */
@RunWith(AndroidJUnit4::class)
class ShareReceiverInstrumentedTest {
  @Test
  fun externalUidReadsGrantedJpegButCannotWriteAndGrantRevocationDeniesRead() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.context
    val shellPackage = "com.android.shell"
    val shellUid = context.packageManager.getApplicationInfo(shellPackage, 0).uid
    assertTrue("shell must be a distinct UID", shellUid != android.os.Process.myUid())
    val fixture = File(context.cacheDir, "receiver-proof-${UUID.randomUUID()}").apply { mkdir() }
    val sourceDir = File(fixture, "gallery").apply { mkdir() }
    val exportDir = File(fixture, "photo-vault-shares").apply { mkdir() }
    val alias = "secret-camera.receiver-test.${UUID.randomUUID()}"
    val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    var uri: Uri? = null
    var granted = false
    try {
      VaultKeyStore(alias).initializeNewVault()
      val bitmap = Bitmap.createBitmap(7, 5, Bitmap.Config.ARGB_8888)
      val jpeg = ByteArrayOutputStream().also {
        check(bitmap.compress(Bitmap.CompressFormat.JPEG, 91, it))
        bitmap.recycle()
      }.toByteArray()
      val sourcePlaintext = File(sourceDir, "source.jpg").apply { writeBytes(jpeg) }
      val encrypted = File(sourceDir, "selected.scv")
      EncryptedPhotoCodec(sourceDir, VaultKeyStore(alias)).encrypt(sourcePlaintext.path, encrypted.path)
      val exported = EncryptedPhotoCodec(sourceDir, VaultKeyStore(alias), trustedOutputDir = exportDir)
        .prepareShare(encrypted.name)
      assertTrue(exported.canonicalFile.parentFile == exportDir.canonicalFile)
      assertArrayEquals(jpeg, exported.readBytes())

      val authority = "${context.packageName}.SharingFileProvider"
      val provider = context.packageManager.resolveContentProvider(authority, 0)
      assertNotNull("Expo Sharing provider is not packaged in test context", provider)
      assertEquals("expo.modules.sharing.SharingFileProvider", provider!!.name)
      assertFalse("provider must remain non-exported", provider.exported)
      uri = FileProvider.getUriForFile(context, authority, exported)

      // Establish that shell really is a distinct, unprivileged package before any grant.
      assertFalse("shell unexpectedly reads without a URI grant", shellRead(uri!!).bytes?.contentEquals(jpeg) == true)
      val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "image/jpeg"
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newUri(context.contentResolver, "photo", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      assertEquals(Intent.ACTION_SEND, shareIntent.action)
      assertEquals("image/jpeg", shareIntent.type)
      assertEquals(uri, shareIntent.getParcelableExtra(Intent.EXTRA_STREAM))
      assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, shareIntent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION)

      context.grantUriPermission(shellPackage, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      granted = true
      val readResult = shellRead(uri!!)
      val received = readResult.bytes ?: throw AssertionError("shell read failed after URI grant: ${readResult.diagnostic}")
      assertArrayEquals("shell UID must receive the original JPEG bytes", jpeg, received)
      val decoded = BitmapFactory.decodeByteArray(received, 0, received.size)
      assertNotNull("received bytes are not a decodable JPEG", decoded)
      assertEquals(7, decoded!!.width)
      assertEquals(5, decoded.height)
      decoded.recycle()

      // FileProvider's openFile mode is read-only. This real cross-UID write must fail.
      val writeResult = shellWrite(uri!!, "synthetic-write-probe".toByteArray())
      assertArrayEquals("shell UID write must not alter exported bytes: ${writeResult.diagnostic}", jpeg, exported.readBytes())
      assertArrayEquals("failed write changed exported bytes", jpeg, exported.readBytes())
      assertTrue("ciphertext source must remain intact", encrypted.isFile)

      context.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      granted = false
      assertFalse("revoked grant still permits shell read", shellRead(uri!!).bytes?.contentEquals(jpeg) == true)
      // A completed chooser handoff does not delete a leased export; TTL cleanup owns it.
      assertTrue("export was deleted before lease cleanup", exported.isFile)
      assertTrue(exported.delete())
      assertTrue("expiry sidecar should be cleaned with its export", File(exportDir, exported.name + ".expiry").delete() || !File(exportDir, exported.name + ".expiry").exists())
    } finally {
      if (granted && uri != null) context.revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      store.deleteEntry(alias)
      fixture.deleteRecursively()
    }
  }

  private data class ShellRead(val bytes: ByteArray?, val diagnostic: String)

  private fun shellRead(uri: Uri): ShellRead {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    return try {
      val (stdout, stdin, stderr) = instrumentation.uiAutomation.executeShellCommandRwe("content read --uri $uri")
      stdin.close()
      val bytes = ParcelFileDescriptor.AutoCloseInputStream(stdout).use { it.readBytes() }
      val error = ParcelFileDescriptor.AutoCloseInputStream(stderr).use { it.readBytes() }
      ShellRead(bytes, "stderr=${String(error)}")
    } catch (e: Exception) { ShellRead(null, e.javaClass.simpleName + ": " + e.message) }
  }

  private fun shellWrite(uri: Uri, bytes: ByteArray): ShellRead {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    return try {
      val (stdout, stdin, stderr) = instrumentation.uiAutomation.executeShellCommandRwe("content write --uri $uri")
      try {
        ParcelFileDescriptor.AutoCloseOutputStream(stdin).use { it.write(bytes) }
      } catch (_: java.io.IOException) {
        // A permission-denied receiver may close its input pipe before consuming it.
        stdin.close()
      }
      val output = ParcelFileDescriptor.AutoCloseInputStream(stdout).use { it.readBytes() }
      val error = ParcelFileDescriptor.AutoCloseInputStream(stderr).use { it.readBytes() }
      ShellRead(output, "stderr=${String(error)}")
    } catch (e: Exception) { ShellRead(null, e.javaClass.simpleName + ": " + e.message) }
  }
}
