/* eslint-env node, jest */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { packageRelease } = require('../scripts/package-release');

function fixture() {
  const dir = fs.mkdtempSync(
    path.join(process.env.TMPDIR || os.tmpdir(), 'secret-camera-package-')
  );
  const root = path.join(dir, 'project');
  const output = path.join(dir, 'output');
  fs.mkdirSync(root);
  for (const file of ['app.json', 'package.json', 'package-lock.json'])
    fs.copyFileSync(file, path.join(root, file));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  app.expo.version = '1.1.1';
  app.expo.android.versionCode = 1;
  fs.writeFileSync(path.join(root, 'app.json'), JSON.stringify(app));
  for (const file of ['package.json', 'package-lock.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    data.version = '1.1.1';
    if (data.packages) data.packages[''].version = '1.1.1';
    fs.writeFileSync(path.join(root, file), JSON.stringify(data));
  }
  const input = path.join(dir, 'synthetic-fixture.bin');
  fs.writeFileSync(input, Buffer.from('synthetic bytes; not an APK build'));
  return { dir, root, output, input };
}

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

test('writes metadata JSON, APK bytes, and portable basename checksum', () => {
  const f = fixture();
  try {
    const sha256 = crypto
      .createHash('sha256')
      .update(fs.readFileSync(f.input))
      .digest('hex');
    const result = packageRelease(f.input, f.output, COMMIT, f.root);
    const json = JSON.parse(
      fs.readFileSync(path.join(f.output, 'version.json'), 'utf8')
    );
    expect(json).toEqual({
      version: '1.1.1',
      versionCode: 1,
      package: 'link.standen.secretcamera',
      commit: COMMIT,
      sha256,
    });
    expect(result).toEqual(json);
    expect(fs.readFileSync(path.join(f.output, 'secret-camera.apk'))).toEqual(
      fs.readFileSync(f.input)
    );
    expect(
      fs.readFileSync(path.join(f.output, 'secret-camera.apk.sha256'), 'utf8')
    ).toBe(`${sha256}  secret-camera.apk\n`);
    expect(
      fs.readFileSync(path.join(f.output, 'secret-camera.apk.sha256'), 'utf8')
    ).not.toContain(f.dir);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('emits the captured input bytes if the source changes before output writing', () => {
  const f = fixture();
  const originalMkdirSync = fs.mkdirSync;
  try {
    fs.mkdirSync = function (target, options) {
      const result = originalMkdirSync.call(this, target, options);
      if (target === f.output) fs.writeFileSync(f.input, 'mutated after read');
      return result;
    };
    packageRelease(f.input, f.output, COMMIT, f.root);
    const artifact = fs.readFileSync(path.join(f.output, 'secret-camera.apk'));
    const actualDigest = crypto
      .createHash('sha256')
      .update(artifact)
      .digest('hex');
    const json = JSON.parse(
      fs.readFileSync(path.join(f.output, 'version.json'), 'utf8')
    );
    const checksum = fs.readFileSync(
      path.join(f.output, 'secret-camera.apk.sha256'),
      'utf8'
    );
    expect(json.sha256).toBe(actualDigest);
    expect(checksum).toBe(`${actualDigest}  secret-camera.apk\n`);
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('rejects absent and empty inputs and malformed commit before output', () => {
  const f = fixture();
  try {
    const absent = path.join(f.dir, 'absent.apk');
    expect(() => packageRelease(absent, f.output, COMMIT, f.root)).toThrow(
      /non-empty/
    );
    fs.writeFileSync(absent, '');
    expect(() => packageRelease(absent, f.output, COMMIT, f.root)).toThrow(
      /non-empty/
    );
    expect(() =>
      packageRelease(f.input, f.output, 'not-a-commit', f.root)
    ).toThrow(/40 hexadecimal/);
    expect(fs.existsSync(f.output)).toBe(false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('rejects mismatched project metadata before emitting output', () => {
  const f = fixture();
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(f.root, 'package.json'), 'utf8')
    );
    pkg.version = '9.9.9';
    fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify(pkg));
    expect(() => packageRelease(f.input, f.output, COMMIT, f.root)).toThrow(
      /does not match/
    );
    expect(fs.existsSync(f.output)).toBe(false);
  } finally {
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
