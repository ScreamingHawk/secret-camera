/* eslint-env node, jest */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifiedHighestCode } = require('../scripts/release-history');
const signer = 'a'.repeat(64);

describe('getVerifiedReleaseHistory adapter', () => {
  let execFileSync;
  let getVerifiedReleaseHistory;
  let temp;
  let sdk;
  let apksigner;
  let aapt;
  let env;

  beforeEach(() => {
    jest.resetModules();
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-history-adapter-'));
    sdk = path.join(temp, 'sdk');
    const tools = path.join(sdk, 'build-tools', '35.0.0');
    fs.mkdirSync(tools, { recursive: true });
    apksigner = path.join(tools, 'apksigner');
    aapt = path.join(tools, 'aapt');
    fs.writeFileSync(apksigner, '');
    fs.writeFileSync(aapt, '');
    env = {
      ...process.env,
      ANDROID_SIGNER_SHA256: signer,
      ANDROID_SDK_ROOT: sdk,
      HOME: path.join(temp, 'home'),
      JAVA_HOME: '/home/michael/.local/jdks/temurin-17',
    };
    fs.mkdirSync(env.HOME);
    execFileSync = jest.fn();
    jest.doMock('node:child_process', () => ({ execFileSync }));
    ({ getVerifiedReleaseHistory } = require('../scripts/release-history'));
  });

  afterEach(() => {
    jest.dontMock('node:child_process');
    jest.resetModules();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  function release(tag, name = 'secret-camera.apk') {
    return { tag_name: tag, assets: [{ name }] };
  }
  function pages(...lists) {
    return JSON.stringify(lists);
  }
  function mockCommands(
    response,
    {
      failSigner = false,
      malformedCert = false,
      extraSigner = false,
      versionName = '1.2.3',
    } = {}
  ) {
    execFileSync.mockImplementation((command, args, options) => {
      if (command === 'gh' && args[0] === 'api') return response;
      if (command === 'gh' && args[0] === 'release') {
        const dir = args[args.indexOf('--dir') + 1];
        fs.writeFileSync(path.join(dir, 'secret-camera.apk'), 'fixture');
        return '';
      }
      if (command === apksigner) {
        if (failSigner) {
          const error = new Error('apksigner failed');
          error.status = 1;
          throw error;
        }
        return `Signer #1 certificate SHA-256 digest: ${malformedCert ? 'not-a-digest' : signer.match(/../g).join(':')}\n${extraSigner ? `Signer #2 certificate SHA-256 digest: ${signer}\n` : ''}`;
      }
      if (command === aapt)
        return `package: name='link.standen.secretcamera' versionCode='42' versionName='${versionName}'\n`;
      throw new Error(`unexpected command: ${command} ${args}`);
    });
  }

  test('paginates/slurps pages, flattens stable releases and downloads by parent tag', () => {
    const data = [[release('v1.2.3')], [release('v1.2.3')]];
    mockCommands(pages(...data));
    const original = process.env;
    process.env = { ...original, ...env };
    try {
      expect(getVerifiedReleaseHistory()).toBe(42);
    } finally {
      process.env = original;
    }
    expect(execFileSync.mock.calls[0][0]).toBe('gh');
    expect(execFileSync.mock.calls[0][1]).toEqual([
      'api',
      'repos/ScreamingHawk/secret-camera/releases',
      '--paginate',
      '--slurp',
    ]);
    const downloads = execFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'gh' && args[0] === 'release'
    );
    expect(downloads.map(([, args]) => args.slice(1, 6))).toEqual([
      [
        'download',
        'v1.2.3',
        '--repo',
        'ScreamingHawk/secret-camera',
        '--pattern',
      ],
      [
        'download',
        'v1.2.3',
        '--repo',
        'ScreamingHawk/secret-camera',
        '--pattern',
      ],
    ]);
    expect(
      downloads.every(
        ([, args]) =>
          args[args.indexOf('--pattern') + 1] === 'secret-camera.apk'
      )
    ).toBe(true);
    expect(
      execFileSync.mock.calls
        .filter(([cmd]) => cmd === apksigner || cmd === aapt)
        .map(([cmd]) => cmd)
    ).toEqual([apksigner, aapt, apksigner, aapt]);
  });

  test('rejects multiple signer digests even when the first matches', () => {
    mockCommands(pages([release('v1.2.3')]), { extraSigner: true });
    const original = process.env;
    process.env = { ...original, ...env };
    try {
      expect(() => getVerifiedReleaseHistory()).toThrow();
    } finally {
      process.env = original;
    }
  });

  test('rejects APK versionName that differs from stable tag version', () => {
    mockCommands(pages([release('v1.2.3')]), { versionName: '9.9.9' });
    const original = process.env;
    process.env = { ...original, ...env };
    try {
      expect(() => getVerifiedReleaseHistory()).toThrow();
    } finally {
      process.env = original;
    }
  });

  test('apksigner failure rejects and removes downloaded temporary directory', () => {
    mockCommands(pages([release('v1.0.0')]), { failSigner: true });
    const original = process.env;
    process.env = { ...original, ...env };
    let error;
    try {
      expect(() => getVerifiedReleaseHistory()).toThrow('apksigner failed');
    } finally {
      process.env = original;
    }
    const download = execFileSync.mock.calls.find(
      ([cmd, args]) => cmd === 'gh' && args[0] === 'release'
    );
    const dir = download[2] && download[1][download[1].indexOf('--dir') + 1];
    expect(fs.existsSync(dir)).toBe(false);
  });

  test.each([
    ['malformed pages', '{not json'],
    ['missing APK', pages([{ tag_name: 'v1.0.0', assets: [] }])],
  ])('rejects %s', (_label, response) => {
    mockCommands(response);
    const original = process.env;
    process.env = { ...original, ...env };
    try {
      expect(() => getVerifiedReleaseHistory()).toThrow();
    } finally {
      process.env = original;
    }
  });
});

function stable(tag, versionCode) {
  return {
    tag_name: tag,
    assets: [{ name: 'secret-camera.apk' }],
    versionCode,
  };
}
test('chooses numeric highest stable APK code, excludes prereleases and drafts, removes temp files', () => {
  const seen = [];
  const releases = [
    stable('v2.0.0', 12),
    stable('v10.0.0', 9),
    { ...stable('v99.0.0', 50), prerelease: true },
    { ...stable('v88.0.0', 50), draft: true },
  ];
  const code = verifiedHighestCode({
    signerSha256: signer,
    releases,
    downloadAsset(tag) {
      const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'release-history-test-')
      );
      seen.push(dir);
      return path.join(dir, `${tag}.apk`);
    },
    verifyApk(file) {
      fs.writeFileSync(file, 'fixture');
      return {
        package: 'link.standen.secretcamera',
        versionCode: file.includes('v10') ? 9 : 12,
        versionName: file.includes('v10') ? '10.0.0' : '2.0.0',
        signerSha256: signer,
      };
    },
  });
  expect(code).toBe(12);
  expect(seen.every((dir) => !fs.existsSync(dir))).toBe(true);
});

