#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const APPLICATION_ID = 'link.standen.secretcamera';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${file}: ${error.message}`);
  }
}

function validateMetadata(root = process.cwd()) {
  const app = readJson(path.join(root, 'app.json')).expo;
  const pkg = readJson(path.join(root, 'package.json'));
  const lock = readJson(path.join(root, 'package-lock.json'));
  if (!app || !app.android)
    throw new Error('app.json must define expo.android');
  const version = app.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('app.json expo.version must be a stable X.Y.Z version');
  if (pkg.version !== version)
    throw new Error(
      `package.json version ${pkg.version} does not match app.json version ${version}`
    );
  if (
    lock.version !== version ||
    !lock.packages ||
    !lock.packages[''] ||
    lock.packages[''].version !== version
  )
    throw new Error(
      `package-lock.json root version fields must match app.json version ${version}`
    );
  if (app.android.package !== APPLICATION_ID)
    throw new Error(
      `Unexpected Android application ID: ${app.android.package}`
    );
  const code = app.android.versionCode;
  if (!Number.isSafeInteger(code) || code <= 0)
    throw new Error(
      'app.json expo.android.versionCode must be a positive safe integer'
    );
  return { version, versionCode: code, package: app.android.package };
}

function validateRelease(tag, previousCode, root = process.cwd()) {
  const metadata = validateMetadata(root);
  const match = STABLE_TAG.exec(tag || '');
  if (!match)
    throw new Error(`Expected stable tag vX.Y.Z, got: ${tag || '(empty)'}`);
  if (match[0].slice(1) !== metadata.version)
    throw new Error(
      `Tag ${tag} does not match app.json version ${metadata.version}`
    );
  if (previousCode === undefined || previousCode === '')
    throw new Error(
      'Set PREVIOUS_VERSION_CODE from verified distribution history before release'
    );
  if (
    !/^(0|[1-9]\d*)$/.test(String(previousCode)) ||
    !Number.isSafeInteger(Number(previousCode))
  )
    throw new Error('PREVIOUS_VERSION_CODE must be a non-negative integer');
  if (metadata.versionCode <= Number(previousCode))
    throw new Error(
      `versionCode ${metadata.versionCode} must exceed verified previous code ${previousCode}`
    );
  return metadata;
}

if (require.main === module) {
  try {
    if (process.argv[2] === '--metadata' && process.argv.length === 3)
      console.log(JSON.stringify(validateMetadata(), null, 2));
    else if (process.argv[2] === '--release' && process.argv.length === 4)
      console.log(
        JSON.stringify(
          validateRelease(process.argv[3], process.env.PREVIOUS_VERSION_CODE),
          null,
          2
        )
      );
    else
      throw new Error(
        'Usage: node scripts/validate-release.js --metadata | --release vX.Y.Z'
      );
  } catch (error) {
    console.error(`Version validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { validateMetadata, validateRelease };
