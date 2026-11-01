const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const gradleFile = path.join(root, 'android/app/build.gradle');
const backupFile = path.join(root, 'bench/.gallery-perf-build.gradle.backup');
const cleanup = process.argv.includes('--cleanup');
if (cleanup) {
  if (fs.existsSync(backupFile)) {
    fs.writeFileSync(gradleFile, fs.readFileSync(backupFile, 'utf8'));
    fs.rmSync(backupFile);
  }
  console.log('Restored generated Android build configuration.');
  process.exit(0);
}
if (!fs.existsSync(gradleFile))
  throw new Error(
    'Run Expo prebuild before preparing gallery perf Gradle config'
  );
if (fs.existsSync(backupFile))
  throw new Error('Gallery perf Gradle preparation already active');
const original = fs.readFileSync(gradleFile, 'utf8');
if (
  original.split('react {').length - 1 !== 1 ||
  original.split('        release {\n').length - 1 !== 1
) {
  throw new Error(
    'Unexpected generated Android Gradle layout; refusing test-only patch'
  );
}
fs.writeFileSync(backupFile, original);
const prepared = original
  .replace('react {\n', 'react {\n    debuggableVariants = []\n')
  .replace(
    '        release {\n',
    '        release {\n            debuggable true\n'
  );
fs.writeFileSync(gradleFile, prepared);
console.log(
  'Configured generated release variant as debuggable and embedded-JS for the disposable harness build.'
);
