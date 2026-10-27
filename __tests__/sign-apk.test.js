/* eslint-env node, jest */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validateMetadata } = require('../scripts/validate-release');

const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
if (!sdk)
  throw new Error(
    'Signing integration tests require ANDROID_SDK_ROOT or ANDROID_HOME'
  );
const tools =
  process.env.ANDROID_BUILD_TOOLS || path.join(sdk, 'build-tools', '35.0.0');
const aapt = path.join(tools, 'aapt');
const keytool =
  process.env.KEYTOOL ||
  (process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', 'keytool')
    : '/usr/bin/keytool');

const bash = '/usr/bin/bash';
const helper = path.join(__dirname, '..', 'scripts', 'sign-apk.sh');
const metadata = validateMetadata(path.join(__dirname, '..'));
const run = (file, args, opts = {}) =>
  execFileSync(file, args, { encoding: 'utf8', ...opts });

let dir, input, keystore, storePassword, alias, certFingerprint;
beforeAll(() => {
  for (const bin of [
    aapt,
    path.join(tools, 'zipalign'),
    path.join(tools, 'apksigner'),
    keytool,
  ])
    expect(fs.existsSync(bin)).toBe(true);
  dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), 'secret-camera-sign-fixture-')
  );
  input = path.join(dir, 'NO-CODE-SIGNING-FIXTURE.apk');
  const manifest = path.join(dir, 'AndroidManifest.xml');
  fs.writeFileSync(
    manifest,
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${metadata.package}" android:versionCode="${metadata.versionCode}" android:versionName="${metadata.version}"><application android:label="NO-CODE SIGNING FIXTURE"/></manifest>`
  );
  run(aapt, [
    'package',
    '-f',
    '-M',
    manifest,
    '-I',
    path.join(sdk, 'platforms', 'android-35', 'android.jar'),
    '-F',
    input,
  ]);
  keystore = path.join(dir, 'disposable-test-key.jks');
  storePassword = crypto.randomBytes(32).toString('hex');
  alias = 'fixture';
  const keyEnv = {
    ...process.env,
    SECRET_CAMERA_FIXTURE_PASSWORD: storePassword,
  };
  run(
    keytool,
    [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storepass:env',
      'SECRET_CAMERA_FIXTURE_PASSWORD',
      '-keypass:env',
      'SECRET_CAMERA_FIXTURE_PASSWORD',
      '-alias',
      alias,
      '-dname',
      'CN=Disposable Test Fixture',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '2',
      '-noprompt',
    ],
    { env: keyEnv }
  );
  const cert = run(
    keytool,
    [
      '-exportcert',
      '-rfc',
      '-keystore',
      keystore,
      '-storepass:env',
      'SECRET_CAMERA_FIXTURE_PASSWORD',
      '-alias',
      alias,
    ],
    { env: keyEnv }
  );
  const pem = path.join(dir, 'cert.pem');
  fs.writeFileSync(pem, cert);
  const digest = run('openssl', [
    'x509',
    '-in',
    pem,
    '-noout',
    '-fingerprint',
    '-sha256',
  ]);
  certFingerprint = digest
    .trim()
    .split('=')
    .pop()
    .replaceAll(':', '')
    .toLowerCase();
});
afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
function env(fp = certFingerprint) {
  return {
    ...process.env,
    ANDROID_KEYSTORE_PATH: keystore,
    ANDROID_STORE_PASSWORD: storePassword,
    ANDROID_KEY_ALIAS: alias,
    ANDROID_KEY_PASSWORD: storePassword,
    ANDROID_SIGNER_SHA256: fp,
    ANDROID_SDK_ROOT: sdk,
    ANDROID_BUILD_TOOLS: tools,
  };
}
function sign(output, source = input, fp = certFingerprint) {
  return run(bash, [helper, source, output], { env: env(fp), stdio: 'pipe' });
}

test('signs fixture and independently verifies APK metadata and certificate', () => {
  const output = path.join(dir, 'signed.apk');
  sign(output);
  run(path.join(tools, 'apksigner'), ['verify', '--verbose', output]);
  const badging = run(aapt, ['dump', 'badging', output]);
  expect(badging).toContain(
    `package: name='${metadata.package}' versionCode='${metadata.versionCode}' versionName='${metadata.version}'`
  );
  const cert = run(path.join(tools, 'apksigner'), [
    'verify',
    '--print-certs',
    output,
  ]);
  expect(cert.toLowerCase().replaceAll(':', '')).toContain(certFingerprint);
});
test('rejects wrong expected fingerprint without publishing output', () => {
  const output = path.join(dir, 'wrong-fingerprint.apk');
  expect(() => sign(output, input, '0'.repeat(64))).toThrow();
  expect(fs.existsSync(output)).toBe(false);
});
test('refuses an existing destination and never modifies its input', () => {
  const output = path.join(dir, 'already-present.apk');
  const originalInput = fs.readFileSync(input);
  const existing = Buffer.from('existing output must not be replaced');
  fs.writeFileSync(output, existing);
  expect(() => sign(output)).toThrow();
  expect(fs.readFileSync(output)).toEqual(existing);
  expect(() => sign(input)).toThrow();
  expect(fs.readFileSync(input)).toEqual(originalInput);
});
test('rejects APK whose package or version metadata differs', () => {
  const bad = path.join(dir, 'wrong-metadata.apk'),
    wrongDir = path.join(dir, 'wrong-project'),
    manifest = path.join(wrongDir, 'AndroidManifest.xml');
  fs.mkdirSync(wrongDir);
  fs.writeFileSync(
    manifest,
    `<?xml version="1.0"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="wrong.package" android:versionCode="99" android:versionName="9.9.9"><application/></manifest>`
  );
  run(aapt, [
    'package',
    '-f',
    '-M',
    manifest,
    '-I',
    path.join(sdk, 'platforms', 'android-35', 'android.jar'),
    '-F',
    bad,
  ]);
  const output = path.join(dir, 'wrong-metadata-signed.apk');
  expect(() => sign(output, bad)).toThrow();
  expect(fs.existsSync(output)).toBe(false);
});
