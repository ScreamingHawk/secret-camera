package expo.modules.photovault

import android.content.ContentResolver
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import kotlin.math.max

/** Copies granted sender bytes into owned private staging; never mutates the provider URI. */
internal class PendingImageShares(
  private val directory: File,
  private val resolveType: (Uri) -> String?,
  private val openSource: (Uri) -> java.io.InputStream?,
  private val hasSeenDelivery: (String) -> Boolean = { false },
  private val markDeliverySeen: (String) -> Unit = {}
) {
  data class Pending(val id: String, val uri: String, val mimeType: String)

  private val deliveries = mutableSetOf<String>()

  fun receive(intent: Intent): List<Pending> {
    val token = intent.getStringExtra(DELIVERY_TOKEN)
      ?: UUID.randomUUID().toString().also { intent.putExtra(DELIVERY_TOKEN, it) }
    synchronized(deliveries) {
      if (token in deliveries || hasSeenDelivery(token)) return emptyList()
      deliveries.add(token)
    }
    try {
      val uris = when (intent.action) {
        Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri)
        Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
        else -> emptyList()
      }
      if (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE) {
        require(uris.isNotEmpty()) { "No shared image was provided" }
      }
      val staged = uris.mapIndexed { index, uri ->
        val requestId = UUID.nameUUIDFromBytes("$token:$index".toByteArray(Charsets.UTF_8)).toString()
        require(uri.scheme == ContentResolver.SCHEME_CONTENT) { "Unsupported shared image URI" }
        stage(uri, intent.type, requestId)
      }
      markDeliverySeen(token)
      return staged
    } finally {
      synchronized(deliveries) { deliveries.remove(token) }
    }
  }

  /** Copies only Expo ImagePicker's UUID JPEG cache output into owned private staging. */
  fun stagePickerImageFile(uri: Uri, appCacheRoot: File): Pending {
    require(uri.scheme == "file") { "Unsupported picker image URI" }
    val trustedCache = appCacheRoot.canonicalFile
    val cacheRoot = File(trustedCache, "ImagePicker").canonicalFile
    require(cacheRoot.parentFile == trustedCache) { "Picker cache root is outside app cache" }
    val candidate = File(uri.path ?: error("Picker image path unavailable"))
    require(candidate.isAbsolute && candidate.toPath().toAbsolutePath().normalize().toFile() == candidate.canonicalFile) { "Picker image path is not canonical" }
    require(candidate.canonicalFile.parentFile == cacheRoot) { "Picker image is outside Expo ImagePicker cache" }
    require(candidate.name.matches(Regex("[0-9a-fA-F-]{36}\\.[a-zA-Z0-9]{1,8}"))) { "Unsupported picker cache image" }
    val stat = Os.lstat(candidate.path)
    require((stat.st_mode and OsConstants.S_IFMT) == OsConstants.S_IFREG) { "Picker image must be a regular file" }
    try {
      return stage(Uri.fromFile(candidate), "image/jpeg", UUID.randomUUID().toString()) { FileInputStream(candidate) }
    } finally {
      // Expo made this app-owned cache copy; the selected provider original is untouched.
      candidate.delete()
    }
  }

  fun list(): List<Pending> = directory.listFiles()
    ?.filter { it.isFile && it.name.matches(PENDING_NAME) }
    ?.map { file ->
      val id = file.name.removePrefix("pending-").removeSuffix(".jpg")
      Pending(id, file.toURI().toString(), "image/jpeg")
    }.orEmpty()

  fun consume(id: String): Pending? {
    require(id.matches(ID_PATTERN))
    return list().firstOrNull { it.id == id }
  }

  fun acknowledge(id: String) {
    require(id.matches(ID_PATTERN))
    directory.listFiles()?.filter { it.name.startsWith("pending-$id.") }?.forEach { check(it.delete()) }
    syncDirectory()
  }

  private fun syncDirectory() {
    val fd = Os.open(directory.path, OsConstants.O_RDONLY or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 0)
    try { Os.fsync(fd) } finally { Os.close(fd) }
  }

  @Synchronized
  private fun stage(uri: Uri, declared: String?, id: String, source: () -> java.io.InputStream? = { openSource(uri) }): Pending {
    require(id.matches(ID_PATTERN))
    check(directory.exists() || directory.mkdirs()) { "Private pending image storage unavailable" }
    val target = File(directory, "pending-$id.jpg")
    if (target.isFile) return Pending(id, target.toURI().toString(), "image/jpeg")
    require(!target.exists()) { "Pending image destination already exists" }

    val actualType = resolveType(uri)?.lowercase()?.substringBefore(';')
    require(actualType == null || actualType in JPEG_TYPES) { "Only JPEG images are supported" }
    val declaredType = declared?.lowercase()?.substringBefore(';')
    require(declaredType == null || declaredType == "image/*" || declaredType in JPEG_TYPES) {
      "Only JPEG images are supported"
    }
    require(actualType == null || declaredType == null || declaredType == "image/*" || actualType == declaredType) {
      "Shared image MIME type does not match its content provider"
    }

    val existing = list().filter { it.id != id }
    require(existing.size < MAX_PENDING_COUNT) { "Too many pending shared images" }
    val existingBytes = existing.sumOf { File(java.net.URI(it.uri)).length() }
    require(existingBytes < MAX_PENDING_TOTAL_BYTES) { "Pending image storage is full" }
    val partial = File(directory, "pending-$id.jpg.part")
    check(!partial.exists() || partial.delete()) { "Unable to clear owned partial image" }
    try {
      val input = source() ?: error("Shared image is unavailable")
      input.use { source ->
        FileOutputStream(partial).use { output ->
          val header = ByteArray(12)
          var prefixCount = 0
          while (prefixCount < 3) {
            val read = source.read(header, prefixCount, header.size - prefixCount)
            if (read < 0) break
            if (read == 0) {
              val next = source.read()
              if (next < 0) break
              header[prefixCount++] = next.toByte()
            } else prefixCount += read
          }
          require(prefixCount >= 3 && header[0] == 0xff.toByte() &&
            header[1] == 0xd8.toByte() && header[2] == 0xff.toByte()) {
            "Shared content is not a supported JPEG"
          }
          var total = prefixCount
          require(total <= MAX_BYTES && existingBytes + total <= MAX_PENDING_TOTAL_BYTES) { "Shared image exceeds pending storage limit" }
          output.write(header, 0, prefixCount)
          val buffer = ByteArray(8192)
          while (true) {
            val count = source.read(buffer)
            if (count < 0) break
            if (count == 0) {
              val next = source.read()
              if (next < 0) break
              total += 1
              require(total <= MAX_BYTES && existingBytes + total <= MAX_PENDING_TOTAL_BYTES) { "Shared image exceeds pending storage limit" }
              output.write(next)
            } else {
              total += count
              require(total <= MAX_BYTES && existingBytes + total <= MAX_PENDING_TOTAL_BYTES) { "Shared image exceeds pending storage limit" }
              output.write(buffer, 0, count)
            }
          }
          output.fd.sync()
        }
      }
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(partial.path, bounds)
      val pixels = bounds.outWidth.toLong() * bounds.outHeight.toLong()
      require(bounds.outWidth > 0 && bounds.outHeight > 0 && pixels <= MAX_PIXELS) {
        "Shared content is not a supported, bounded JPEG"
      }
      var sample = 1
      while (pixels / (sample.toLong() * sample) > MAX_DECODE_PIXELS) sample *= 2
      val decoded = BitmapFactory.decodeFile(partial.path, BitmapFactory.Options().apply {
        inSampleSize = max(1, sample)
        inPreferredConfig = Bitmap.Config.RGB_565
      })
      require(decoded != null) { "Shared JPEG is corrupt or truncated" }
      decoded.recycle()
      check(!target.exists() && partial.renameTo(target)) { "Unable to publish pending image" }
      syncDirectory()
      return Pending(id, target.toURI().toString(), "image/jpeg")
    } catch (failure: Exception) {
      partial.delete()
      throw failure
    }
  }

  companion object {
    const val MAX_BYTES = 32 * 1024 * 1024
    const val MAX_PENDING_TOTAL_BYTES = 64L * 1024 * 1024
    private const val MAX_PENDING_COUNT = 20
    private const val MAX_PIXELS = 100_000_000L
    private const val MAX_DECODE_PIXELS = 1_000_000L
    private val ID_PATTERN = Regex("[0-9a-f-]{36}")
    private val PENDING_NAME = Regex("pending-[0-9a-f-]{36}\\.jpg")
    private val JPEG_TYPES = setOf("image/jpeg", "image/jpg")
    const val DELIVERY_TOKEN = "expo.modules.photovault.delivery-token"
  }
}
