'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPOSITORY = 'ScreamingHawk/secret-camera';
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BUILD_TOOLS = '35.0.0';

function verifiedHighestCode({
  signerSha256,
  releases,
  downloadAsset,
  verifyApk,
}) {
  if (!/^[a-f0-9]{64}$/i.test(signerSha256 || ''))
    throw new Error(
      'ANDROID_SIGNER_SHA256 must be the expected new-lineage certificate SHA-256'
    );
  if (!Array.isArray(releases))
    throw new Error('Release history is not a list');
  let highest = 0; // Explicit fresh-signer baseline; no stable history is valid.
  for (const release of releases) {
    if (
      release.draft ||
      release.prerelease ||
      !TAG.test(release.tag_name || '')
    )
      continue;
    const assets = release.assets || [];
    const apk = assets.filter((asset) => asset.name === 'secret-camera.apk');
    if (apk.length !== 1)
      throw new Error(
        `Stable release ${release.tag_name} must have exactly one secret-camera.apk asset`
      );
    const file = downloadAsset(release.tag_name, apk[0]);
    let identity;
    try {
      identity = verifyApk(file);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
    if (
      !identity ||
      typeof identity.signerSha256 !== 'string' ||
      identity.package !== 'link.standen.secretcamera' ||
      identity.signerSha256.toLowerCase() !== signerSha256.toLowerCase()
    )
      throw new Error(
        `Stable release ${release.tag_name} APK cannot be verified as this package signed by the configured new lineage`
      );
    if (identity.versionName !== release.tag_name.slice(1))
      throw new Error(
        `Stable release ${release.tag_name} APK versionName does not match its release tag`
      );
    if (
      !Number.isSafeInteger(identity.versionCode) ||
      identity.versionCode <= 0
    )
      throw new Error(
        `Stable release ${release.tag_name} has invalid APK versionCode`
      );
    highest = Math.max(highest, identity.versionCode);
  }
  return highest;
}

function getVerifiedReleaseHistory() {
  const expected = process.env.ANDROID_SIGNER_SHA256;
  if (!expected)
    throw new Error(
      'ANDROID_SIGNER_SHA256 is required to verify release history'
    );
  // --slurp returns one array containing all paginated response arrays.
  const pages = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${REPOSITORY}/releases`, '--paginate', '--slurp'],
      { encoding: 'utf8' }
    )
  );
  if (!Array.isArray(pages) || !pages.every(Array.isArray))
    throw new Error('GitHub release history pages are malformed');
  const releases = pages.flat();
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!sdk)
    throw new Error(
      'Set ANDROID_SDK_ROOT or ANDROID_HOME to the Android SDK directory'
    );
  const tools = path.join(sdk, 'build-tools', BUILD_TOOLS);
  const apksigner = path.join(tools, 'apksigner');
  const aapt = path.join(tools, 'aapt');
  if (!fs.existsSync(apksigner) || !fs.existsSync(aapt))
    throw new Error(
      `Android build-tools ${BUILD_TOOLS} with apksigner and aapt are required`
    );
  return verifiedHighestCode({
    signerSha256: expected,
    releases,
    downloadAsset(tag, asset) {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'secret-camera-history-')
      );
      const file = path.join(dir, asset.name);
      try {
        execFileSync('gh', [
          'release',
          'download',
          tag,
          '--repo',
          REPOSITORY,
          '--pattern',
          asset.name,
          '--dir',
          dir,
        ]);
        if (!fs.existsSync(file))
          throw new Error(
            `GitHub CLI did not download ${asset.name} for ${tag}`
          );
        return file;
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
      }
    },
    verifyApk(file) {
      const output = execFileSync(
        apksigner,
        ['verify', '--print-certs', file],
        { encoding: 'utf8' }
      );
      const signers = [
        ...output.matchAll(
          /^Signer #\d+ certificate SHA-256 digest: ([0-9a-f:]+)\s*$/gim
        ),
      ].map((match) => match[1].replace(/:/g, '').toLowerCase());
      if (signers.length !== 1)
        throw new Error(
          `Expected exactly one APK signer certificate, found ${signers.length}`
        );
      const badging = execFileSync(aapt, ['dump', 'badging', file], {
        encoding: 'utf8',
      });
      const pkg = badging.match(/^package: name='([^']+)'/m)?.[1];
      const versionName = badging.match(
        /^package:.*\bversionName='([^']+)'/m
      )?.[1];
      const code = Number(
        badging.match(/^package:.*\bversionCode='(\d+)'/m)?.[1]
      );
      return {
        package: pkg,
        versionCode: code,
        versionName,
        signerSha256: signers[0],
      };
    },
  });
}

if (require.main === module) {
  try {
    console.log(getVerifiedReleaseHistory());
  } catch (error) {
    console.error(`Release history verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { verifiedHighestCode, getVerifiedReleaseHistory };
