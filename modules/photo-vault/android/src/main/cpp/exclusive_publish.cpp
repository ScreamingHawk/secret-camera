#include <jni.h>

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include <fcntl.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(SYS_renameat2)
#error "renameat2 syscall number is unavailable for this Android ABI"
#endif

#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1U << 0)
#endif

namespace {

void throw_io(JNIEnv* env, const char* operation, int error) {
  std::string message(operation);
  message += ": ";
  message += std::strerror(error);
  jclass exception = env->FindClass("java/io/IOException");
  if (exception != nullptr) env->ThrowNew(exception, message.c_str());
}

bool copy_name(JNIEnv* env, jstring value, std::string* output) {
  if (value == nullptr) return false;
  const jsize length = env->GetStringLength(value);
  const jchar* chars = env->GetStringChars(value, nullptr);
  if (chars == nullptr) return false;
  output->clear();
  bool valid = true;
  for (jsize i = 0; i < length && valid; ++i) {
    uint32_t codepoint = chars[i];
    if (codepoint == 0) { valid = false; break; }
    if (codepoint >= 0xD800 && codepoint <= 0xDBFF) {
      if (i + 1 >= length || chars[i + 1] < 0xDC00 || chars[i + 1] > 0xDFFF) { valid = false; break; }
      codepoint = 0x10000 + ((codepoint - 0xD800) << 10) + (chars[++i] - 0xDC00);
    } else if (codepoint >= 0xDC00 && codepoint <= 0xDFFF) {
      valid = false;
      break;
    }
    if (codepoint < 0x80) output->push_back(static_cast<char>(codepoint));
    else if (codepoint < 0x800) {
      output->push_back(static_cast<char>(0xC0 | (codepoint >> 6)));
      output->push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    } else if (codepoint < 0x10000) {
      output->push_back(static_cast<char>(0xE0 | (codepoint >> 12)));
      output->push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
      output->push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    } else {
      output->push_back(static_cast<char>(0xF0 | (codepoint >> 18)));
      output->push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3F)));
      output->push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3F)));
      output->push_back(static_cast<char>(0x80 | (codepoint & 0x3F)));
    }
  }
  env->ReleaseStringChars(value, chars);
  return valid && !output->empty() && *output != "." && *output != ".." &&
      output->find('/') == std::string::npos;
}

}  // namespace

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_photovault_EncryptedPhotoCodec_publishExclusiveNative(
    JNIEnv* env, jobject /* self */, jint directory_fd, jstring destination,
    jstring staged, jbyteArray content) {
  std::string destination_name;
  std::string staged_name;
  if (!copy_name(env, destination, &destination_name) ||
      !copy_name(env, staged, &staged_name) || content == nullptr) {
    jclass exception = env->FindClass("java/lang/IllegalArgumentException");
    if (exception != nullptr) env->ThrowNew(exception, "Expected simple non-empty file names and content");
    return;
  }

  const jsize length = env->GetArrayLength(content);
  if (length < 0 || static_cast<uint64_t>(length) > 64ULL * 1024ULL * 1024ULL + 64ULL) {
    jclass exception = env->FindClass("java/lang/IllegalArgumentException");
    if (exception != nullptr) env->ThrowNew(exception, "Photo payload exceeds codec limit");
    return;
  }
  std::vector<jbyte> bytes(static_cast<size_t>(length));
  if (length > 0) env->GetByteArrayRegion(content, 0, length, bytes.data());
  if (env->ExceptionCheck()) return;

  int fd;
  do {
    fd = openat(directory_fd, staged_name.c_str(),
                O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  } while (fd < 0 && errno == EINTR);
  if (fd < 0) {
    throw_io(env, "create staging file", errno);
    return;
  }

  int failure = 0;
  size_t written = 0;
  while (written < bytes.size()) {
    ssize_t count = write(fd, bytes.data() + written, bytes.size() - written);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      failure = count == 0 ? EIO : errno;
      break;
    }
    written += static_cast<size_t>(count);
  }
  if (failure == 0 && fsync(fd) != 0) failure = errno;
  if (close(fd) != 0 && failure == 0) failure = errno;

  if (failure == 0) {
    long result;
    do {
      result = syscall(SYS_renameat2, directory_fd, staged_name.c_str(),
                       directory_fd, destination_name.c_str(), RENAME_NOREPLACE);
    } while (result < 0 && errno == EINTR);
    if (result != 0) failure = errno;
  }

  if (failure != 0) {
    const int saved_errno = failure;
    (void)unlinkat(directory_fd, staged_name.c_str(), 0);
    throw_io(env, "atomically publish photo without replacement", saved_errno);
  }
}
