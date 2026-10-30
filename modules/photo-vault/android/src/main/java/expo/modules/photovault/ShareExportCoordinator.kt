package expo.modules.photovault

import java.io.File

/** Serializes export publication and lease transitions for one process. */
internal class ShareExportCoordinator(
  private val root: File,
  private val now: () -> Long = System::currentTimeMillis,
  private val retentionMs: Long = 60L * 60 * 1000
) {
  private val lock = Any()
  private val active = mutableSetOf<String>()
  private val leaf = Regex("share-[0-9a-f-]{36}\\.jpg")
  private fun sidecar(file: File) = File(root, file.name + ".expiry")
  private fun owned(file: File): Boolean = file.parentFile?.canonicalFile == root.canonicalFile && leaf.matches(file.name) && !java.nio.file.Files.isSymbolicLink(file.toPath())
  private fun expiry(file: File): Long {
    val value = try { sidecar(file).readText().toLongOrNull() } catch (_: Exception) { null }
    val t = now()
    return if (value == null || value < 0 || value > t + retentionMs) (file.lastModified().coerceAtMost(t) + retentionMs) else value
  }
  private fun persist(file: File, until: Long) {
    val tmp = File(root, file.name + ".expiry.tmp")
    tmp.writeText(until.toString())
    if (!tmp.renameTo(sidecar(file))) { tmp.delete(); throw IllegalStateException("Unable to persist share lease") }
  }
  fun prepare(publish: () -> File): File = synchronized(lock) {
    root.mkdirs(); cleanupLocked(now())
    val file = publish()
    try { require(owned(file) && file.isFile); persist(file, now() + retentionMs); file }
    catch (e: Exception) { file.delete(); sidecar(file).delete(); throw e }
  }
  fun begin(file: File) = synchronized(lock) { require(owned(file) && file.isFile); require(file.name !in active); active.add(file.name) }
  fun finish(file: File) = synchronized(lock) {
    require(owned(file)); try { if (file.isFile) persist(file, now() + retentionMs) } finally { active.remove(file.name) }
    cleanupLocked(now())
  }
  fun abandon(file: File) = synchronized(lock) {
    require(owned(file)); require(file.name !in active) { "Share export is active" }
    if (file.exists()) require(file.delete()); sidecar(file).delete()
  }
  fun cleanup(at: Long = now()) = synchronized(lock) { cleanupLocked(at) }
  private fun cleanupLocked(at: Long) {
    root.listFiles()?.filter { leaf.matches(it.name) && it.name !in active && it.isFile }?.forEach { file ->
      try { if (at >= expiry(file)) { file.delete(); sidecar(file).delete() } } catch (_: Exception) { }
    }
  }
}
