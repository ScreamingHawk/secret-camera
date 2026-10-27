#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateMetadata } = require('./validate-release');
const REPO = 'ScreamingHawk/secret-camera';
const ASSETS = [
  'secret-camera.apk',
  'secret-camera.apk.sha256',
  'version.json',
];
const COMMIT = /^[0-9a-f]{40}$/i;

function run(command, args, options = {}) {
  return require('node:child_process').execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}
function apiRelease(tag) {
  try {
    return JSON.parse(run('gh', ['api', `repos/${REPO}/releases/tags/${tag}`]));
  } catch (error) {
    const detail = `${error.stderr || ''}\n${error.message || ''}`;
    const status = error.status || error.statusCode;
    if (status === 404 || /HTTP 404|Not Found \(HTTP 404\)/i.test(detail))
      return null;
    throw new Error('GitHub release lookup failed (not a confirmed 404)');
  }
}
function verifyExistingRelease(
  tag,
  expectedCommit,
  outputDir,
  root = process.cwd()
) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || ''))
    throw new Error('Expected stable tag vX.Y.Z');
  if (!COMMIT.test(expectedCommit || ''))
    throw new Error('Commit SHA must be exactly 40 hexadecimal characters');
  const metadata = validateMetadata(root);
  if (tag.slice(1) !== metadata.version)
    throw new Error(
      `Tag ${tag} does not match current app version ${metadata.version}`
    );
  const signer = process.env.ANDROID_SIGNER_SHA256 || '';
  if (!/^[0-9a-f]{64}$/i.test(signer))
    throw new Error(
      'ANDROID_SIGNER_SHA256 must be exactly 64 hexadecimal characters'
    );
  const release = apiRelease(tag);
  if (release === null) return { exists: false };
  if (release.tag_name !== tag || release.draft || release.prerelease)
    throw new Error(
      'Existing release is not the requested stable published release'
    );
  const counts = new Map();
  for (const asset of release.assets || [])
    counts.set(asset.name, (counts.get(asset.name) || 0) + 1);
  if (ASSETS.some((name) => counts.get(name) !== 1))
    throw new Error('Release must contain exactly one of each required asset');
  let resolved;
  try {
    resolved = run('git', ['rev-parse', `${tag}^{commit}`]).trim();
  } catch (_) {
    resolved = '';
  }
  if (
    !COMMIT.test(resolved) ||
    resolved.toLowerCase() !== expectedCommit.toLowerCase()
  )
    throw new Error('Remote tag does not resolve to expected commit');
  const destination = path.resolve(outputDir);
  fs.mkdirSync(destination, { recursive: true });
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'verify-existing-release-')
  );
  try {
    run('gh', [
      'release',
      'download',
      tag,
      '--repo',
      REPO,
      '--dir',
      temp,
      ...ASSETS.flatMap((name) => ['--pattern', name]),
    ]);
    for (const name of ASSETS)
      if (
        !fs.existsSync(path.join(temp, name)) ||
        !fs.statSync(path.join(temp, name)).isFile()
      )
        throw new Error(`Missing release asset: ${name}`);
    const apk = path.join(temp, ASSETS[0]);
    const checksum = fs.readFileSync(path.join(temp, ASSETS[1]), 'utf8').trim();
    const checksumMatch = /^([0-9a-f]{64})\s+\*?secret-camera\.apk$/i.exec(
      checksum
    );
    if (!checksumMatch) throw new Error('Malformed APK checksum asset');
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(apk))
      .digest('hex');
    if (digest !== checksumMatch[1].toLowerCase())
      throw new Error('APK checksum asset does not match APK');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(temp, 'version.json'), 'utf8')
    );
    if (
      manifest.sha256 !== digest ||
      manifest.commit.toLowerCase() !== expectedCommit.toLowerCase() ||
      manifest.version !== metadata.version ||
      manifest.versionCode !== metadata.versionCode ||
      manifest.package !== metadata.package
    )
      throw new Error('version.json does not match expected release metadata');
    const tools =
      process.env.SDK_ROOT ||
      process.env.ANDROID_SDK_ROOT ||
      process.env.ANDROID_HOME ||
      (process.env.HOME && path.join(process.env.HOME, 'Android', 'Sdk'));
    const buildTools =
      process.env.ANDROID_BUILD_TOOLS ||
      process.env.ANDROID_SDK_BUILD_TOOLS ||
      (tools && path.join(tools, 'build-tools', '35.0.0'));
    if (!buildTools)
      throw new Error('Android SDK build-tools path is unavailable');
    const certs = run(path.join(buildTools, 'apksigner'), [
      'verify',
      '--verbose',
      '--print-certs',
      apk,
    ]);
    const certList = [
      ...certs.matchAll(/certificate SHA-256 digest:\s*([0-9a-f:]+)/gi),
    ].map((m) => m[1].replace(/:/g, '').toLowerCase());
    if (certList.length !== 1 || certList[0] !== signer.toLowerCase())
      throw new Error(
        'APK signer certificate does not match ANDROID_SIGNER_SHA256'
      );
    const badging = run(path.join(buildTools, 'aapt'), [
      'dump',
      'badging',
      apk,
    ]);
    const info =
      /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(
        badging
      );
    if (
      !info ||
      info[1] !== metadata.package ||
      Number(info[2]) !== metadata.versionCode ||
      info[3] !== metadata.version
    )
      throw new Error(
        'APK package/version does not match current app metadata'
      );
    for (const name of ASSETS)
      fs.copyFileSync(
        path.join(temp, name),
        path.join(destination, name),
        fs.constants.COPYFILE_EXCL
      );
    return { exists: true };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    if (process.argv.length !== 5)
      throw new Error(
        'Usage: node scripts/verify-existing-release.js <stable-tag> <40hex-commit> <output-dir>'
      );
    console.log(
      JSON.stringify(
        verifyExistingRelease(process.argv[2], process.argv[3], process.argv[4])
      )
    );
  } catch (error) {
    console.error(`Existing release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { verifyExistingRelease, apiRelease };
