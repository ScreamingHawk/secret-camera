/* eslint-env node, jest */
const { test, expect } = require('@jest/globals');
const {
  selectStableReleases,
  retainLatestCodes,
} = require('../scripts/collect-fdroid-releases');
test('retains up to three verified APKs by versionCode even when semver order differs', () => {
  const versions = [
    { version: '9.0.0', code: 1 },
    { version: '4.0.0', code: 2 },
    { version: '3.0.0', code: 8 },
    { version: '2.0.0', code: 7 },
    { version: '1.0.0', code: 9 },
  ];
  expect(retainLatestCodes(versions).map((x) => x.code)).toEqual([7, 8, 9]);
  expect(retainLatestCodes([versions[0]])).toEqual([versions[0]]);
  expect(() => retainLatestCodes([{ code: 2 }, { code: 2 }])).toThrow(
    /duplicate/
  );
});
test('retains latest three stable releases numerically and excludes drafts/prereleases', () => {
  const releases = [
    { tag_name: 'v1.1.2', draft: false, prerelease: false },
    { tag_name: 'v1.10.0', draft: false, prerelease: false },
    { tag_name: 'v1.2.0', draft: false, prerelease: false },
    { tag_name: 'v9.0.0-rc1', draft: false, prerelease: true },
    { tag_name: 'v8.0.0', draft: true, prerelease: false },
    { tag_name: 'oops', draft: false, prerelease: false },
  ];
  expect(selectStableReleases(releases).map((x) => x.tag_name)).toEqual([
    'v1.10.0',
    'v1.2.0',
    'v1.1.2',
  ]);
});
test('rejects duplicate stable tags', () =>
  expect(() =>
    selectStableReleases([
      { tag_name: 'v1.0.0', draft: false, prerelease: false },
      { tag_name: 'v1.0.0', draft: false, prerelease: false },
    ])
  ).toThrow(/Duplicate/));
test('fails closed for malformed releases response', () =>
  expect(() => selectStableReleases(null)).toThrow(/Invalid/));
test('allows a single published stable release', () =>
  expect(
    selectStableReleases([
      { tag_name: 'v1.1.2', draft: false, prerelease: false },
    ])
  ).toHaveLength(1));
