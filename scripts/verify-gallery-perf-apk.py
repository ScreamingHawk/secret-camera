#!/usr/bin/env python3
import hashlib
import os
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: verify-gallery-perf-apk.py <apk> <synthetic-jpeg>")
apk = Path(sys.argv[1])
fixture = Path(sys.argv[2]).read_bytes()
with zipfile.ZipFile(apk) as bundle:
    names = bundle.namelist()
    js_path = next((name for name in names if name.endswith("assets/index.android.bundle")), None)
    if js_path is None:
        raise SystemExit("FAIL: APK has no embedded Android JavaScript bundle")
    js_bundle = bundle.read(js_path)
    if b"GALLERY_PERF_BUILD_SENTINEL_SC5XX" not in js_bundle:
        raise SystemExit("FAIL: embedded bundle does not contain the gallery harness sentinel")
    fixture_hash = hashlib.sha256(fixture).digest()
    fixture_found = False
    for name in names:
        try:
            data = bundle.read(name)
        except (KeyError, RuntimeError):
            continue
        if hashlib.sha256(data).digest() == fixture_hash:
            fixture_found = True
            break
    if not fixture_found:
        raise SystemExit("FAIL: synthetic JPEG fixture bytes are absent from APK resources")

android_home = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
if not android_home:
    raise SystemExit("FAIL: Android SDK path unavailable for packaged-manifest verification")
aapt_candidates = sorted((Path(android_home) / "build-tools").glob("*/aapt"), reverse=True)
if not aapt_candidates:
    raise SystemExit("FAIL: aapt unavailable for packaged-manifest verification")
result = subprocess.run([str(aapt_candidates[0]), "dump", "badging", str(apk)], check=True, capture_output=True, text=True)
package_line = next((line for line in result.stdout.splitlines() if line.startswith("package:")), "")
if "name='link.standen.secretcamera'" not in package_line:
    raise SystemExit("FAIL: packaged APK does not have expected test app id")
manifest = subprocess.run([str(aapt_candidates[0]), "dump", "xmltree", str(apk), "AndroidManifest.xml"], check=True, capture_output=True, text=True).stdout
lines = manifest.splitlines()
application_index = next((index for index, line in enumerate(lines) if line.strip().startswith("E: application")), None)
if application_index is None:
    raise SystemExit("FAIL: packaged manifest has no application element")
application_lines = []
for line in lines[application_index + 1:]:
    if line.strip().startswith("E: "):
        break
    application_lines.append(line)
if not any("android:debuggable" in line and ("0xffffffff" in line or "true" in line.lower()) for line in application_lines):
    raise SystemExit("FAIL: packaged manifest is not debuggable (adb run-as would fail)")
print("PASS: APK package id and debuggable manifest verified")
print(f"PASS: embedded JS sentinel verified ({len(js_bundle)} bytes)")
print(f"PASS: synthetic JPEG fixture verified (SHA-256 {hashlib.sha256(fixture).hexdigest()})")
