package expo.modules.photovault

import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LegacyPhotoMigratorInstrumentedTest {
  @Test fun migrationLeavesEncryptedAndNonJpegEntriesAlone() = fixture { dir, alias ->
    val legacy = File(dir, "legacy.jpeg").apply { writeBytes(ByteArray(96) { it.toByte() }) }
    val encryptedPlain = File(dir, "plain.jpg").apply { writeBytes(byteArrayOf(1, 2, 3)) }
    val encrypted = File(dir, "already.scv")
    EncryptedPhotoCodec(dir, VaultKeyStore(alias)).encrypt(encryptedPlain.path, encrypted.path)
    encryptedPlain.delete()
    File(dir, "cover.json").writeText("synthetic metadata")
    val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    val root = File(context.cacheDir, "migration-root-${UUID.randomUUID()}").apply { mkdirs() }
    try {
      val capture = CaptureCoordinator(root, File(root, "camera"), dir, File(root, "views"), VaultKeyStore(alias))
      val result = LegacyPhotoMigrator(dir, capture) { EncryptedPhotoCodec(dir, VaultKeyStore(alias), trustedOutputDir = dir) }.migrate()
      assertEquals(1, result.migrated)
      assertFalse(legacy.exists())
      assertTrue(encrypted.exists())
      assertTrue(File(dir, "cover.json").exists())
    } finally { root.deleteRecursively() }
  }

  @Test fun successAndRepeatAreVerifiedAndIdempotent() = fixture { dir, alias ->
    val bytes = ByteArray(4096) { ((it * 31) % 251).toByte() }
    val source = File(dir, "holiday-é-📷.jpg").apply { writeBytes(bytes) }
    val codec = EncryptedPhotoCodec(dir, VaultKeyStore(alias))
    val target = codec.migrateLegacyFile(source.name)
    assertFalse(source.exists())
    val restored = File(dir, "restored.jpg")
    codec.decrypt(File(dir, target).path, restored.path)
    assertArrayEquals(bytes, restored.readBytes())
    val snapshot = File(dir, target).readBytes()
    assertThrows(IllegalArgumentException::class.java) {
      EncryptedPhotoCodec(dir, VaultKeyStore(alias)).migrateLegacyFile(source.name)
    }
    assertArrayEquals(snapshot, File(dir, target).readBytes())
  }

  @Test fun interruptionRetainsSourceAndResumeReusesSingleCipher() = fixture { dir, alias ->
    val source = File(dir, "resume.jpg").apply { writeBytes(ByteArray(800) { it.toByte() }) }
    val bytes = source.readBytes()
    val codec = EncryptedPhotoCodec(dir, VaultKeyStore(alias))
    val targetName = deterministic(source.name)
    assertThrows(IllegalStateException::class.java) {
      codec.migrateLegacyFile(source.name) { throw IllegalStateException("synthetic interruption") }
    }
    assertArrayEquals(bytes, source.readBytes())
    assertTrue(File(dir, targetName).exists())
    assertEquals(targetName, EncryptedPhotoCodec(dir, VaultKeyStore(alias)).migrateLegacyFile(source.name))
    assertFalse(source.exists())
    assertEquals(1, dir.listFiles()!!.count { it.name == targetName })
  }

  @Test fun mismatchAndKeyLossNeverRemoveOriginal() = fixture { dir, alias ->
    val source = File(dir, "failure.jpg").apply { writeBytes(ByteArray(200) { (it + 1).toByte() }) }
    val original = source.readBytes()
    val target = deterministic(source.name)
    File(dir, target).writeBytes(ByteArray(40) { 7 })
    assertThrows(Exception::class.java) { EncryptedPhotoCodec(dir, VaultKeyStore(alias)).migrateLegacyFile(source.name) }
    assertArrayEquals(original, source.readBytes())
    val mismatched = File(dir, target).readBytes()
    assertThrows(Exception::class.java) { EncryptedPhotoCodec(dir, VaultKeyStore(alias)).migrateLegacyFile(source.name) }
    assertArrayEquals(mismatched, File(dir, target).readBytes())

    File(dir, target).delete()
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    assertFalse(store.containsAlias(alias))
    assertThrows(Exception::class.java) { EncryptedPhotoCodec(dir, VaultKeyStore(alias)).migrateLegacyFile(source.name) }
    assertArrayEquals(original, source.readBytes())
    assertFalse(File(dir, target).exists())
  }

  @Test fun coordinatorCountsEligibleFilesAndIgnoresSymlinkDirectoryAndMetadata() = fixture { dir, alias ->
    File(dir, "real.jpg").writeBytes(byteArrayOf(1, 2))
    File(dir, "fake.jpg").mkdir()
    File(dir, "info.json").writeText("metadata")
    val outside = File(dir.parentFile, "outside-${UUID.randomUUID()}.jpg").apply { writeBytes(byteArrayOf(3)) }
    val link = File(dir, "linked.jpg")
    try {
      android.system.Os.symlink(outside.path, link.path)
      val root = migrationRoot()
      try {
        val result = LegacyPhotoMigrator(dir, capture(root, alias)) { EncryptedPhotoCodec(dir, VaultKeyStore(alias)) }.migrate()
        assertEquals(1, result.migrated); assertEquals(0, result.remaining); assertEquals(0, result.failed)
        assertTrue(File(dir, "fake.jpg").isDirectory); assertTrue(link.exists()); assertTrue(outside.exists()); assertTrue(File(dir, "info.json").exists())
      } finally { root.deleteRecursively() }
    } finally { outside.delete() }
  }

  @Test fun coordinatorRepeatIsNoop() = fixture { dir, alias ->
    File(dir, "one.jpeg").writeBytes(byteArrayOf(1, 2))
    val root = migrationRoot()
    try {
      val coordinator = LegacyPhotoMigrator(dir, capture(root, alias)) { EncryptedPhotoCodec(dir, VaultKeyStore(alias)) }
      assertEquals(1, coordinator.migrate().migrated)
      val repeat = coordinator.migrate()
      assertEquals(0, repeat.migrated); assertEquals(0, repeat.remaining); assertEquals(0, repeat.failed); assertNull(repeat.errorCode)
    } finally { root.deleteRecursively() }
  }

  @Test fun coordinatorGateBlocksGalleryDeleteUntilMigrationCompletes() = fixture { dir, alias ->
    val source = File(dir, "contended.jpg").apply { writeBytes(ByteArray(128) { it.toByte() }) }
    val root = migrationRoot()
    val entered = CountDownLatch(1); val release = CountDownLatch(1); val deleteStarted = CountDownLatch(1); val deleteDone = CountDownLatch(1)
    val migrationError = AtomicReference<Throwable?>(); val deleteError = AtomicReference<Throwable?>(); val result = AtomicReference<LegacyPhotoMigrator.Result?>()
    try {
      val coordinator = LegacyPhotoMigrator(dir, capture(root, alias)) {
        entered.countDown(); check(release.await(5, TimeUnit.SECONDS)); EncryptedPhotoCodec(dir, VaultKeyStore(alias))
      }
      val migration = Thread { try { result.set(coordinator.migrate()) } catch (t: Throwable) { migrationError.set(t) } }
      migration.start(); assertTrue(entered.await(5, TimeUnit.SECONDS))
      val deletion = Thread { deleteStarted.countDown(); try { PhotoMutationGate.deleteGalleryPhoto(dir, source.name) } catch (t: Throwable) { deleteError.set(t) } finally { deleteDone.countDown() } }
      deletion.start(); assertTrue(deleteStarted.await(5, TimeUnit.SECONDS)); assertFalse(deleteDone.await(200, TimeUnit.MILLISECONDS))
      release.countDown(); migration.join(5000); deletion.join(5000)
      assertFalse(migration.isAlive); assertFalse(deletion.isAlive); assertNull(migrationError.get())
      assertTrue("queued deletion must refuse an original already removed by verified migration", deleteError.get() is IllegalArgumentException)
      assertEquals(1, result.get()!!.migrated); assertFalse(source.exists())
      val restored = File(dir, "verified-after-contention.bin")
      EncryptedPhotoCodec(dir, VaultKeyStore(alias)).decrypt(File(dir, deterministic(source.name)).path, restored.path)
      assertArrayEquals(ByteArray(128) { it.toByte() }, restored.readBytes())
    } finally { release.countDown(); root.deleteRecursively() }
  }

  @Test fun primitiveRefusesAbsentSourceWhenTargetExists() = fixture { dir, alias ->
    val target = File(dir, deterministic("gone.jpg")).apply { writeBytes(ByteArray(40) { 2 }) }
    assertThrows(IllegalArgumentException::class.java) { EncryptedPhotoCodec(dir, VaultKeyStore(alias)).migrateLegacyFile("gone.jpg") }
    assertTrue(target.exists())
  }

  private fun migrationRoot() = File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.cacheDir, "migration-root-${UUID.randomUUID()}").apply { mkdirs() }
  private fun capture(root: File, alias: String) = CaptureCoordinator(root, File(root, "camera"), root, File(root, "views"), VaultKeyStore(alias))

  private fun deterministic(name: String): String = "legacy-${java.security.MessageDigest.getInstance("SHA-256").digest(name.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }}.scv"

  private fun fixture(block: (File, String) -> Unit) {
    val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
    val dir = File(context.cacheDir, "legacy-${UUID.randomUUID()}").apply { mkdirs() }
    val alias = "legacy-test-${UUID.randomUUID()}"
    try {
      VaultKeyStore(alias).initializeNewVault()
      block(dir, alias)
    } finally {
      KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
      dir.deleteRecursively()
    }
  }
}