test('accepts empty stable history as the explicit fresh-lineage baseline zero', () => {
  expect(
    verifiedHighestCode({
      signerSha256: signer,
      releases: [],
      downloadAsset: jest.fn(),
      verifyApk: jest.fn(),
    })
  ).toBe(0);
});

test('rejects malformed signer before inspecting releases', () => {
  expect(() =>
    verifiedHighestCode({
      signerSha256: 'not-a-digest',
      releases: [],
      downloadAsset: jest.fn(),
      verifyApk: jest.fn(),
    })
  ).toThrow(/ANDROID_SIGNER_SHA256/);
});

test('fails closed on unverifiable stable entries and always cleans downloaded file parent', () => {
  let dir;
  expect(() =>
    verifiedHighestCode({
      signerSha256: signer,
      releases: [stable('v1.0.0', 2)],
      downloadAsset() {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-history-test-'));
        return path.join(dir, 'x.apk');
      },
      verifyApk() {
        throw new Error('signature invalid');
      },
    })
  ).toThrow('signature invalid');
  expect(fs.existsSync(dir)).toBe(false);
});

test('rejects signer mismatch and malformed certificate identity', () => {
  for (const certificate of ['b'.repeat(64), null]) {
    expect(() =>
      verifiedHighestCode({
        signerSha256: signer,
        releases: [stable('v1.0.0', 1)],
        downloadAsset: () => {
          const dir = fs.mkdtempSync(
            path.join(os.tmpdir(), 'release-history-test-')
          );
          return path.join(dir, 'fixture.apk');
        },
        verifyApk: () => ({
          package: 'link.standen.secretcamera',
          versionCode: 1,
          versionName: '1.0.0',
          signerSha256: certificate,
        }),
      })
    ).toThrow(/cannot be verified/);
  }
});
