/* eslint-env node, jest */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  verifyExistingRelease,
  apiRelease,
} = require('../scripts/verify-existing-release');
const root = path.resolve(__dirname, '..');
const commit = 'a'.repeat(40);
const signer = 'b'.repeat(64);
const assets = [
  'secret-camera.apk',
  'secret-camera.apk.sha256',
  'version.json',
];
let temp, execFileSync, release, fixture;

beforeEach(() => {
  jest.resetModules();
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-release-test-'));
  fixture = path.join(temp, 'download');
  fs.mkdirSync(fixture);
  release = {
    tag_name: 'v1.1.1',
    draft: false,
    prerelease: false,
    assets: assets.map((name) => ({ name })),
  };
  const apk = Buffer.from('fixture apk');
  const crypto = require('node:crypto');
  const digest = crypto.createHash('sha256').update(apk).digest('hex');
  fs.writeFileSync(path.join(fixture, assets[0]), apk);
  fs.writeFileSync(
    path.join(fixture, assets[1]),
    `${digest}  secret-camera.apk\n`
  );
  fs.writeFileSync(
    path.join(fixture, assets[2]),
    JSON.stringify({
      version: '1.1.1',
      versionCode: 1,
      package: 'link.standen.secretcamera',
      commit,
      sha256: digest,
    })
  );
  execFileSync = jest.fn((command, args) => {
    if (command === 'gh' && args[0] === 'api') return JSON.stringify(release);
    if (command === 'git') return `${commit}\n`;
    if (command === 'gh' && args[0] === 'release') {
      const dir = args[args.indexOf('--dir') + 1];
      for (const name of assets)
        fs.copyFileSync(path.join(fixture, name), path.join(dir, name));
      return '';
    }
    if (command.endsWith('apksigner'))
      return `Signer #1 certificate SHA-256 digest: ${signer}\n`;
    if (command.endsWith('aapt'))
      return "package: name='link.standen.secretcamera' versionCode='1' versionName='1.1.1'\n";
    throw new Error(`unexpected command ${command}`);
  });
  jest.doMock('node:child_process', () => ({ execFileSync }));
});
afterEach(() => {
  jest.dontMock('node:child_process');
  jest.resetModules();
  fs.rmSync(temp, { recursive: true, force: true });
});
function invoke(out = path.join(temp, 'out')) {
  const old = process.env;
  process.env = {
    ...old,
    ANDROID_SIGNER_SHA256: signer,
    ANDROID_SDK_ROOT: temp,
  };
  const tools = path.join(temp, 'build-tools', '35.0.0');
  fs.mkdirSync(tools, { recursive: true });
  try {
    return verifyExistingRelease('v1.1.1', commit, out, root);
  } finally {
    process.env = old;
  }
}
test('verifies existing release assets and copies exactly the three assets', () => {
  expect(invoke()).toEqual({ exists: true });
  expect(fs.readdirSync(path.join(temp, 'out')).sort()).toEqual(
    [...assets].sort()
  );
});
test('404 is the sole normal absent-release result', () => {
  const error = Object.assign(new Error('Not Found (HTTP 404)'), {
    status: 1,
    stderr: 'HTTP 404',
  });
  execFileSync.mockImplementationOnce(() => {
    throw error;
  });
  expect(invoke()).toEqual({ exists: false });
});
test.each(['unauthorized', 'server error'])(
  'fails closed on %s API errors',
  (reason) => {
    execFileSync.mockImplementationOnce(() => {
      const e = new Error(reason);
      e.stderr = reason;
      throw e;
    });
    expect(() => invoke()).toThrow(/lookup failed/);
  }
);
test('rejects changed checksum and does not create output files', () => {
  fs.writeFileSync(
    path.join(fixture, assets[1]),
    `${'0'.repeat(64)}  secret-camera.apk\n`
  );
  expect(() => invoke()).toThrow(/checksum/);
  expect(fs.existsSync(path.join(temp, 'out', assets[0]))).toBe(false);
});
test('rejects missing and duplicate remote assets', () => {
  release.assets.pop();
  expect(() => invoke()).toThrow(/exactly one/);
  release.assets.push({ name: assets[2] });
  release.assets.push({ name: assets[2] });
  expect(() => invoke()).toThrow(/exactly one/);
});
test('rejects wrong tag commit and signer', () => {
  execFileSync.mockImplementation((command, args) => {
    if (command === 'gh' && args[0] === 'api') return JSON.stringify(release);
    if (command === 'git') return `${'c'.repeat(40)}\n`;
    throw Error('unexpected');
  });
  expect(() => invoke()).toThrow(/expected commit/);
  execFileSync.mockImplementation((command, args) => {
    if (command === 'gh' && args[0] === 'api') return JSON.stringify(release);
    if (command === 'git') return `${commit}\n`;
    if (command === 'gh' && args[0] === 'release') {
      const dir = args[args.indexOf('--dir') + 1];
      for (const name of assets)
        fs.copyFileSync(path.join(fixture, name), path.join(dir, name));
      return '';
    }
    if (command.endsWith('apksigner'))
      return `Signer #1 certificate SHA-256 digest: ${'c'.repeat(64)}\n`;
    throw Error('unexpected');
  });
  expect(() => invoke()).toThrow(/signer certificate/);
});
