package expo.modules.photovault

import android.os.ParcelFileDescriptor
import android.system.Os
import android.system.OsConstants
import java.io.File
import java.io.FileInputStream
import java.util.UUID
import java.security.GeneralSecurityException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

/** Small bounded file codec. Paths must name files inside this app's filesDir. */
internal class EncryptedPhotoCodec(
  private val filesDir: File,
  private val keys: VaultKeyStore,
  private val trustedOutputDir: File = filesDir,
  private val afterPathValidation: () -> Unit = {}
) {
  fun encrypt(inputPath: String, outputPath: String) = withPinned(filesDir) { root ->
    val input = validatePath(inputPath, mustExist = true)
    val output = validatePath(outputPath, mustExist = false)
    check(input != output) { "Input and output must differ" }
    afterPathValidation()
    val plain = readBounded(File(root, input.name), MAX_PLAINTEXT_BYTES)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, keys.requireExistingKey())
    val nonce = cipher.iv
    require(nonce != null && nonce.size == NONCE_BYTES) { "Unsupported AndroidKeyStore GCM nonce" }
    cipher.updateAAD(HEADER)
    publishExclusive(root, output.name, HEADER + nonce + cipher.doFinal(plain))
  }

  fun decrypt(inputPath: String, outputPath: String) = withPinned(filesDir) { root ->
    val input = validatePath(inputPath, mustExist = true)
    val output = validatePath(outputPath, mustExist = false)
    check(input != output) { "Input and output must differ" }
    afterPathValidation()
    val envelope = readBounded(File(root, input.name), MAX_ENVELOPE_BYTES)
    require(envelope.size >= HEADER.size + NONCE_BYTES + TAG_BYTES) { "Encrypted photo is truncated" }
    require(envelope.copyOfRange(0, HEADER.size).contentEquals(HEADER)) { "Unsupported encrypted photo format" }
    val nonce = envelope.copyOfRange(HEADER.size, HEADER.size + NONCE_BYTES)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, keys.requireExistingKey(), GCMParameterSpec(TAG_BITS, nonce))
    cipher.updateAAD(HEADER)
    val plaintext = try { cipher.doFinal(envelope, HEADER.size + NONCE_BYTES, envelope.size - HEADER.size - NONCE_BYTES) }
    catch (e: GeneralSecurityException) { throw SecurityException("Encrypted photo authentication failed", e) }
    publishExclusive(root, output.name, plaintext)
  }

  fun prepareView(encryptedLeaf: String): File {
    require(encryptedLeaf.isNotBlank() && File(encryptedLeaf).name == encryptedLeaf && encryptedLeaf != "." && encryptedLeaf != "..") { "Expected encrypted photo leaf name" }
    val outputName = "view-${UUID.randomUUID()}.jpg"
    withPinnedRoots { inputRoot, outputRoot ->
      val input = validateLeaf(inputRoot, encryptedLeaf, true)
      afterPathValidation()
      val envelope = readBounded(input, MAX_ENVELOPE_BYTES)
      val plaintext = decryptAuthenticated(envelope)
      publishExclusive(outputRoot, outputName, plaintext)
    }
    return File(trustedOutputDir, outputName)
  }

  fun releaseView(token: String) {
    require(token.matches(Regex("view-[0-9a-f-]{36}\\.jpg"))) { "Invalid private view token" }
    withPinnedOutput { root ->
      File(root, token).delete()
      Unit
    }
  }

  private fun decryptAuthenticated(envelope: ByteArray): ByteArray {
    require(envelope.size >= HEADER.size + NONCE_BYTES + TAG_BYTES) { "Encrypted photo is truncated" }
    require(envelope.copyOfRange(0, HEADER.size).contentEquals(HEADER)) { "Unsupported encrypted photo format" }
    val nonce = envelope.copyOfRange(HEADER.size, HEADER.size + NONCE_BYTES)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, keys.requireExistingKey(), GCMParameterSpec(TAG_BITS, nonce))
    cipher.updateAAD(HEADER)
    return try { cipher.doFinal(envelope, HEADER.size + NONCE_BYTES, envelope.size - HEADER.size - NONCE_BYTES) }
    catch (e: GeneralSecurityException) { throw SecurityException("Encrypted photo authentication failed", e) }
  }

  private fun validateLeaf(root: File, leaf: String, mustExist: Boolean): File {
    require(leaf.isNotBlank() && File(leaf).name == leaf && leaf != "." && leaf != "..") { "Expected direct-child filename" }
    val candidate = File(root, leaf)
    if (mustExist) require(candidate.isFile) { "Input file is missing" } else require(!candidate.exists()) { "Output already exists" }
    return candidate
  }

  private inline fun <T> withPinnedOutput(block: (File) -> T): T = withPinned(trustedOutputDir, block)
  private inline fun <T> withPinnedRoots(block: (File, File) -> T): T {
    return withPinned(filesDir) { input -> withPinned(trustedOutputDir) { output -> block(input, output) } }
  }
  private inline fun <T> withPinned(directory: File, block: (File) -> T): T {
    val canonical = directory.canonicalFile
    val root = Os.open(canonical.path, OsConstants.O_RDONLY or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 0)
    try {
      ParcelFileDescriptor.dup(root).use { owned ->
        val stat = Os.fstat(owned.fileDescriptor)
        require((stat.st_mode and OsConstants.S_IFMT) == OsConstants.S_IFDIR) { "filesDir must be a directory" }
        return block(File("/proc/self/fd/${owned.fd}"))
      }
    } finally {
      Os.close(root)
    }
  }

  private fun readBounded(file: File, limit: Long): ByteArray {
    val fd = Os.open(file.path, OsConstants.O_RDONLY or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 0)
    return FileInputStream(fd).use { input ->
      val stat = Os.fstat(input.fd)
      require((stat.st_mode and OsConstants.S_IFMT) == OsConstants.S_IFREG) { "Input must be a regular file" }
      require(stat.st_size <= limit) { "Photo exceeds codec size limit" }
      val output = java.io.ByteArrayOutputStream(minOf(stat.st_size, limit).toInt())
      val buffer = ByteArray(32 * 1024)
      var total = 0L
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        total += count
        require(total <= limit) { "Photo exceeds codec size limit" }
        output.write(buffer, 0, count)
      }
      output.toByteArray()
    }
  }

  private fun validatePath(path: String, mustExist: Boolean): File {
    require(path.isNotBlank()) { "Path is required" }
    val root = filesDir.canonicalFile
    val candidate = File(path)
    require(candidate.isAbsolute) { "Path must be absolute" }
    val normalized = candidate.toPath().toAbsolutePath().normalize().toFile()
    val canonical = candidate.canonicalFile
    require(normalized == canonical) { "Symlink paths are not allowed" }
    require(canonical.parentFile == root || canonical.parentFile?.canonicalFile == root) {
      "Photo path must be directly inside app-private filesDir"
    }
    if (mustExist) require(canonical.isFile && canonical.length() <= MAX_ENVELOPE_BYTES) { "Input file is missing or too large" }
    else require(!canonical.exists()) { "Output already exists" }
    return canonical
  }

  private fun publishExclusive(root: File, name: String, bytes: ByteArray) {
    publishExclusiveNative(root.name.toInt(), name, ".vault-${UUID.randomUUID()}.tmp", bytes)
  }

  private external fun publishExclusiveNative(directoryFd: Int, destinationName: String, stagedName: String, bytes: ByteArray)

  companion object {
    init { System.loadLibrary("photo_vault") }
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128
    private const val TAG_BYTES = 16
    private const val NONCE_BYTES = 12
    private const val MAX_PLAINTEXT_BYTES = 64L * 1024 * 1024
    private const val MAX_ENVELOPE_BYTES = MAX_PLAINTEXT_BYTES + 64
    private val HEADER = byteArrayOf(0x53, 0x43, 0x50, 0x48, 0x01)
  }
}
