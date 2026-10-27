#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'APK signing failed: %s\n' "$1" >&2; exit 1; }
[[ $# == 2 ]] || fail 'Usage: scripts/sign-apk.sh <input.apk> <final-output.apk>'
input=$1 output=$2
[[ -n "$input" && -f "$input" && -s "$input" ]] || fail 'Input APK must be a non-empty file'
for name in ANDROID_KEYSTORE_PATH ANDROID_STORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD ANDROID_SIGNER_SHA256; do
  [[ -n "${!name:-}" ]] || fail "Missing required environment setting: $name"
done
[[ "$ANDROID_SIGNER_SHA256" =~ ^[[:xdigit:]]{64}$ ]] || fail 'ANDROID_SIGNER_SHA256 must be exactly 64 hexadecimal characters'
[[ -f "$ANDROID_KEYSTORE_PATH" ]] || fail 'ANDROID_KEYSTORE_PATH must name an existing keystore file'
input_abs=$(realpath "$input"); output_abs=$(realpath -m "$output")
[[ "$input_abs" != "$output_abs" ]] || fail 'Input and output APK paths must differ'
[[ ! -e "$output_abs" ]] || fail 'Output path already exists; refusing to overwrite'
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
root=$(cd "$script_dir/.." && pwd)
metadata=$(node -e 'const m=require(process.argv[1]).validateMetadata(process.argv[2]); process.stdout.write(JSON.stringify(m))' "$script_dir/validate-release.js" "$root") || fail 'Project release metadata is invalid'
read -r pkg version code < <(node -e 'const m=JSON.parse(process.argv[1]); console.log(m.package,m.version,m.versionCode)' "$metadata")
sdk=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}
[[ -n "$sdk" ]] || fail 'Set ANDROID_SDK_ROOT or ANDROID_HOME to the Android SDK directory'
tools=${ANDROID_BUILD_TOOLS:-${ANDROID_SDK_BUILD_TOOLS:-$sdk/build-tools/35.0.0}}
for bin in zipalign apksigner aapt; do [[ -x "$tools/$bin" ]] || fail "Missing Android tool: $tools/$bin"; done
output_dir=$(dirname -- "$output_abs")
mkdir -p "$output_dir"
work=$(mktemp -d "$output_dir/.secret-camera-sign.XXXXXX")
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
aligned=$work/aligned.apk; staged=$work/signed.apk
"$tools/zipalign" -f -v 4 "$input_abs" "$aligned" >/dev/null
"$tools/apksigner" sign --ks "$ANDROID_KEYSTORE_PATH" --ks-key-alias "$ANDROID_KEY_ALIAS" --ks-pass env:ANDROID_STORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD --out "$staged" "$aligned" >/dev/null
"$tools/apksigner" verify --verbose --print-certs "$staged" >"$work/verify.txt" || fail 'apksigner verification failed'
actual=$(sed -n 's/.*certificate SHA-256 digest: //p' "$work/verify.txt" | head -n 1 | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')
expected=$(printf '%s' "$ANDROID_SIGNER_SHA256" | tr '[:upper:]' '[:lower:]')
[[ "$actual" == "$expected" ]] || fail 'Signer certificate SHA-256 does not match ANDROID_SIGNER_SHA256'
badging=$("$tools/aapt" dump badging "$staged") || fail 'Cannot read signed APK metadata'
printf '%s\n' "$badging" | grep -F "package: name='$pkg' versionCode='$code' versionName='$version'" >/dev/null || fail 'APK package/version metadata does not match app.json'
[[ ! -e "$output_abs" ]] || fail 'Output path appeared during signing; refusing to overwrite'
ln "$staged" "$output_abs" 2>/dev/null || fail 'Could not exclusively publish verified APK; refusing to overwrite'
printf 'Signed and verified APK: %s\n' "$output_abs"
