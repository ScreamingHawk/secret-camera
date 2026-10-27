/* eslint-env node, jest */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  validateMetadata,
  validateRelease,
} = require('../scripts/validate-release');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-camera-version-'));
  for (const file of ['app.json', 'package.json', 'package-lock.json'])
    fs.copyFileSync(file, path.join(dir, file));
  edit(dir, 'app.json', (x) => {
    x.expo.version = '1.1.1';
    x.expo.android.versionCode = 1;
  });
  edit(dir, 'package.json', (x) => {
    x.version = '1.1.1';
  });
  edit(dir, 'package-lock.json', (x) => {
    x.version = '1.1.1';
    x.packages[''].version = '1.1.1';
  });
  return dir;
}
function edit(dir, file, update) {
  const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  update(json);
  fs.writeFileSync(path.join(dir, file), JSON.stringify(json));
}

test('accepts representative consistent metadata and valid release above history', () => {
  const dir = fixture();
  try {
    edit(dir, 'app.json', (x) => {
      x.expo.android.versionCode = 2;
    });
    expect(validateMetadata(dir)).toEqual({
      version: '1.1.1',
      versionCode: 2,
      package: 'link.standen.secretcamera',
    });
    expect(validateRelease('v1.1.1', '1', dir).versionCode).toBe(2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects mismatched package and lockfile root versions', () => {
  const dir = fixture();
  try {
    edit(dir, 'package.json', (x) => {
      x.version = '1.1.0';
    });
    expect(() => validateMetadata(dir)).toThrow(/package.json version/);
    edit(dir, 'package.json', (x) => {
      x.version = '1.1.1';
    });
    edit(dir, 'package-lock.json', (x) => {
      x.packages[''].version = '1.1.0';
    });
    expect(() => validateMetadata(dir)).toThrow(
      /package-lock.json root version fields/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reads changed canonical app version dynamically and rejects stale mirrors', () => {
  const dir = fixture();
  try {
    edit(dir, 'app.json', (x) => {
      x.expo.version = '1.2.0';
      x.expo.android.versionCode = 2;
    });
    expect(() => validateMetadata(dir)).toThrow(/package.json version/);
    edit(dir, 'package.json', (x) => {
      x.version = '1.2.0';
    });
    edit(dir, 'package-lock.json', (x) => {
      x.version = '1.2.0';
      x.packages[''].version = '1.2.0';
    });
    expect(validateMetadata(dir).version).toBe('1.2.0');
    expect(validateRelease('v1.2.0', '1', dir).version).toBe('1.2.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test.each(['1.1.1', 'v1.1.2', 'v1.1.1-rc.1', 'v01.1.1'])(
  'rejects invalid or mismatched stable tag %s',
  (tag) => {
    const dir = fixture();
    try {
      expect(() => validateRelease(tag, '0', dir)).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('explicit fresh-lineage zero baseline accepts the first code without inventing legacy history', () => {
  const metadata = validateMetadata(path.resolve(__dirname, '..'));
  expect(validateRelease(`v${metadata.version}`, '0').versionCode).toBe(
    metadata.versionCode
  );
});

test('release validation fails closed without history and rejects reused code', () => {
  const metadata = validateMetadata(path.resolve(__dirname, '..'));
  expect(() => validateRelease(`v${metadata.version}`, undefined)).toThrow(
    /PREVIOUS_VERSION_CODE/
  );
  expect(() =>
    validateRelease(`v${metadata.version}`, String(metadata.versionCode))
  ).toThrow(/must exceed/);
});

test('rejects invalid Android application ID and non-positive code', () => {
  const dir = fixture();
  try {
    edit(dir, 'app.json', (x) => {
      x.expo.android.package = 'wrong.id';
    });
    expect(() => validateMetadata(dir)).toThrow(/application ID/);
    edit(dir, 'app.json', (x) => {
      x.expo.android.package = 'link.standen.secretcamera';
      x.expo.android.versionCode = 0;
    });
    expect(() => validateMetadata(dir)).toThrow(/positive safe integer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
