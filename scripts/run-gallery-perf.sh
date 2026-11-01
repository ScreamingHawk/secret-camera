#!/usr/bin/env bash
set -euo pipefail
package=link.standen.secretcamera
activity=link.standen.secretcamera/.MainActivity
mkdir -p gallery-perf-results
on_error() { adb logcat -d -t 700 > gallery-perf-results/emulator-failure-logcat.txt || true; }
trap on_error ERR
adb uninstall "$package" >/dev/null 2>&1 || true
adb install android/app/build/outputs/apk/release/app-release.apk
adb shell am start -W -n "$activity" -a android.intent.action.VIEW -d "myapp:///?variant=seed"
seed_report=files/gallery-perf-seed.json
for attempt in $(seq 1 600); do
  if adb shell run-as "$package" test -f "$seed_report"; then break; fi
  sleep 1
done
if ! adb shell run-as "$package" test -f "$seed_report"; then
  adb logcat -d -t 700 > gallery-perf-results/seed-timeout-logcat.txt
  echo "Timed out waiting for synthetic seed report" >&2
  exit 1
fi
adb exec-out run-as "$package" cat "$seed_report" > gallery-perf-results/seed.json
if ! node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(r.buildSentinel!=="GALLERY_PERF_BUILD_SENTINEL_SC5XX" || r.variant!=="seed" || r.photoCount!==96 || r.encryptedWithPhotoVaultCodec!==true) { console.error("Synthetic seed report invalid",r.errorCode||""); process.exit(1); }' gallery-perf-results/seed.json; then
  adb logcat -d -t 700 > gallery-perf-results/seed-failure-logcat.txt
  exit 1
fi
run_variant() {
  variant="$1"
  adb shell am force-stop "$package" || true
  adb shell am start -W -n "$activity" -a android.intent.action.VIEW -d "myapp:///?variant=${variant}"
  report_path="files/gallery-perf-${variant}.json"
  for attempt in $(seq 1 600); do
    if adb shell run-as "$package" test -f "$report_path"; then break; fi
    sleep 1
  done
  if ! adb shell run-as "$package" test -f "$report_path"; then
    adb logcat -d -t 700 > "gallery-perf-results/${variant}-timeout-logcat.txt"
    echo "Timed out waiting for ${variant} report" >&2
    exit 1
  fi
  adb exec-out run-as "$package" cat "$report_path" > "gallery-perf-results/${variant}.json"
  if ! node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const ok=r.buildSentinel==="GALLERY_PERF_BUILD_SENTINEL_SC5XX" && r.photoCount===96 && r.visits?.length===2 && r.visits.every(v=>Number.isFinite(v.firstVisibleImageMs) && Number.isFinite(v.visibleViewportMs) && Number.isFinite(v.cleanupMs) && v.visibleTileCount>0 && v.cacheFilesAfterCleanup===0); if(!ok || r.errorCode) { console.error("Harness report failed",r.stage||"",r.errorCode||""); process.exit(1); }' "gallery-perf-results/${variant}.json"; then
    adb logcat -d -t 700 > "gallery-perf-results/${variant}-failure-logcat.txt"
    exit 1
  fi
}
reboot_emulator() {
  adb reboot
  adb wait-for-device
  for attempt in $(seq 1 300); do
    if [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; then break; fi
    sleep 1
  done
  test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1"
}
reboot_emulator
run_variant baseline
reboot_emulator
run_variant candidate
