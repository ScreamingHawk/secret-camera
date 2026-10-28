#!/usr/bin/env node
/* eslint-env node */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyExistingRelease } = require('./verify-existing-release');
const { validateMetadata } = require('./validate-release');
const REPO = 'ScreamingHawk/secret-camera';
const APP_ID = 'link.standen.secretcamera';
const DESCRIPTION =
  'A privacy-focused camera app. Photos are stored on your device.';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function listReleases() {
  const all = [];
  for (let page = 1; ; page++) {
    let data;
    try {
      data = JSON.parse(
        run('gh', ['api', `repos/${REPO}/releases?per_page=100&page=${page}`])
      );
    } catch (_) {
      throw new Error('GitHub release listing failed');
    }
    if (!Array.isArray(data))
      throw new Error('Invalid GitHub releases response');
    all.push(...data);
    if (data.length < 100) return all;
  }
}
function selectStableReleases(releases) {
  if (!Array.isArray(releases))
    throw new Error('Invalid GitHub releases response');
  const seen = new Set();
  const candidates = [];
  for (const release of releases) {
    if (
      !release ||
      release.draft ||
      release.prerelease ||
      typeof release.tag_name !== 'string' ||
      !STABLE_TAG.test(release.tag_name)
    )
      continue;
    if (seen.has(release.tag_name))
      throw new Error(`Duplicate stable release tag: ${release.tag_name}`);
    seen.add(release.tag_name);
    candidates.push(release);
  }
  candidates.sort((a, b) => {
    const x = a.tag_name.slice(1).split('.').map(Number),
      y = b.tag_name.slice(1).split('.').map(Number);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
  return candidates;
}
function resolveRemoteCommit(tag) {
  let sha;
  try {
    const ref = JSON.parse(
      run('gh', ['api', `repos/${REPO}/git/ref/tags/${tag}`])
    ).object;
    sha = ref.sha;
    if (ref.type === 'commit' && /^[0-9a-f]{40}$/i.test(sha)) return sha;
  } catch (_) {
    throw new Error(`Cannot resolve remote tag ${tag}`);
  }
  const seen = new Set();
  for (let depth = 0; depth < 16; depth++) {
    if (!/^[0-9a-f]{40}$/i.test(sha) || seen.has(sha))
      throw new Error(`Invalid or cyclic remote tag object for ${tag}`);
    seen.add(sha);
    let obj;
    try {
      obj = JSON.parse(run('gh', ['api', `repos/${REPO}/git/tags/${sha}`]));
    } catch (_) {
      throw new Error(`Cannot dereference annotated tag ${tag}`);
    }
    if (
      obj.object &&
      obj.object.type === 'commit' &&
      /^[0-9a-f]{40}$/i.test(obj.object.sha)
    )
      return obj.object.sha;
    if (!obj.object || obj.object.type !== 'tag')
      throw new Error(`Invalid remote tag target for ${tag}`);
    sha = obj.object.sha;
  }
  throw new Error(`Remote tag nesting limit exceeded for ${tag}`);
}
function retainLatestCodes(verified) {
  const codes = new Set();
  for (const item of verified) {
    if (
      !Number.isSafeInteger(item.code) ||
      item.code <= 0 ||
      codes.has(item.code)
    )
      throw new Error('Invalid or duplicate stable versionCode');
    codes.add(item.code);
  }
  return [...verified]
    .sort((a, b) => b.code - a.code)
    .slice(0, 3)
    .reverse();
}
function collect(output, root = path.resolve(__dirname, '..')) {
  const target = path.resolve(output);
  if (
    fs.existsSync(target) &&
    (!fs.statSync(target).isDirectory() || fs.readdirSync(target).length)
  )
    throw new Error('Output directory must be fresh and empty');
  validateMetadata(root);
  const releases = listReleases();
  const candidates = selectStableReleases(releases);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, '.fdroid-collect-'));
  try {
    let selected = [];
    for (const item of candidates) {
      const tag = item.tag_name;
      const commit = resolveRemoteCommit(tag);
      if (!/^[0-9a-f]{40}$/i.test(commit))
        throw new Error(`Invalid remote commit for ${tag}`);
      const fixture = fs.mkdtempSync(
        path.join(os.tmpdir(), 'fdroid-metadata-')
      );
      try {
        for (const name of ['app.json', 'package.json', 'package-lock.json']) {
          const text = run('gh', [
            'api',
            '-H',
            'Accept: application/vnd.github.raw+json',
            `repos/${REPO}/contents/${name}?ref=${commit}`,
          ]);
          fs.writeFileSync(path.join(fixture, name), text);
        }
        const info = validateMetadata(fixture);
        if (info.version !== tag.slice(1))
          throw new Error(
            `Release tag ${tag} does not match committed metadata version`
          );
        const dir = path.join(stage, 'verified', tag);
        fs.mkdirSync(dir, { recursive: true });
        const result = verifyExistingRelease(tag, commit, dir, fixture);
        if (!result.exists) throw new Error(`Stable release ${tag} is missing`);
        const apk = path.join(dir, 'secret-camera.apk');
        selected.push({ version: info.version, code: info.versionCode, apk });
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    }
    if (!selected.length) throw new Error('No verified stable releases found');
    selected = retainLatestCodes(selected);
    const apkDir = path.join(stage, 'apks');
    fs.mkdirSync(apkDir);
    for (const x of selected)
      fs.copyFileSync(x.apk, path.join(apkDir, `${APP_ID}_${x.code}.apk`));
    const newest = selected[selected.length - 1];
    fs.writeFileSync(
      path.join(stage, 'manifest.json'),
      JSON.stringify(
        {
          name: 'Secret Camera',
          current_version: newest.version,
          current_version_code: newest.code,
          description: DESCRIPTION,
        },
        null,
        2
      ) + '\n'
    );
    fs.rmSync(path.join(stage, 'verified'), { recursive: true, force: true });
    if (!fs.existsSync(target)) fs.renameSync(stage, target);
    else {
      for (const name of fs.readdirSync(stage))
        fs.renameSync(path.join(stage, name), path.join(target, name));
      fs.rmSync(stage, { recursive: true, force: true });
    }
    return {
      versions: selected.map((x) => ({
        version: x.version,
        versionCode: x.code,
      })),
      output: target,
    };
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

if (require.main === module) {
  try {
    const i = process.argv.indexOf('--output');
    if (i < 0 || !process.argv[i + 1] || process.argv.length !== i + 2)
      throw new Error(
        'Usage: node scripts/collect-fdroid-releases.js --output <workdir>'
      );
    console.log(JSON.stringify(collect(process.argv[i + 1])));
  } catch (e) {
    console.error(`F-Droid collection failed: ${e.message}`);
    process.exitCode = 1;
  }
}
module.exports = {
  collect,
  listReleases,
  selectStableReleases,
  retainLatestCodes,
};
