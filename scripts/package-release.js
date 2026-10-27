'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateMetadata } = require('./validate-release');

const APK_NAME = 'secret-camera.apk';
const COMMIT_SHA = /^[0-9a-f]{40}$/i;

function packageRelease(inputApk, outputDir, commitSha, root = process.cwd()) {
  if (
    typeof inputApk !== 'string' ||
    !inputApk ||
    !fs.existsSync(inputApk) ||
    !fs.statSync(inputApk).isFile()
  ) {
    throw new Error('Input APK must be an existing non-empty file');
  }
  const stat = fs.statSync(inputApk);
  if (stat.size === 0)
    throw new Error('Input APK must be an existing non-empty file');
  if (typeof commitSha !== 'string' || !COMMIT_SHA.test(commitSha))
    throw new Error('Commit SHA must be exactly 40 hexadecimal characters');
  const metadata = validateMetadata(root);
  const bytes = fs.readFileSync(inputApk);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const version = { ...metadata, commit: commitSha, sha256 };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, APK_NAME), bytes);
  fs.writeFileSync(
    path.join(outputDir, 'version.json'),
    `${JSON.stringify(version, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(outputDir, `${APK_NAME}.sha256`),
    `${sha256}  ${APK_NAME}\n`
  );
  return version;
}

if (require.main === module) {
  try {
    if (process.argv.length !== 5)
      throw new Error(
        'Usage: node scripts/package-release.js <signed-verified.apk> <output-directory> <40-character-commit-sha>'
      );
    packageRelease(process.argv[2], process.argv[3], process.argv[4]);
  } catch (error) {
    console.error(`Release packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { packageRelease };
